/**
 * Device-key encryption for the Vault (ADR: "device key now, passphrase later"). A non-extractable
 * AES-256-GCM key is generated once and kept in IndexedDB — it never leaves this browser, so the
 * server only ever stores ciphertext. (A future passphrase mode will use the `salt` column for
 * cross-device sync via Argon2id.)
 */
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

let cached: CryptoKey | undefined;
async function deviceKey(): Promise<CryptoKey> {
  if (cached) return cached;
  const db = await openDb();
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) {
    cached = existing;
    return existing;
  }
  // Non-extractable: the raw bytes can never be read out or exfiltrated, only used to en/decrypt.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idbPut(db, KEY_ID, key);
  cached = key;
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

/** Encrypt a JSON-serialisable value → base64 `iv ‖ ciphertext`. */
export async function vaultEncrypt(value: unknown): Promise<string> {
  const key = await deviceKey();
  const data = new TextEncoder().encode(JSON.stringify(value));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}

/** Decrypt base64 `iv ‖ ciphertext` produced by {@link vaultEncrypt} on this device. */
export async function vaultDecrypt<T>(b64: string): Promise<T> {
  const key = await deviceKey();
  const buf = fromB64(b64);
  // Copy into fresh ArrayBuffer-backed arrays (satisfies the strict BufferSource type).
  const iv = new Uint8Array(buf.subarray(0, 12));
  const ct = new Uint8Array(buf.subarray(12));
  const data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  return JSON.parse(new TextDecoder().decode(data)) as T;
}
