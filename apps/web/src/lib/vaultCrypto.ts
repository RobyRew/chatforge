/**
 * Vault encryption. Two modes; the server only ever sees ciphertext either way:
 *  - **device** — a non-extractable AES-256-GCM key kept in this browser's IndexedDB. Zero prompts,
 *    but decrypts only on the device that saved it. Envelope tag `d1:` (legacy items have no tag).
 *  - **passphrase** — an AES-256-GCM key derived from your vault passphrase via PBKDF2-SHA256
 *    (600k iters) and a per-user salt fetched from the server, cached in memory for the session.
 *    Works across all your devices. Envelope tag `p1:`.
 */
import { api } from './api';

const DB_NAME = 'chatforge-vault';
const STORE = 'keys';
const KEY_ID = 'device';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('vault keystore open failed'));
  });
}
function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let cachedDeviceKey: CryptoKey | undefined;
async function deviceKey(): Promise<CryptoKey> {
  if (cachedDeviceKey) return cachedDeviceKey;
  const db = await openDb();
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) {
    cachedDeviceKey = existing;
    return existing;
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idbPut(db, KEY_ID, key);
  cachedDeviceKey = key;
  return key;
}

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

// ── passphrase mode (session-cached) ──
let passKey: CryptoKey | undefined;

export async function vaultPassphraseEnabled(): Promise<boolean> {
  return (await api.vaultSalt()) !== null;
}
export function isVaultUnlocked(): boolean {
  return passKey !== undefined;
}
export function lockVault(): void {
  passKey = undefined;
}

/** Set up (first time) or unlock the passphrase vault for this session. */
export async function unlockVault(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('passphrase required');
  const salt = new Uint8Array(fromB64(await api.ensureVaultSalt())); // fresh ArrayBuffer-backed (strict BufferSource)
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  passKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── AES-GCM core + mode dispatch ──
export type VaultMode = 'device' | 'passphrase';

async function aesEncrypt(key: CryptoKey, value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}
async function aesDecrypt<T>(key: CryptoKey, b64: string): Promise<T> {
  const buf = fromB64(b64);
  const iv = new Uint8Array(buf.subarray(0, 12));
  const ct = new Uint8Array(buf.subarray(12));
  const data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

export async function vaultEncrypt(value: unknown, mode: VaultMode): Promise<string> {
  if (mode === 'passphrase') {
    if (!passKey) throw new Error('vault is locked — unlock it in Settings');
    return `p1:${await aesEncrypt(passKey, value)}`;
  }
  return `d1:${await aesEncrypt(await deviceKey(), value)}`;
}

export async function vaultDecrypt<T>(envelope: string): Promise<T> {
  if (envelope.startsWith('p1:')) {
    if (!passKey) throw new Error('vault is locked — unlock it in Settings');
    return aesDecrypt<T>(passKey, envelope.slice(3));
  }
  const b64 = envelope.startsWith('d1:') ? envelope.slice(3) : envelope; // legacy = raw device
  return aesDecrypt<T>(await deviceKey(), b64);
}

/** Which mode an envelope was created with (so the UI can require unlock before opening). */
export function envelopeMode(envelope: string): VaultMode {
  return envelope.startsWith('p1:') ? 'passphrase' : 'device';
}
