/**
 * The structured, versioned message payload carried INSIDE the E2E (MLS) ciphertext. The server only
 * ever sees the worker's opaque bytes — never this. Replies/reactions reference a message by its
 * `seq` (the stable per-conversation id both peers share; local ids differ between sender/receiver).
 * Attachments ride here too: the blob's decryption key, filename and MIME type are part of the
 * payload, so the server holds ciphertext it cannot name, type or open (see lib/attachments.ts).
 */
import { isAttachmentRef, type AttachmentRef } from './attachments';

export interface ReplyRef {
  seq: number;
  text: string;
  senderId: string;
}

export type ChatPayload =
  | { v: 1; t: 'msg'; text: string; replyTo?: ReplyRef; ts: number }
  | { v: 1; t: 'file'; file: AttachmentRef; text: string; replyTo?: ReplyRef; ts: number }
  | { v: 1; t: 'reaction'; targetSeq: number; emoji: string; remove?: boolean; ts: number };

export function encodeMsg(text: string, replyTo?: ReplyRef): string {
  const p: ChatPayload = { v: 1, t: 'msg', text, ts: Date.now(), ...(replyTo ? { replyTo } : {}) };
  return JSON.stringify(p);
}

export function encodeFile(file: AttachmentRef, caption: string, replyTo?: ReplyRef): string {
  const p: ChatPayload = { v: 1, t: 'file', file, text: caption, ts: Date.now(), ...(replyTo ? { replyTo } : {}) };
  return JSON.stringify(p);
}

export function encodeReaction(targetSeq: number, emoji: string, remove: boolean): string {
  return JSON.stringify({ v: 1, t: 'reaction', targetSeq, emoji, remove, ts: Date.now() } satisfies ChatPayload);
}

/**
 * Parse a decrypted plaintext into a ChatPayload; tolerates the legacy `{text,ts}` shape.
 * Everything here comes from a peer, so each field is validated rather than trusted — an unknown or
 * malformed shape degrades to plain text instead of reaching the UI as an arbitrary object.
 */
export function parsePayload(plaintext: string): ChatPayload {
  try {
    const o = JSON.parse(plaintext) as Record<string, unknown>;
    if (o['t'] === 'reaction' && typeof o['targetSeq'] === 'number' && typeof o['emoji'] === 'string') {
      return { v: 1, t: 'reaction', targetSeq: o['targetSeq'], emoji: o['emoji'], remove: !!o['remove'], ts: typeof o['ts'] === 'number' ? o['ts'] : Date.now() };
    }
    if (o['t'] === 'file' && isAttachmentRef(o['file'])) {
      const replyTo = isReplyRef(o['replyTo']) ? o['replyTo'] : undefined;
      return {
        v: 1,
        t: 'file',
        file: o['file'],
        text: typeof o['text'] === 'string' ? o['text'] : '',
        ts: typeof o['ts'] === 'number' ? o['ts'] : Date.now(),
        ...(replyTo ? { replyTo } : {}),
      };
    }
    if (typeof o['text'] === 'string') {
      const replyTo = isReplyRef(o['replyTo']) ? o['replyTo'] : undefined;
      return { v: 1, t: 'msg', text: o['text'], ts: typeof o['ts'] === 'number' ? o['ts'] : Date.now(), ...(replyTo ? { replyTo } : {}) };
    }
  } catch {
    /* fall through */
  }
  return { v: 1, t: 'msg', text: plaintext, ts: Date.now() }; // last resort
}

function isReplyRef(v: unknown): v is ReplyRef {
  return typeof v === 'object' && v !== null && typeof (v as ReplyRef).seq === 'number' && typeof (v as ReplyRef).text === 'string';
}
