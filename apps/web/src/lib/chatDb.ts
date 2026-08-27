/**
 * IndexedDB persistence for chat. Three stores:
 *  - `bundles`  — my unused KeyPackage private halves (to join Welcomes addressed to me)
 *  - `groups`   — per-conversation MLS group state (the ratchet); written by the worker
 *  - `messages` — locally-decrypted plaintext (MLS is forward-secret, so history can't be
 *                 re-decrypted later — we cache the cleartext on this device only)
 *
 * The worker owns `bundles` + `groups`; the main thread owns `messages`. The DB is origin-isolated;
 * the server never sees any of it.
 */
const DB_NAME = 'chatforge-chat';
const DB_VERSION = 2;

export interface StoredBundle {
  id?: number;
  pub: Uint8Array;
  priv: Uint8Array;
}

export interface StoredMessage {
  key: string; // `${conversationId}:${seq}`
  conversationId: string;
  seq: number;
  senderId: string;
  text: string;
  ts: number;
  replyTo?: { seq: number; text: string; senderId: string };
  reactions?: { emoji: string; by: string[] }[];
  /** Attachment reference incl. its decryption key — the ciphertext itself stays in object storage. */
  attachment?: import('./attachments').AttachmentRef;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('bundles')) db.createObjectStore('bundles', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups'); // key = conversationId
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'key' });
        store.createIndex('byConversation', 'conversationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('cursors')) db.createObjectStore('cursors'); // conversationId -> last processed seq
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
      }),
  );
}

// ── bundles (worker) ──
export const addBundle = (b: StoredBundle): Promise<IDBValidKey> => tx('bundles', 'readwrite', (s) => s.add(b));
export const allBundles = (): Promise<StoredBundle[]> => tx('bundles', 'readonly', (s) => s.getAll() as IDBRequest<StoredBundle[]>);
export const deleteBundle = (id: number): Promise<undefined> => tx('bundles', 'readwrite', (s) => s.delete(id));

// ── groups (worker) ──
export const getGroup = (conversationId: string): Promise<Uint8Array | undefined> =>
  tx('groups', 'readonly', (s) => s.get(conversationId) as IDBRequest<Uint8Array | undefined>);
export const putGroup = (conversationId: string, state: Uint8Array): Promise<IDBValidKey> =>
  tx('groups', 'readwrite', (s) => s.put(state, conversationId));

// ── messages (main thread) ──
export const putMessage = (m: StoredMessage): Promise<IDBValidKey> => tx('messages', 'readwrite', (s) => s.put(m));
export function getMessages(conversationId: string): Promise<StoredMessage[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredMessage[]>((resolve, reject) => {
        const req = db.transaction('messages', 'readonly').objectStore('messages').index('byConversation').getAll(conversationId);
        req.onsuccess = () => resolve((req.result as StoredMessage[]).sort((a, b) => a.seq - b.seq));
        req.onerror = () => reject(req.error ?? new Error('indexedDB getAll failed'));
      }),
  );
}

// ── cursors (main thread): highest server `seq` already processed per conversation ──
export const getCursor = (conversationId: string): Promise<number | undefined> =>
  tx('cursors', 'readonly', (s) => s.get(conversationId) as IDBRequest<number | undefined>);
export const setCursor = (conversationId: string, seq: number): Promise<IDBValidKey> =>
  tx('cursors', 'readwrite', (s) => s.put(seq, conversationId));
