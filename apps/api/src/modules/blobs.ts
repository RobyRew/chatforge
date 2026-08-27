import { Hono } from 'hono';
import { loadEnv } from '../env';
import { requireAuth, requirePermission, type SessionUser, type Vars } from '../middleware';
import { getBlobRepo, type BlobKind, type BlobRecord } from '../storage/blobRepo';
import { getBlobStore } from '../storage/blobStore';

/**
 * Blob storage (P3) — chat attachments + profile pictures.
 *
 * **Attachments are opaque.** The browser encrypts the file (AES-256-GCM) before upload and puts the
 * key inside the MLS payload, so what arrives here is ciphertext with no filename and no MIME type.
 * The server's only jobs are access control (upload/read requires membership of the conversation the
 * blob is scoped to), accounting (per-user quota) and abuse limits.
 *
 * **Avatars are plaintext** — the deliberate exception (ADR-0024): they are profile data like
 * `name`/`bio`, which the server already stores in the clear. They are therefore validated hard:
 * magic-byte sniffed against a raster-image allowlist (no SVG — it can carry script), served with
 * `nosniff` + a `default-src 'none'` CSP, and capped at 2 MB.
 */
export const blobsModule = new Hono<Vars>();

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-user upload rate limit (token bucket): a burst of 20, refilling one every 3s.
const UPLOAD_BURST = 20;
const UPLOAD_REFILL_PER_SEC = 1 / 3;
const uploadBuckets = new Map<string, { tokens: number; last: number }>();

function allowUpload(userId: string): boolean {
  const now = Date.now();
  const b = uploadBuckets.get(userId) ?? { tokens: UPLOAD_BURST, last: now };
  b.tokens = Math.min(UPLOAD_BURST, b.tokens + ((now - b.last) / 1000) * UPLOAD_REFILL_PER_SEC);
  b.last = now;
  uploadBuckets.set(userId, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/** Raster-image allowlist by magic bytes. SVG is intentionally absent (scriptable). */
function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp';
  return null;
}

/** Read the raw request body, refusing anything over `max` *before* buffering when we can. */
async function readBody(c: { req: { header(name: string): string | undefined; arrayBuffer(): Promise<ArrayBuffer> } }, max: number): Promise<Uint8Array | 'too-large' | 'empty'> {
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > max) return 'too-large';
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength === 0) return 'empty';
  if (buf.byteLength > max) return 'too-large'; // chunked upload without a Content-Length
  return buf;
}

/** Store bytes + record, enforcing the per-user quota. Cleans up the object if the insert fails. */
async function store(me: SessionUser, kind: BlobKind, bytes: Uint8Array, opts: { conversationId: string | null; contentType: string | null }): Promise<{ ok: true; record: BlobRecord } | { ok: false; status: 413 | 503; error: string }> {
  const blobStore = getBlobStore();
  if (!blobStore) return { ok: false, status: 503, error: 'object storage is not configured' };

  const repo = getBlobRepo();
  const { blobQuotaBytes } = loadEnv();
  const used = await repo.usedBytes(me.id);
  if (used + bytes.byteLength > blobQuotaBytes) return { ok: false, status: 413, error: 'storage quota exceeded' };

  const objectKey = `${kind}s/${crypto.randomUUID()}`;
  await blobStore.put(objectKey, bytes, { contentType: opts.contentType ?? 'application/octet-stream', contentLength: bytes.byteLength });
  try {
    const record = await repo.create({ ownerId: me.id, kind, conversationId: opts.conversationId, contentType: opts.contentType, objectKey, size: bytes.byteLength });
    return { ok: true, record };
  } catch (err) {
    await blobStore.delete(objectKey).catch(() => undefined); // don't leak an orphan object
    throw err;
  }
}

