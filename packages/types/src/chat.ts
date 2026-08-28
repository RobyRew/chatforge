import { z } from 'zod';

/**
 * Realtime chat wire protocol, shared by the API gateway and the web client.
 * Message bodies are opaque base64 `ciphertext` — the server never inspects them (MLS, CH-3).
 *
 * Hard caps on every attacker-controlled field (defence in depth alongside the gateway's
 * `maxPayload` + per-connection rate limit): a conversation id is a UUID (36 chars), and a single
 * MLS application message base64-encodes to well under 256 KB.
 */
export const MAX_CIPHERTEXT = 262_144; // 256 KB of base64
const convId = z.string().min(1).max(64);

export const ClientFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('sub'), conversationId: convId }),
  z.object({
    t: z.literal('send'),
    conversationId: convId,
    ciphertext: z.string().min(1).max(MAX_CIPHERTEXT),
    clientId: z.string().min(1).max(64),
    /**
     * Ids of blobs this message references. The server cannot read the ciphertext, so it cannot
     * discover the link itself — without it, deleting a message could never reclaim its attachment.
     * The ids are already server-known (it stored them), so this leaks nothing new; ownership and
     * conversation scope are re-checked before anything is linked.
     */
    blobIds: z.array(z.string().uuid()).max(10).optional(),
  }),
  z.object({ t: z.literal('delete'), conversationId: convId, seq: z.number().int().positive().max(2_000_000_000) }),
  z.object({ t: z.literal('typing'), conversationId: convId }),
  z.object({ t: z.literal('read'), conversationId: convId, seq: z.number().int().nonnegative().max(2_000_000_000) }),
  z.object({ t: z.literal('active'), away: z.boolean() }), // client-reported idle/away state
]);
export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export type PresenceState = 'online' | 'away' | 'offline';

export type ServerFrame =
  | { t: 'message'; conversationId: string; id: string; senderId: string; seq: number; ciphertext: string; createdAt: number }
  | { t: 'delivered'; conversationId: string; clientId: string; seq: number }
  | { t: 'typing'; conversationId: string; userId: string }
  | { t: 'presence'; userId: string; online: boolean; state?: PresenceState; lastSeenAt?: number }
  | { t: 'read'; conversationId: string; userId: string; seq: number }
  // Live profile/status update fanned out to a user's conversation peers (server-known metadata).
  | { t: 'profile'; userId: string; name?: string | null; username?: string | null; email?: string; image?: string | null; statusEmoji?: string | null; statusText?: string | null }
  // A message was deleted for everyone. Clients drop their local plaintext cache for that `seq`.
  | { t: 'deleted'; conversationId: string; seq: number; by: string }
  | { t: 'error'; message: string };

export interface ConversationPeer {
  id: string;
  email: string;
  name?: string | null;
  username?: string | null;
  image?: string | null;
  statusEmoji?: string | null;
  statusText?: string | null;
}

export interface ConversationSummary {
  id: string;
  peers: ConversationPeer[];
  lastReadSeq: number;
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  seq: number;
  /** Empty string when the message was deleted — the row survives so `seq` ordering is preserved. */
  ciphertext: string;
  createdAt: number;
  /** When the sender deleted it for everyone. */
  deletedAt?: number;
}

/** A relayed MLS Welcome addressed to a recipient (CH-3). `welcome` is opaque base64 `mls_welcome`. */
export interface WelcomeDTO {
  id: string;
  conversationId: string;
  senderId: string;
  welcome: string;
  createdAt: number;
}
