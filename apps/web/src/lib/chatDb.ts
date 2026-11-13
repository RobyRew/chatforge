/**
 * IndexedDB persistence for chat, one database per account: `chatforge-chat:<userId>` (ADR-0034).
 * Stores:
 *  - `bundles`  — my unused KeyPackage private halves (to join Welcomes addressed to me)
 *  - `groups`   — per-conversation MLS group state (the ratchet); written by the worker
 *  - `messages` — locally-decrypted plaintext (MLS is forward-secret, so history can't be
 *                 re-decrypted later — we cache the cleartext on this device only)
 *  - `cursors`  — per conversation, the highest server `seq` processed
 *  - `verifications` — the safety number the user last confirmed, per conversation
 *  - `outbox`   — encrypted frames the server has not confirmed yet, sent oldest first
 *  - `meta`     — bookkeeping for this database (whether the shared database was migrated)
 *
 * The worker owns `bundles` + `groups`; the main thread owns the rest. Each realm calls `setChatDbUser`
 * before touching storage. The DB is origin-isolated; the server never sees any of it.
 *
 * Until ADR-0034 every account signed in on a browser shared one database, `chatforge-chat`: decrypted
 * messages, group state and KeyPackage private halves of all of them, left behind at sign-out.
 * `migrateLegacyChatDb` moves an account's records out of it.
 */
import type { AttachmentRef } from './attachments';

const LEGACY_DB_NAME = 'chatforge-chat';
const DB_VERSION = 1;

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
  attachment?: AttachmentRef;
}

/** A safety number the user confirmed out-of-band, so a later change can be detected. */
export interface StoredVerification {
  safetyNumber: string;
  verifiedAt: number;
}

/**
 * An encrypted frame waiting for the server's `delivered`. Kept until then, so a message typed while the
 * socket was down — or a group commit — is sent after a reconnect or a reload instead of being dropped.
 */
export interface OutboxEntry {
  clientId: string;
  conversationId: string;
  ciphertext: string;
  blobIds?: string[];
  kind: 'message' | 'reaction' | 'commit';
  createdAt: number;
  attempts: number;
  /** Set when a message gave up after its attempts; it stays until the user retries or deletes it. */
  failed?: boolean;
  /** For `message` entries: what the pending bubble shows after a reload. */
  ui?: { text: string; ts: number; replyTo?: { seq: number; text: string; senderId: string }; attachment?: AttachmentRef };
}

export function chatDbName(userId: string): string {
  return `${LEGACY_DB_NAME}:${userId}`;
}

let dbName: string | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
/** A database this realm saw being deleted (sign-out in another tab): never reopened, so never recreated. */
let deletedName: string | null = null;

/** Point this realm's storage at the account's database. Call before any other function here. */
export function setChatDbUser(userId: string): void {
  const name = chatDbName(userId);
  if (name === dbName) return;
  closeChatDb();
  dbName = name;
}

/** Close this realm's connection (it reopens on the next call). */
export function closeChatDb(): void {
  const p = dbPromise;
  dbPromise = null;
  void p?.then((db) => db.close()).catch(() => undefined);
}

