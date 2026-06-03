/**
 * Messaging Layer Security (RFC 9420) provider for real-time E2E group chat.
 *
 * Wraps `ts-mls` (pure-TS RFC 9420) behind a small, swappable `MlsProvider` seam. ts-mls is
 * NOT security-audited (ADR-0018) — the seam exists so production can swap in an audited impl
 * (e.g. AWS `mls-rs` compiled to WASM) with zero changes to the app/worker.
 *
 * Design: every boundary value is a `Uint8Array`. The provider itself is stateless across calls
 * (it only holds the ciphersuite impl); group state, key packages, welcomes and ciphertext all
 * cross the seam as bytes. That lets the caller persist group state encrypted (IndexedDB via the
 * vault) and relay the public artifacts/ciphertext over the CH-2 transport unchanged — the server
 * only ever sees opaque bytes (ADR-0001 zero-knowledge).
 */
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup as mlsCreateGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackage as mlsGenerateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup as mlsJoinGroup,
  processMessage,
  zeroOutUint8Array,
  type CiphersuiteImpl,
  type CiphersuiteName,
  type ClientState,
  type Credential,
  type KeyPackage,
  type PrivateKeyPackage,
  type Proposal,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';

/** The ciphersuite chosen in ADR-0018: X25519 + AES-128-GCM + SHA-256 + Ed25519 (no extra deps). */
export const MLS_CIPHERSUITE: CiphersuiteName = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

/** A device's KeyPackage: the public half is published to the server; the private half is sealed client-side. */
export interface KeyPackageBundle {
  /** Wire-encoded public KeyPackage (`mls_key_package`). Publish to the server (`key_packages`). */
  publicPackage: Uint8Array;
  /** Packed private keys for this KeyPackage. Seal client-side — never sent to the server. */
  privatePackage: Uint8Array;
}

/** Result of starting a DM: the creator's group state + the Welcome to relay to the invitee. */
export interface DmInvite {
  /** Serialized group state to persist (sealed). */
  groupState: Uint8Array;
  /** Wire-encoded `mls_welcome` — relay to the invitee, who calls `joinGroup`. */
  welcome: Uint8Array;
}

/** Result of adding a member to an existing group. */
export interface AddResult {
  groupState: Uint8Array;
  /** Wire-encoded `mls_welcome` for the new member. */
  welcome: Uint8Array;
  /** Wire-encoded commit — relay to the group's *existing* members so they advance their epoch. */
  commit: Uint8Array;
}

/** Result of encrypting an application message. */
export interface EncryptResult {
  /** New group state after sending (ratchet advanced). */
  groupState: Uint8Array;
  /** Wire-encoded `mls_private_message` — the opaque ciphertext relayed over the CH-2 transport. */
  ciphertext: Uint8Array;
}

/** Result of processing inbound ciphertext: either a decrypted app message or a handshake (epoch change). */
export type DecryptResult =
  | { type: 'application'; groupState: Uint8Array; plaintext: Uint8Array }
  | { type: 'handshake'; groupState: Uint8Array };

/**
 * The swappable E2E seam. All inputs/outputs are bytes; implementations hold no per-group state.
 * `ts-mls` is one implementation; an audited `mls-rs`/WASM impl would satisfy the same contract.
 */
export interface MlsProvider {
  readonly ciphersuite: CiphersuiteName;
  /** Generate a fresh KeyPackage for a device. `identity` is the credential identity (e.g. a user/device id). */
  generateKeyPackage(identity: Uint8Array): Promise<KeyPackageBundle>;
  /** Create a new single-member group. Returns the serialized group state. */
  createGroup(groupId: Uint8Array, self: KeyPackageBundle): Promise<Uint8Array>;
  /** Add a member to an existing group (commit an Add proposal). */
  addMember(groupState: Uint8Array, peerKeyPackage: Uint8Array): Promise<AddResult>;
  /** Convenience: create a group and add one peer in a single step (the 1:1 DM path). */
  startDm(groupId: Uint8Array, self: KeyPackageBundle, peerKeyPackage: Uint8Array): Promise<DmInvite>;
  /** Join a group from a relayed Welcome. Returns the serialized group state. */
  joinGroup(welcome: Uint8Array, self: KeyPackageBundle): Promise<Uint8Array>;
  /** Encrypt an application message; returns ciphertext to relay + the advanced group state. */
  encrypt(groupState: Uint8Array, plaintext: Uint8Array): Promise<EncryptResult>;
  /** Process inbound ciphertext; returns the plaintext (application) or just the advanced state (handshake). */
  decrypt(groupState: Uint8Array, ciphertext: Uint8Array): Promise<DecryptResult>;
}