/** Upload one encrypted chat attachment, scoped to a conversation the caller belongs to. */
blobsModule.post('/attachments/:conversationId', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const conversationId = c.req.param('conversationId');
  if (!UUID_RE.test(conversationId)) return c.json({ error: 'invalid conversation id' }, 400);
  if (!allowUpload(me.id)) return c.json({ error: 'too many uploads — slow down' }, 429);

  const { getChatRepo } = await import('../chat/repo');
  if (!(await getChatRepo().isMember(conversationId, me.id))) return c.json({ error: 'not a member of that conversation' }, 403);

  const body = await readBody(c, MAX_ATTACHMENT_BYTES);
  if (body === 'too-large') return c.json({ error: `attachment exceeds ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB` }, 413);
  if (body === 'empty') return c.json({ error: 'empty body' }, 400);

  const res = await store(me, 'attachment', body, { conversationId, contentType: null });
  if (!res.ok) return c.json({ error: res.error }, res.status);
  return c.json({ id: res.record.id, size: res.record.size }, 201);
});

/** Upload a profile picture. Returns the URL to put in `POST /api/me/profile { image }`. */
blobsModule.post('/avatar', requireAuth(), async (c) => {
  const me = c.get('user')!;
  if (!allowUpload(me.id)) return c.json({ error: 'too many uploads — slow down' }, 429);

  const body = await readBody(c, MAX_AVATAR_BYTES);
  if (body === 'too-large') return c.json({ error: 'image exceeds 2 MB' }, 413);
  if (body === 'empty') return c.json({ error: 'empty body' }, 400);

  const contentType = sniffImage(body);
  if (!contentType) return c.json({ error: 'unsupported image — use PNG, JPEG, GIF or WebP' }, 415);

  const res = await store(me, 'avatar', body, { conversationId: null, contentType });
  if (!res.ok) return c.json({ error: res.error }, res.status);
  return c.json({ id: res.record.id, size: res.record.size, url: `/api/blobs/${res.record.id}` }, 201);
});

/** Download a blob. Attachments require conversation membership; avatars require a session. */
blobsModule.get('/:id', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404);

  const record = await getBlobRepo().get(id);
  if (!record) return c.json({ error: 'not found' }, 404);

  if (record.kind === 'attachment') {
    // Membership — not ownership: both sides of the DM must be able to read the attachment.
    const { getChatRepo } = await import('../chat/repo');
    const allowed = !!record.conversationId && (await getChatRepo().isMember(record.conversationId, me.id));
    if (!allowed) return c.json({ error: 'not found' }, 404); // don't confirm the id exists
  }

  const blobStore = getBlobStore();
  if (!blobStore) return c.json({ error: 'object storage is not configured' }, 503);
  const object = await blobStore.get(record.objectKey);
  if (!object) return c.json({ error: 'not found' }, 404);

  const isAvatar = record.kind === 'avatar';
  return new Response(object.stream, {
    headers: {
      'Content-Type': isAvatar ? (record.contentType ?? 'application/octet-stream') : 'application/octet-stream',
      'Content-Length': String(record.size),
      // Blobs are immutable (a new upload gets a new id), so they cache hard — but privately: the
      // bytes are user data behind an authorization check, never for a shared/proxy cache.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': isAvatar ? 'inline' : 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});

/** Delete a blob you own. */
blobsModule.delete('/:id', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404);

  const repo = getBlobRepo();
  const record = await repo.get(id);
  if (!record || record.ownerId !== me.id) return c.json({ error: 'not found' }, 404);

  await getBlobStore()?.delete(record.objectKey).catch(() => undefined);
  await repo.delete(id);
  return c.json({ ok: true });
});

/**
 * Best-effort cleanup of a replaced avatar: only deletes a blob this user owns, of kind `avatar`,
 * addressed by our own `/api/blobs/<uuid>` URL shape. Anything else (an external URL, someone
 * else's blob) is left untouched.
 */
export async function deleteOwnAvatarByUrl(userId: string, url: string | null | undefined): Promise<void> {
  const id = typeof url === 'string' ? /^\/api\/blobs\/([0-9a-f-]{36})$/i.exec(url)?.[1] : undefined;
  if (!id) return;
  const repo = getBlobRepo();
  const record = await repo.get(id).catch(() => null);
  if (!record || record.ownerId !== userId || record.kind !== 'avatar') return;
  await getBlobStore()?.delete(record.objectKey).catch(() => undefined);
  await repo.delete(id).catch(() => undefined);
}
