/// <reference lib="webworker" />
/**
 * MLS chat worker. All key material + group state live here (and in this origin's IndexedDB) and
 * never touch the main thread or the network in plaintext. Operations are processed strictly
 * serially so the MLS ratchet is never mutated concurrently.
 */
import { createMlsProvider, type MlsProvider } from '@chatforge/crypto/mls';
import { addBundle, allBundles, deleteBundle, getGroup, putGroup } from '../lib/chatDb';
import type { ChatWorkerRequest, ChatWorkerResponse } from '../lib/chatProtocol';

const enc = new TextEncoder();
const dec = new TextDecoder();
let provider: MlsProvider | null = null;
let userId = '';

function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] ?? 0);
  return btoa(s);
}
function fromB64(b: string): Uint8Array {
  const bin = atob(b);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function mls(): Promise<MlsProvider> {
  if (!provider) provider = await createMlsProvider();
  return provider;
}

async function handle(req: ChatWorkerRequest): Promise<unknown> {
  const m = await mls();
  switch (req.type) {
    case 'init': {
      userId = req.userId;
      return {};
    }
    case 'generateKeyPackages': {
      const published: string[] = [];
      for (let i = 0; i < req.count; i++) {
        const kp = await m.generateKeyPackage(enc.encode(userId));
        await addBundle({ pub: kp.publicPackage, priv: kp.privatePackage });
        published.push(toB64(kp.publicPackage));
      }
      return { published };
    }
    case 'startDm': {
      const self = await m.generateKeyPackage(enc.encode(userId));
      const invite = await m.startDm(enc.encode(req.conversationId), self, fromB64(req.peerKeyPackage));
      await putGroup(req.conversationId, invite.groupState);
      return { welcome: toB64(invite.welcome) };
    }
    case 'join': {
      const welcome = fromB64(req.welcome);
      // The Welcome was encrypted to one of our published KeyPackages — try each until one works.
      for (const b of await allBundles()) {
        try {
          const groupState = await m.joinGroup(welcome, { publicPackage: b.pub, privatePackage: b.priv });
          await putGroup(req.conversationId, groupState);
          if (b.id !== undefined) await deleteBundle(b.id);
          return { joined: true };
        } catch {
          // wrong bundle — try the next
        }
      }
      return { joined: false };
    }
    case 'hasGroup': {
      return { has: (await getGroup(req.conversationId)) !== undefined };
    }
    case 'encrypt': {
      const state = await getGroup(req.conversationId);
      if (!state) throw new Error('no group state for conversation');
      const out = await m.encrypt(state, enc.encode(req.payload));
      await putGroup(req.conversationId, out.groupState);
      return { ciphertext: toB64(out.ciphertext) };
    }
    case 'decrypt': {
      const state = await getGroup(req.conversationId);
      if (!state) throw new Error('no group state for conversation');
      const res = await m.decrypt(state, fromB64(req.ciphertext));
      await putGroup(req.conversationId, res.groupState);
      if (res.type === 'application') return { kind: 'application', plaintext: dec.decode(res.plaintext) };
      return { kind: 'handshake' };
    }
  }
}

const ctx = self as unknown as Worker;
let queue: Promise<unknown> = Promise.resolve();

ctx.onmessage = (e: MessageEvent<ChatWorkerRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    try {
      const result = await handle(req);
      ctx.postMessage({ id: req.id, ok: true, result } satisfies ChatWorkerResponse);
    } catch (err) {
      ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ChatWorkerResponse);
    }
  });
};