// ── byte packing for the private KeyPackage (ts-mls has no wire encoder for it) ──

function packParts(parts: Uint8Array[]): Uint8Array {
  let total = 4;
  for (const p of parts) total += 4 + p.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  view.setUint32(off, parts.length);
  off += 4;
  for (const p of parts) {
    view.setUint32(off, p.length);
    off += 4;
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function unpackParts(buf: Uint8Array): Uint8Array[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const n = view.getUint32(off);
  off += 4;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const len = view.getUint32(off);
    off += 4;
    parts.push(buf.slice(off, off + len));
    off += len;
  }
  return parts;
}

function packPrivate(p: PrivateKeyPackage): Uint8Array {
  return packParts([p.initPrivateKey, p.hpkePrivateKey, p.signaturePrivateKey]);
}

function unpackPrivate(b: Uint8Array): PrivateKeyPackage {
  const [initPrivateKey, hpkePrivateKey, signaturePrivateKey] = unpackParts(b);
  if (!initPrivateKey || !hpkePrivateKey || !signaturePrivateKey) {
    throw new Error('malformed private KeyPackage');
  }
  return { initPrivateKey, hpkePrivateKey, signaturePrivateKey };
}

// ── wire (de)serialization helpers ──

function decodeKeyPackage(wire: Uint8Array): KeyPackage {
  const decoded = decodeMlsMessage(wire, 0);
  if (!decoded) throw new Error('failed to decode KeyPackage');
  const [msg] = decoded;
  if (msg.wireformat !== 'mls_key_package') throw new Error(`expected mls_key_package, got ${msg.wireformat}`);
  return msg.keyPackage;
}

function encodeKeyPackageWire(keyPackage: KeyPackage): Uint8Array {
  return encodeMlsMessage({ keyPackage, wireformat: 'mls_key_package', version: 'mls10' });
}

function serializeState(state: ClientState): Uint8Array {
  return encodeGroupState(state);
}

function deserializeState(bytes: Uint8Array): ClientState {
  const decoded = decodeGroupState(bytes, 0);
  if (!decoded) throw new Error('failed to decode group state');
  const [groupState] = decoded;
  // encodeGroupState persists only the GroupState; reattach the (non-serializable) default config.
  return { ...groupState, clientConfig: defaultClientConfig };
}

class TsMlsProvider implements MlsProvider {
  constructor(private readonly impl: CiphersuiteImpl) {}

  get ciphersuite(): CiphersuiteName {
    return this.impl.name;
  }

  async generateKeyPackage(identity: Uint8Array): Promise<KeyPackageBundle> {
    const credential: Credential = { credentialType: 'basic', identity };
    const { publicPackage, privatePackage } = await mlsGenerateKeyPackage(
      credential,
      defaultCapabilities(),
      defaultLifetime,
      [],
      this.impl,
    );
    return { publicPackage: encodeKeyPackageWire(publicPackage), privatePackage: packPrivate(privatePackage) };
  }

  async createGroup(groupId: Uint8Array, self: KeyPackageBundle): Promise<Uint8Array> {
    const state = await mlsCreateGroup(
      groupId,
      decodeKeyPackage(self.publicPackage),
      unpackPrivate(self.privatePackage),
      [],
      this.impl,
    );
    return serializeState(state);
  }

  async addMember(groupState: Uint8Array, peerKeyPackage: Uint8Array): Promise<AddResult> {
    const state = deserializeState(groupState);
    const proposal: Proposal = { proposalType: 'add', add: { keyPackage: decodeKeyPackage(peerKeyPackage) } };
    const res = await createCommit({ state, cipherSuite: this.impl }, { extraProposals: [proposal], ratchetTreeExtension: true });
    res.consumed.forEach(zeroOutUint8Array);
    if (!res.welcome) throw new Error('Add commit produced no Welcome');
    return {
      groupState: serializeState(res.newState),
      welcome: encodeMlsMessage({ welcome: res.welcome, wireformat: 'mls_welcome', version: 'mls10' }),
      commit: encodeMlsMessage(res.commit),
    };
  }

  async startDm(groupId: Uint8Array, self: KeyPackageBundle, peerKeyPackage: Uint8Array): Promise<DmInvite> {
    const created = await mlsCreateGroup(
      groupId,
      decodeKeyPackage(self.publicPackage),
      unpackPrivate(self.privatePackage),
      [],
      this.impl,
    );
    const proposal: Proposal = { proposalType: 'add', add: { keyPackage: decodeKeyPackage(peerKeyPackage) } };
    const res = await createCommit({ state: created, cipherSuite: this.impl }, { extraProposals: [proposal], ratchetTreeExtension: true });
    res.consumed.forEach(zeroOutUint8Array);
    if (!res.welcome) throw new Error('DM commit produced no Welcome');
    return {
      groupState: serializeState(res.newState),
      welcome: encodeMlsMessage({ welcome: res.welcome, wireformat: 'mls_welcome', version: 'mls10' }),
    };
  }

  async joinGroup(welcome: Uint8Array, self: KeyPackageBundle): Promise<Uint8Array> {
    const decoded = decodeMlsMessage(welcome, 0);
    if (!decoded) throw new Error('failed to decode Welcome');
    const [msg] = decoded;
    if (msg.wireformat !== 'mls_welcome') throw new Error(`expected mls_welcome, got ${msg.wireformat}`);
    // The committer set ratchetTreeExtension, so the Welcome is self-contained (no external tree needed).
    const state = await mlsJoinGroup(
      msg.welcome,
      decodeKeyPackage(self.publicPackage),
      unpackPrivate(self.privatePackage),
      emptyPskIndex,
      this.impl,
    );
    return serializeState(state);
  }

  async encrypt(groupState: Uint8Array, plaintext: Uint8Array): Promise<EncryptResult> {
    const state = deserializeState(groupState);
    const res = await createApplicationMessage(state, plaintext, this.impl);
    res.consumed.forEach(zeroOutUint8Array);
    const ciphertext = encodeMlsMessage({ privateMessage: res.privateMessage, wireformat: 'mls_private_message', version: 'mls10' });
    return { groupState: serializeState(res.newState), ciphertext };
  }

  async decrypt(groupState: Uint8Array, ciphertext: Uint8Array): Promise<DecryptResult> {
    const state = deserializeState(groupState);
    const decoded = decodeMlsMessage(ciphertext, 0);
    if (!decoded) throw new Error('failed to decode MLS message');
    const [msg] = decoded;
    if (msg.wireformat !== 'mls_private_message' && msg.wireformat !== 'mls_public_message') {
      throw new Error(`unexpected wireformat ${msg.wireformat}`);
    }
    const result = await processMessage(msg, state, emptyPskIndex, acceptAll, this.impl);
    result.consumed.forEach(zeroOutUint8Array);
    if (result.kind === 'applicationMessage') {
      return { type: 'application', groupState: serializeState(result.newState), plaintext: result.message };
    }
    return { type: 'handshake', groupState: serializeState(result.newState) };
  }
}

/** Resolve the ciphersuite impl once and return a stateless provider bound to it. */
export async function createMlsProvider(name: CiphersuiteName = MLS_CIPHERSUITE): Promise<MlsProvider> {
  const impl = await getCiphersuiteImpl(getCiphersuiteFromName(name));
  return new TsMlsProvider(impl);
}