function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('bundles')) db.createObjectStore('bundles', { keyPath: 'id', autoIncrement: true });
  if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups'); // key = conversationId
  if (!db.objectStoreNames.contains('messages')) {
    const store = db.createObjectStore('messages', { keyPath: 'key' });
    store.createIndex('byConversation', 'conversationId', { unique: false });
  }
  if (!db.objectStoreNames.contains('cursors')) db.createObjectStore('cursors'); // conversationId -> last processed seq
  if (!db.objectStoreNames.contains('verifications')) db.createObjectStore('verifications'); // conversationId -> StoredVerification
  if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'clientId' });
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const name = dbName;
  if (!name) return Promise.reject(new Error('chat storage used before setChatDbUser'));
  if (name === deletedName) return Promise.reject(new Error("this account's chat data was removed from this browser"));
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => createStores(req.result);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab deleting this database (sign-out with "remove my chats") waits for every open
      // connection to close; close ours instead of blocking it. A deletion (newVersion null) also stops
      // this realm from reopening it, which would recreate it empty on the next write.
      db.onversionchange = (ev) => {
        db.close();
        if (dbPromise === p) dbPromise = null;
        if (ev.newVersion === null) deletedName = name;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
  dbPromise = p;
  p.catch(() => {
    if (dbPromise === p) dbPromise = null; // a failed open is retried by the next call
  });
  return p;
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

/** Purge a locally-cached plaintext (a message deleted for everyone). */
export const deleteMessage = (conversationId: string, seq: number): Promise<undefined> =>
  tx('messages', 'readwrite', (s) => s.delete(`${conversationId}:${seq}`));

// ── verifications (main thread): the safety number the user last confirmed, per conversation ──
export const getVerification = (conversationId: string): Promise<StoredVerification | undefined> =>
  tx('verifications', 'readonly', (s) => s.get(conversationId) as IDBRequest<StoredVerification | undefined>);
export const putVerification = (conversationId: string, v: StoredVerification): Promise<IDBValidKey> =>
  tx('verifications', 'readwrite', (s) => s.put(v, conversationId));

// ── cursors (main thread): highest server `seq` already processed per conversation ──
export const getCursor = (conversationId: string): Promise<number | undefined> =>
  tx('cursors', 'readonly', (s) => s.get(conversationId) as IDBRequest<number | undefined>);
export const setCursor = (conversationId: string, seq: number): Promise<IDBValidKey> =>
  tx('cursors', 'readwrite', (s) => s.put(seq, conversationId));

// ── outbox (main thread): frames awaiting the server's `delivered`, oldest first ──
export const putOutbox = (e: OutboxEntry): Promise<IDBValidKey> => tx('outbox', 'readwrite', (s) => s.put(e));
export const deleteOutbox = (clientId: string): Promise<undefined> => tx('outbox', 'readwrite', (s) => s.delete(clientId));
export const allOutbox = (): Promise<OutboxEntry[]> =>
  tx('outbox', 'readonly', (s) => s.getAll() as IDBRequest<OutboxEntry[]>).then((l) => l.sort((a, b) => a.createdAt - b.createdAt));

// ── deleting an account's local chat data ──

/**
 * Delete the account's database. Open connections in other tabs close themselves (`onversionchange`);
 * one that does not (a tab still on an older build) holds the delete, so this resolves after a few
 * seconds either way and reports whether the browser confirmed it.
 */
export function deleteChatDb(userId: string): Promise<boolean> {
  const name = chatDbName(userId);
  if (name === dbName) closeChatDb();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 4000);
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(true);
    };
    req.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}

// ── the database every account shared before ADR-0034 ──

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('indexedDB transaction failed'));
    t.onabort = () => reject(t.error ?? new Error('indexedDB transaction aborted'));
  });
}

/** Open the shared database if it exists; never creates it. */
async function openLegacy(): Promise<IDBDatabase | null> {
  if (typeof indexedDB.databases === 'function') {
    const list = await indexedDB.databases().catch(() => null);
    if (list && !list.some((d) => d.name === LEGACY_DB_NAME)) return null;
  }
  return new Promise((resolve) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    let created = false;
    req.onupgradeneeded = () => {
      // It did not exist: abort, so this check leaves nothing behind.
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      if (created) indexedDB.deleteDatabase(LEGACY_DB_NAME);
      resolve(null);
    };
  });
}

async function storeEntries<V>(db: IDBDatabase, store: string): Promise<Array<[IDBValidKey, V]>> {
  if (!db.objectStoreNames.contains(store)) return [];
  const s = db.transaction(store, 'readonly').objectStore(store);
  const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll() as IDBRequest<V[]>)]);
  return keys.map((k, i) => [k, values[i] as V]);
}

/** This account's share of the shared database: its conversations' records, and every bundle. */
interface LegacyShare {
  bundles: Array<[IDBValidKey, StoredBundle]>;
  groups: Array<[IDBValidKey, Uint8Array]>;
  messages: StoredMessage[];
  cursors: Array<[IDBValidKey, number]>;
  verifications: Array<[IDBValidKey, StoredVerification]>;
  /** Conversation records (groups + messages) of other accounts, or of nobody known, left behind. */
  othersLeft: number;
}

/**
 * Ownership comes from the server and from the records: the conversations the account belongs to, plus any
 * conversation holding a message the account sent (one it has since left).
 */
async function readLegacyShare(legacy: IDBDatabase, userId: string, conversationIds: string[]): Promise<LegacyShare> {
  const bundles = await storeEntries<StoredBundle>(legacy, 'bundles');
  const groups = await storeEntries<Uint8Array>(legacy, 'groups');
  const messages = (await storeEntries<StoredMessage>(legacy, 'messages')).map(([, m]) => m);
  const cursors = await storeEntries<number>(legacy, 'cursors');
  const verifications = await storeEntries<StoredVerification>(legacy, 'verifications');
  const mine = new Set(conversationIds);
  for (const m of messages) if (m.senderId === userId) mine.add(m.conversationId);
  const own = <V,>(entries: Array<[IDBValidKey, V]>): Array<[IDBValidKey, V]> => entries.filter(([k]) => typeof k === 'string' && mine.has(k));
  const myGroups = own(groups);
  const myMessages = messages.filter((m) => mine.has(m.conversationId));
  return {
    bundles,
    groups: myGroups,
    messages: myMessages,
    cursors: own(cursors),
    verifications: own(verifications),
    othersLeft: groups.length - myGroups.length + (messages.length - myMessages.length),
  };
}

