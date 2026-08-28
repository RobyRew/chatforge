import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdminRepo } from '../src/admin/memoryRepo';
import { setAdminRepo } from '../src/admin/repo';
import { createApp } from '../src/app';
import { MemoryChatRepo } from '../src/chat/memoryRepo';
import { setChatRepo } from '../src/chat/repo';
import { getBlobRepo, MemoryBlobRepo, setBlobRepo } from '../src/storage/blobRepo';
import { MemoryBlobStore, setBlobStore } from '../src/storage/blobStore';
import { stores } from '../src/stores';

// Seeded dev users (middleware bearer fallback): u_owner=owner-token, u_user=user-token. `u_third`
// is an outsider used to prove attachments are gated on conversation membership, not just on a session.
const OWNER = 'owner-token';
const USER = 'user-token';
const THIRD = 'third-token';
stores.users.set('u_third', { id: 'u_third', email: 'third@chatforge.local', role: 'user', status: 'active', createdAt: Date.now() });
stores.sessions.set(THIRD, 'u_third');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const CIPHERTEXT = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

const app = createApp();
let chat: MemoryChatRepo;
let conversationId: string;

beforeEach(async () => {
  setAdminRepo(new MemoryAdminRepo());
  setBlobRepo(new MemoryBlobRepo());
  setBlobStore(new MemoryBlobStore());
  chat = new MemoryChatRepo();
  setChatRepo(chat);
  conversationId = (await chat.createDm('u_owner', 'u_user')).id;
});

afterEach(() => {
  delete process.env['BLOB_QUOTA_BYTES'];
});

async function upload(path: string, bytes: Uint8Array, token: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: bytes });
}
const send = async (path: string, method: string, token: string): Promise<Response> =>
  app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describe('blobs — attachments (E2E ciphertext, membership-scoped)', () => {
  it('accepts an upload from a member and serves it back byte-for-byte to the peer', async () => {
    const res = await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER);
    expect(res.status).toBe(201);
    const { id, size } = await json<{ id: string; size: number }>(res);
    expect(size).toBe(CIPHERTEXT.byteLength);

    const got = await send(`/api/blobs/${id}`, 'GET', USER); // the *other* member reads it
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(CIPHERTEXT);
    // Opaque to the server: no filename, no real MIME type, never rendered inline.
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(got.headers.get('content-disposition')).toBe('attachment');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuses an upload scoped to a conversation the caller is not in', async () => {
    const res = await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, THIRD);
    expect(res.status).toBe(403);
  });

  it('hides an attachment from a non-member (404, not 403 — never confirms the id)', async () => {
    const { id } = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    expect((await send(`/api/blobs/${id}`, 'GET', THIRD)).status).toBe(404);
  });

  it('requires a session', async () => {
    const { id } = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    expect((await app.request(`/api/blobs/${id}`, { method: 'GET' })).status).toBe(401);
  });

  it('rejects a malformed conversation id before touching the repo', async () => {
    const res = await upload('/api/blobs/attachments/not-a-uuid', CIPHERTEXT, OWNER);
    expect(res.status).toBe(400);
  });

  it('rejects an oversized upload from the declared Content-Length, before buffering', async () => {
    const res = await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER, { 'content-length': String(64 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('enforces the per-user storage quota', async () => {
    process.env['BLOB_QUOTA_BYTES'] = '12';
    expect((await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER)).status).toBe(201);
    const second = await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER);
    expect(second.status).toBe(413);
    expect((await json<{ error: string }>(second)).error).toMatch(/quota/);
  });
});

describe('blobs — avatars (plaintext profile data, hard-validated)', () => {
  it('accepts a PNG and serves it inline with its sniffed type', async () => {
    const res = await upload('/api/blobs/avatar', PNG, USER);
    expect(res.status).toBe(201);
    const { id, url } = await json<{ id: string; url: string }>(res);
    expect(url).toBe(`/api/blobs/${id}`);

    const got = await send(url, 'GET', OWNER); // any signed-in user may render an avatar
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('content-disposition')).toBe('inline');
    expect(got.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('rejects SVG (and anything else that is not a raster image) by magic bytes', async () => {
    const res = await upload('/api/blobs/avatar', SVG, USER);
    expect(res.status).toBe(415);
  });

  it('rejects a raster type declared in the headers but not in the bytes', async () => {
    const res = await upload('/api/blobs/avatar', SVG, USER, { 'content-type': 'image/png' });
    expect(res.status).toBe(415);
  });
});

describe('blobs — lifecycle', () => {
  it('lets the owner delete and refuses everyone else', async () => {
    const { id } = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    expect((await send(`/api/blobs/${id}`, 'DELETE', USER)).status).toBe(404); // member, but not owner
    expect((await send(`/api/blobs/${id}`, 'DELETE', OWNER)).status).toBe(200);
    expect((await send(`/api/blobs/${id}`, 'GET', OWNER)).status).toBe(404);
  });

  it('answers 503 instead of accepting uploads it cannot persist', async () => {
    setBlobStore(null);
    expect((await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER)).status).toBe(503);
  });
});

describe('blobs — garbage collection', () => {
  it('reclaims a message attachment when the message is deleted', async () => {
    const { id } = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    const msg = await chat.appendMessage(conversationId, 'u_owner', 'ct');
    await getBlobRepo().linkToMessage([id], 'u_owner', conversationId, msg.seq);

    expect(await chat.deleteMessage(conversationId, msg.seq, 'u_owner')).toBe(true);
    const { deleteBlobsForMessage } = await import('../src/storage/blobGc');
    expect(await deleteBlobsForMessage(conversationId, msg.seq)).toBe(1);

    expect((await send(`/api/blobs/${id}`, 'GET', OWNER)).status).toBe(404);
  });

  it('refuses to delete someone else’s message', async () => {
    const msg = await chat.appendMessage(conversationId, 'u_owner', 'ct');
    expect(await chat.deleteMessage(conversationId, msg.seq, 'u_user')).toBe(false);
    expect(await chat.deleteMessage(conversationId, msg.seq, 'u_owner')).toBe(true);
    expect(await chat.deleteMessage(conversationId, msg.seq, 'u_owner')).toBe(false); // already gone
  });

  it('links only the sender’s own unattached blobs — an id belonging to someone else is ignored', async () => {
    const mine = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    const theirs = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, USER));
    const repo = getBlobRepo();
    // u_owner tries to claim u_user's blob alongside its own.
    await repo.linkToMessage([mine.id, theirs.id], 'u_owner', conversationId, 7);
    const linked = await repo.listForMessage(conversationId, 7);
    expect(linked.map((b) => b.id)).toEqual([mine.id]);
  });

  it('sweeps abandoned uploads but spares recent and attached ones', async () => {
    const repo = getBlobRepo();
    const recent = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    const attached = await json<{ id: string }>(await upload(`/api/blobs/attachments/${conversationId}`, CIPHERTEXT, OWNER));
    await repo.linkToMessage([attached.id], 'u_owner', conversationId, 42);

    // Nothing is old enough yet.
    const { sweepOrphans } = await import('../src/storage/blobGc');
    expect(await sweepOrphans()).toBe(0);
    expect(await repo.get(recent.id)).not.toBeNull();

    // Age the unattached one past the grace period.
    const rec = await repo.get(recent.id);
    (rec as { createdAt: number }).createdAt = Date.now() - 7 * 60 * 60 * 1000;
    expect(await sweepOrphans()).toBe(1);
    expect(await repo.get(recent.id)).toBeNull();
    expect(await repo.get(attached.id)).not.toBeNull(); // attached is never swept
  });
});
