import type { IncomingMessage, Server } from 'node:http';
import { ClientFrameSchema, type ServerFrame } from '@chatforge/types';
import { WebSocket, WebSocketServer } from 'ws';
import { setBroadcaster, setOnlineLister } from './broadcast';
import type { ChatRepo } from './repo';

/** Resolve a WS upgrade request to a user id (or null to reject). */
export type Authenticate = (req: IncomingMessage) => Promise<string | null>;

export interface GatewayOptions {
  server: Server;
  repo: ChatRepo;
  authenticate: Authenticate;
  path?: string;
}

/**
 * WebSocket chat gateway. Authenticates the upgrade, tracks connections per user (multi-device),
 * relays opaque-ciphertext messages to conversation members, and broadcasts presence/typing/read.
 * The server never inspects message bodies.
 */
// ── Abuse limits (defence against a hostile client) ──
const MAX_PAYLOAD = 256 * 1024; // bytes per frame — ws closes the socket (1009) if exceeded
const MAX_CONNECTIONS_PER_USER = 10; // multi-device, but bounded
const RATE_BURST = 40; // token bucket: burst…
const RATE_REFILL_PER_SEC = 20; // …and sustained messages/sec per socket

export function createChatGateway({ server, repo, authenticate, path = '/ws' }: GatewayOptions): WebSocketServer {
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_PAYLOAD });
  const registry = new Map<string, Set<WebSocket>>();
  const userIdOf = new WeakMap<WebSocket, string>();
  const buckets = new WeakMap<WebSocket, { tokens: number; last: number }>();
  const isAlive = new WeakMap<WebSocket, boolean>();
  const awayState = new Map<string, boolean>(); // userId -> away?

  /** Token-bucket rate limit per socket; returns false when the caller is sending too fast. */
  const allow = (ws: WebSocket): boolean => {
    const now = Date.now();
    let b = buckets.get(ws);
    if (!b) {
      b = { tokens: RATE_BURST, last: now };
      buckets.set(ws, b);
    }
    b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.last) / 1000) * RATE_REFILL_PER_SEC);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };

  const online = (userId: string): boolean => (registry.get(userId)?.size ?? 0) > 0;

  const sendTo = (userId: string, frame: ServerFrame, except?: WebSocket): void => {
    const set = registry.get(userId);
    if (!set) return;
    const data = JSON.stringify(frame);
    for (const ws of set) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  const send = (ws: WebSocket, frame: ServerFrame): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };

  // Heartbeat: ping every 30s and reap sockets that didn't pong — keeps connections alive through
  // proxies (Traefik/nginx idle timeouts) and cleans up dead ones.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (isAlive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      isAlive.set(ws, false);
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  // Let other modules (e.g. a profile/status change) fan a frame out to a user's conversation peers.
  setBroadcaster((userId, frame) => {
    void (async () => {
      try {
        for (const peer of await repo.conversationPeers(userId)) sendTo(peer, frame);
      } catch {
        /* best-effort */
      }
    })();
  });

  // Who is connected right now — the Spotify poller only works for these users.
  setOnlineLister(() => [...registry.entries()].filter(([, set]) => set.size > 0).map(([userId]) => userId));

  wss.on('connection', (ws, req) => {
    isAlive.set(ws, true);
    ws.on('pong', () => isAlive.set(ws, true));
    ws.on('error', () => {
      /* swallow socket errors — never let them bubble to an unhandled rejection */
    });
    void (async () => {
      let userId: string | null = null;
      try {
        userId = await authenticate(req);
      } catch {
        userId = null;
      }
      if (!userId) {
        ws.close(1008, 'unauthorized');
        return;
      }
      const uid = userId;

      let set = registry.get(uid);
      if (!set) {
        set = new Set();
        registry.set(uid, set);
      }
      // Bound connections per user — evict the oldest socket if at the cap.
      while (set.size >= MAX_CONNECTIONS_PER_USER) {
        const oldest = set.values().next().value;
        if (!oldest) break;
        set.delete(oldest);
        try {
          oldest.close(1013, 'too many connections');
        } catch {
          /* already closing */
        }
      }
      set.add(ws);
      userIdOf.set(ws, uid);

      awayState.set(uid, false);
      try {
        await repo.setLastSeen(uid);
        for (const peer of await repo.conversationPeers(uid)) sendTo(peer, { t: 'presence', userId: uid, online: true, state: 'online' });
      } catch {
        /* presence is best-effort — never tear down the socket over it */
      }

      ws.on('message', (raw) => {
        void (async () => {
          if (!allow(ws)) {
            send(ws, { t: 'error', message: 'rate limited' });
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            send(ws, { t: 'error', message: 'invalid json' });
            return;
          }
          const result = ClientFrameSchema.safeParse(parsed);
          if (!result.success) {
            send(ws, { t: 'error', message: 'invalid frame' });
            return;
          }
          const frame = result.data;
          try {
            if (frame.t === 'active') {
              // user-scoped (no conversation) — broadcast online/away to all peers
              awayState.set(uid, frame.away);
              for (const peer of await repo.conversationPeers(uid)) sendTo(peer, { t: 'presence', userId: uid, online: true, state: frame.away ? 'away' : 'online' });
              return;
            }
            if (!(await repo.isMember(frame.conversationId, uid))) {
              send(ws, { t: 'error', message: 'not a member' });
              return;
            }
            if (frame.t === 'send') {
              const msg = await repo.appendMessage(frame.conversationId, uid, frame.ciphertext);
              for (const m of await repo.memberIds(frame.conversationId)) {
                sendTo(
                  m,
                  {
                    t: 'message',
                    conversationId: msg.conversationId,
                    id: msg.id,
                    senderId: msg.senderId,
                    seq: msg.seq,
                    ciphertext: msg.ciphertext,
                    createdAt: msg.createdAt,
                  },
                  ws,
                );
              }
              send(ws, { t: 'delivered', conversationId: frame.conversationId, clientId: frame.clientId, seq: msg.seq });
            } else if (frame.t === 'typing') {
              for (const m of await repo.memberIds(frame.conversationId)) {
                if (m !== uid) sendTo(m, { t: 'typing', conversationId: frame.conversationId, userId: uid });
              }
            } else if (frame.t === 'read') {
              await repo.setLastRead(frame.conversationId, uid, frame.seq);
              for (const m of await repo.memberIds(frame.conversationId)) {
                if (m !== uid) sendTo(m, { t: 'read', conversationId: frame.conversationId, userId: uid, seq: frame.seq });
              }
            }
            // 'sub': membership validated above; nothing more needed for 1:1.
          } catch (e) {
            send(ws, { t: 'error', message: e instanceof Error ? e.message : 'error' });
          }
        })();
      });

      ws.on('close', () => {
        void (async () => {
          try {
            const set2 = registry.get(uid);
            set2?.delete(ws);
            if (set2 && set2.size === 0) registry.delete(uid);
            if (!online(uid)) {
              await repo.setLastSeen(uid);
              const lastSeenAt = (await repo.getLastSeen(uid)) ?? Date.now();
              awayState.delete(uid);
              for (const peer of await repo.conversationPeers(uid)) {
                sendTo(peer, { t: 'presence', userId: uid, online: false, state: 'offline', lastSeenAt });
              }
            }
          } catch {
            /* best-effort cleanup */
          }
        })();
      });
    })();
  });

  return wss;
}
