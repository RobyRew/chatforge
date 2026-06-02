import { z } from 'zod';

/**
 * Realtime chat wire protocol, shared by the API gateway and the web client.
 * Message bodies are opaque base64 `ciphertext` — the server never inspects them (MLS, CH-3).
 */
export const ClientFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('sub'), conversationId: z.string().min(1) }),
  z.object({
    t: z.literal('send'),
    conversationId: z.string().min(1),
    ciphertext: z.string().min(1),
    clientId: z.string().min(1),
  }),
  z.object({ t: z.literal('typing'), conversationId: z.string().min(1) }),
  z.object({ t: z.literal('read'), conversationId: z.string().min(1), seq: z.number().int().nonnegative() }),
]);
export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export type ServerFrame =
  | { t: 'message'; conversationId: string; id: string; senderId: string; seq: number; ciphertext: string; createdAt: number }
  | { t: 'delivered'; conversationId: string; clientId: string; seq: number }
  | { t: 'typing'; conversationId: string; userId: string }
  | { t: 'presence'; userId: string; online: boolean; lastSeenAt?: number }
  | { t: 'read'; conversationId: string; userId: string; seq: number }
  | { t: 'error'; message: string };

export interface ConversationSummary {
  id: string;
  peerIds: string[];
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
