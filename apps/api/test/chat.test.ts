import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { ClientFrame, ServerFrame } from '@chatforge/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMlsProvider } from '@chatforge/crypto/mls';
import { MemoryAdminRepo } from '../src/admin/memoryRepo';
import { setAdminRepo } from '../src/admin/repo';
import { createApp } from '../src/app';
import { createChatGateway } from '../src/chat/gateway';
import { MemoryChatRepo } from '../src/chat/memoryRepo';
import { setChatRepo } from '../src/chat/repo';

const repo = new MemoryChatRepo();
setChatRepo(repo); // the REST chat module reads this singleton
setAdminRepo(new MemoryAdminRepo()); // resolveUser computes permissions via this repo (no DB)

const A = 'u_owner'; // bearer 'owner-token' (seeded role: owner)
const B = 'u_user'; // bearer 'user-token' (seeded role: user)
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

let server: ReturnType<typeof serve>;
let port: number;

beforeAll(async () => {
  const app = createApp();
  const started = await new Promise<{ s: ReturnType<typeof serve>; port: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0 }, (info) => resolve({ s, port: info.port }));
  });
  server = started.s;
  port = started.port;
  createChatGateway({
    server: server as unknown as Server,
    repo,
    authenticate: async (req) => new URL(req.url ?? '', 'http://x').searchParams.get('token'),
  });
});

afterAll(() => {
  (server as unknown as { close?: () => void }).close?.();
});

