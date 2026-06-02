import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { ClientFrame, ServerFrame } from '@chatforge/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../src/app';
import { createChatGateway } from '../src/chat/gateway';
import { MemoryChatRepo } from '../src/chat/memoryRepo';
import { setChatRepo } from '../src/chat/repo';

const repo = new MemoryChatRepo();
setChatRepo(repo); // the REST chat module reads this singleton

const A = 'u_owner'; // bearer 'owner-token' (seeded role: owner)
const B = 'u_user'; // bearer 'user-token' (seeded role: user)
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
