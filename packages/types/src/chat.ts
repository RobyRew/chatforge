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
  }),
  z.object({ t: z.literal('typing'), conversationId: convId }),
  z.object({ t: z.literal('read'), conversationId: convId, seq: z.number().int().nonnegative().max(2_000_000_000) }),
]);
export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export type ServerFrame =
  | { t: 'message'; conversationId: string; id: string; senderId: string; seq: number; ciphertext: string; createdAt: number }
  | { t: 'delivered'; conversationId: string; clientId: string; seq: number }
  | { t: 'typing'; conversationId: string; userId: string }
  | { t: 'presence'; userId: string; online: boolean; lastSeenAt?: number }
  | { t: 'read'; conversationId: string; userId: string; seq: number }
  | { t: 'error'; message: string };

export interface ConversationPeer {
  id: string;
  email: string;
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
  ciphertext: string;
  createdAt: number;
}

/** A relayed MLS Welcome addressed to a recipient (CH-3). `welcome` is opaque base64 `mls_welcome`. */
export interface WelcomeDTO {
  id: string;
  conversationId: string;
  senderId: string;
  welcome: string;
  createdAt: number;
}