function rest(path: string, method: string, body: unknown, token: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function client(userId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${userId}`);
  const frames: ServerFrame[] = [];
  const waiters: Array<{ pred: (f: ServerFrame) => boolean; resolve: (f: ServerFrame) => void; timer: ReturnType<typeof setTimeout> }> = [];
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString()) as ServerFrame;
    frames.push(f);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i]!;
      if (w.pred(f)) {
        clearTimeout(w.timer);
        w.resolve(f);
        waiters.splice(i, 1);
      }
    }
  });
  const ready = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  const waitFor = (pred: (f: ServerFrame) => boolean, ms = 2000): Promise<ServerFrame> => {
    const found = frames.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for frame')), ms);
      waiters.push({ pred, resolve, timer });
    });
  };
  return {
    ws,
    ready,
    waitFor,
    send: (frame: ClientFrame) => ws.send(JSON.stringify(frame)),
    close: () => ws.close(),
  };
}

describe('chat gateway (in-process, MemoryChatRepo)', () => {
  it('relays messages + delivered + typing + read + presence over a DM', async () => {
    const res = await rest('/api/chat/conversations', 'POST', { userId: B }, 'owner-token');
    expect(res.status).toBe(200);
    const { conversationId } = (await res.json()) as { conversationId: string };
    expect(conversationId).toBeTruthy();

    const a = client(A);
    await a.ready;
    await delay(50); // let A register before B's presence broadcast

    const b = client(B);
    await b.ready;

    await a.waitFor((f) => f.t === 'presence' && f.userId === B && f.online);

    a.send({ t: 'sub', conversationId });
    b.send({ t: 'sub', conversationId });

    a.send({ t: 'send', conversationId, ciphertext: 'Y2lwaGVy', clientId: 'c1' });
    expect(await b.waitFor((f) => f.t === 'message')).toMatchObject({
      conversationId,
      senderId: A,
      seq: 1,
      ciphertext: 'Y2lwaGVy',
    });
    expect(await a.waitFor((f) => f.t === 'delivered')).toMatchObject({ clientId: 'c1', seq: 1 });

    a.send({ t: 'typing', conversationId });
    await b.waitFor((f) => f.t === 'typing' && f.userId === A);

    b.send({ t: 'read', conversationId, seq: 1 });
    await a.waitFor((f) => f.t === 'read' && f.userId === B && f.seq === 1);

    const stored = await repo.listMessages(conversationId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.ciphertext).toBe('Y2lwaGVy');

    b.close();
    await a.waitFor((f) => f.t === 'presence' && f.userId === B && !f.online);
    a.close();
  });

  it('closes an unauthenticated socket with 1008', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    expect(code).toBe(1008);
  });

  it('rejects a malformed frame', async () => {
    const a = client(A);
    await a.ready;
    a.ws.send('not json');
    await a.waitFor((f) => f.t === 'error');
    a.close();
  });
});

describe('MLS bootstrap + E2E over the gateway (CH-3)', () => {
  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  it('publishes/claims KeyPackages, relays a Welcome, and exchanges a real MLS message', async () => {
    const mls = await createMlsProvider();
    const aliceKp = await mls.generateKeyPackage(utf8(A));
    const bobKp = await mls.generateKeyPackage(utf8(B));

    // Bob publishes his public KeyPackage; the pool reflects it.
    expect((await rest('/api/chat/keypackages', 'POST', { deviceId: 'bob-1', keyPackages: [b64(bobKp.publicPackage)] }, 'user-token')).status).toBe(200);
    expect((await json<{ count: number }>(await rest('/api/chat/keypackages', 'GET', undefined, 'user-token'))).count).toBe(1);

    // Alice opens the DM (CH-2) and claims Bob's KeyPackage (consumed → pool back to 0).
    const conversationId = (await json<{ conversationId: string }>(await rest('/api/chat/conversations', 'POST', { userId: B }, 'owner-token'))).conversationId;
    const claimRes = await rest('/api/chat/keypackages/claim', 'POST', { userId: B }, 'owner-token');
    expect(claimRes.status).toBe(200);
    const claimed = await json<{ keyPackage: string }>(claimRes);
    expect((await json<{ count: number }>(await rest('/api/chat/keypackages', 'GET', undefined, 'user-token'))).count).toBe(0);

    // Alice builds the MLS group (conversationId = MLS groupId) and relays the Welcome to Bob.
    const invite = await mls.startDm(utf8(conversationId), aliceKp, fromB64(claimed.keyPackage));
    let aliceState = invite.groupState;
    expect((await rest('/api/chat/welcomes', 'POST', { conversationId, recipientId: B, welcome: b64(invite.welcome) }, 'owner-token')).status).toBe(200);

    // Bob fetches the pending Welcome and joins from it.
    const pending = await json<{ welcomes: Array<{ id: string; conversationId: string; senderId: string; welcome: string }> }>(
      await rest('/api/chat/welcomes', 'GET', undefined, 'user-token'),
    );
    expect(pending.welcomes).toHaveLength(1);
    const welcome = pending.welcomes[0]!;
    expect(welcome.conversationId).toBe(conversationId);
    expect(welcome.senderId).toBe(A);
    const bobState = await mls.joinGroup(fromB64(welcome.welcome), bobKp);

    // Alice MLS-encrypts a message and relays the opaque ciphertext over the CH-2 WS gateway.
    const a = client(A);
    await a.ready;
    await delay(30);
    const bSock = client(B);
    await bSock.ready;
    a.send({ t: 'sub', conversationId });
    bSock.send({ t: 'sub', conversationId });

    const out = await mls.encrypt(aliceState, utf8('the eagle lands at noon'));
    aliceState = out.groupState;
    const ciphertext = b64(out.ciphertext);
    a.send({ t: 'send', conversationId, ciphertext, clientId: 'm1' });

    // Bob receives the relayed ciphertext frame and decrypts it locally back to plaintext.
    const frame = await bSock.waitFor((f) => f.t === 'message' && 'ciphertext' in f && f.ciphertext === ciphertext);
    if (frame.t !== 'message') throw new Error('expected a message frame');
    const dec = await mls.decrypt(bobState, fromB64(frame.ciphertext));
    if (dec.type !== 'application') throw new Error('expected an application message');
    expect(new TextDecoder().decode(dec.plaintext)).toBe('the eagle lands at noon');

    // The server persisted ONLY the opaque ciphertext — the plaintext never reaches it.
    const stored = (await repo.listMessages(conversationId)).find((m) => m.ciphertext === ciphertext);
    expect(stored).toBeTruthy();
    expect(Buffer.from(stored!.ciphertext, 'base64').toString('utf8').includes('eagle')).toBe(false);

    // Bob acks the Welcome → no longer pending.
    expect((await rest(`/api/chat/welcomes/${welcome.id}`, 'DELETE', undefined, 'user-token')).status).toBe(200);
    expect((await json<{ welcomes: unknown[] }>(await rest('/api/chat/welcomes', 'GET', undefined, 'user-token'))).welcomes).toHaveLength(0);

    a.close();
    bSock.close();
  });

  it('returns 409 when claiming a user with no published KeyPackage', async () => {
    // No test publishes a KeyPackage for A (u_owner), so the pool is empty.
    expect((await rest('/api/chat/keypackages/claim', 'POST', { userId: A }, 'user-token')).status).toBe(409);
  });
});
