import type { IncomingMessage, Server } from 'node:http';
import { ClientFrameSchema, type ServerFrame } from '@chatforge/types';
import { WebSocket, WebSocketServer } from 'ws';
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
export function createChatGateway({ server, repo, authenticate, path = '/ws' }: GatewayOptions): WebSocketServer {
  const wss = new WebSocketServer({ server, path });
  const registry = new Map<string, Set<WebSocket>>();
  const userIdOf = new WeakMap<WebSocket, string>();

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

  wss.on('connection', (ws, req) => {
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
      set.add(ws);
      userIdOf.set(ws, uid);

      await repo.setLastSeen(uid);
      for (const peer of await repo.conversationPeers(uid)) sendTo(peer, { t: 'presence', userId: uid, online: true });

      ws.on('message', (raw) => {
        void (async () => {
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
          const set2 = registry.get(uid);
          set2?.delete(ws);
          if (set2 && set2.size === 0) registry.delete(uid);
          if (!online(uid)) {
            await repo.setLastSeen(uid);
            const lastSeenAt = (await repo.getLastSeen(uid)) ?? Date.now();
            for (const peer of await repo.conversationPeers(uid)) {
              sendTo(peer, { t: 'presence', userId: uid, online: false, lastSeenAt });
            }
          }
        })();
      });
    })();
  });

  return wss;
}