/** Delete an account's records from the shared database (and, with `bundles`, every bundle in it). */
async function removeLegacyShare(legacy: IDBDatabase, share: LegacyShare, bundles: boolean): Promise<void> {
  const stores = ['groups', 'messages', 'cursors', 'verifications', ...(bundles ? ['bundles'] : [])].filter((s) => legacy.objectStoreNames.contains(s));
  if (!stores.length) return;
  const d = legacy.transaction(stores, 'readwrite');
  if (stores.includes('groups')) for (const [k] of share.groups) d.objectStore('groups').delete(k);
  if (stores.includes('messages')) for (const m of share.messages) d.objectStore('messages').delete(m.key);
  if (stores.includes('cursors')) for (const [k] of share.cursors) d.objectStore('cursors').delete(k);
  if (stores.includes('verifications')) for (const [k] of share.verifications) d.objectStore('verifications').delete(k);
  if (stores.includes('bundles')) d.objectStore('bundles').clear();
  await done(d);
}

/**
 * Delete the shared database. If a tab still on the build before ADR-0034 has it open, the browser deletes
 * it once that tab closes, and anything that tab writes until then is not carried over.
 */
function deleteLegacyDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    const finish = (): void => resolve();
    req.onsuccess = finish;
    req.onerror = finish;
    req.onblocked = finish;
  });
}

/**
 * Move this account's records out of the shared pre-ADR-0034 database into its own.
 *
 * KeyPackage bundles carry no owner readable here, so all of them are copied: a bundle of another account
 * cannot open this account's Welcomes, and dropping this account's own would leave KeyPackages on the
 * server that nobody can join with. The shared database is deleted once it holds no conversation records;
 * an account whose bundles went with it publishes new KeyPackages on its next start (chatClient.start finds
 * none locally). Until then it stays for the other accounts that used this browser.
 *
 * Runs once per account database (a flag in `meta`). Returns the number of conversations moved, or null
 * when there was nothing to migrate.
 */
export async function migrateLegacyChatDb(userId: string, conversationIds: string[]): Promise<number | null> {
  const target = await openDb();
  if (await request(target.transaction('meta', 'readonly').objectStore('meta').get('legacyMigrated'))) return null;
  const legacy = await openLegacy();
  if (!legacy) {
    await tx('meta', 'readwrite', (s) => s.put(true, 'legacyMigrated'));
    return null;
  }
  let share: LegacyShare;
  try {
    share = await readLegacyShare(legacy, userId, conversationIds);
    const w = target.transaction(['bundles', 'groups', 'messages', 'cursors', 'verifications', 'meta'], 'readwrite');
    for (const [, b] of share.bundles) w.objectStore('bundles').add({ pub: b.pub, priv: b.priv }); // fresh ids: no clash with this DB's own
    for (const [k, g] of share.groups) w.objectStore('groups').put(g, k);
    for (const m of share.messages) w.objectStore('messages').put(m);
    for (const [k, c] of share.cursors) w.objectStore('cursors').put(c, k);
    for (const [k, v] of share.verifications) w.objectStore('verifications').put(v, k);
    w.objectStore('meta').put(true, 'legacyMigrated');
    await done(w);
    // Only after the copy is committed: take this account's records out of the shared database.
    await removeLegacyShare(legacy, share, false);
  } finally {
    legacy.close();
  }
  if (share.othersLeft === 0) await deleteLegacyDb();
  return new Set([...share.groups.map(([k]) => k as string), ...share.messages.map((m) => m.conversationId)]).size;
}

/**
 * For "remove my chats from this browser": delete this account's records from the shared pre-ADR-0034
 * database, whether or not they were migrated, and every bundle in it (they carry no readable owner; an
 * account whose bundles go publishes new KeyPackages on its next start). The shared database is deleted
 * once it holds no conversation records.
 */
export async function purgeLegacyChatDb(userId: string, conversationIds: string[]): Promise<void> {
  const legacy = await openLegacy();
  if (!legacy) return;
  let share: LegacyShare;
  try {
    share = await readLegacyShare(legacy, userId, conversationIds);
    await removeLegacyShare(legacy, share, true);
  } finally {
    legacy.close();
  }
  if (share.othersLeft === 0) await deleteLegacyDb();
}
