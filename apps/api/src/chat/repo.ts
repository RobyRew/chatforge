import type { ChatMessageDTO, ConversationSummary } from '@chatforge/types';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { chatConversations, chatMembers, chatMessages, userPresence } from '../db/schema';

/**
 * Persistence boundary for chat. Bodies are opaque base64 `ciphertext` — the server never reads
 * them. Two implementations: Drizzle/Postgres (prod) and in-memory (tests/dev), swappable via
 * `setChatRepo` so the WS transport can be verified in-process without a database.
 */
export interface ChatRepo {
  createDm(a: string, b: string): Promise<{ id: string; created: boolean }>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
  memberIds(conversationId: string): Promise<string[]>;
  conversationPeers(userId: string): Promise<string[]>;
  isMember(conversationId: string, userId: string): Promise<boolean>;
  appendMessage(conversationId: string, senderId: string, ciphertext: string): Promise<ChatMessageDTO>;
  listMessages(conversationId: string, opts?: { beforeSeq?: number; limit?: number }): Promise<ChatMessageDTO[]>;
  setLastRead(conversationId: string, userId: string, seq: number): Promise<void>;
  setLastSeen(userId: string): Promise<void>;
  getLastSeen(userId: string): Promise<number | null>;
}

export class DrizzleChatRepo implements ChatRepo {
  private get db() {
    return getDb();
  }

  async createDm(a: string, b: string): Promise<{ id: string; created: boolean }> {
    const mine = await this.db
      .select({ c: chatMembers.conversationId })
      .from(chatMembers)
      .where(eq(chatMembers.userId, a));
    const ids = mine.map((r) => r.c);
    if (ids.length) {
      const shared = await this.db
        .select({ c: chatMembers.conversationId })
        .from(chatMembers)
        .where(and(eq(chatMembers.userId, b), inArray(chatMembers.conversationId, ids)));
      const first = shared[0];
      if (first) return { id: first.c, created: false };
    }
    const inserted = await this.db.insert(chatConversations).values({ kind: 'dm' }).returning({ id: chatConversations.id });
    const id = inserted[0]!.id;
    await this.db.insert(chatMembers).values([
      { conversationId: id, userId: a },
      { conversationId: id, userId: b },
    ]);
    return { id, created: true };
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const mine = await this.db
      .select({ c: chatMembers.conversationId, last: chatMembers.lastReadSeq })
      .from(chatMembers)
      .where(eq(chatMembers.userId, userId));
    const out: ConversationSummary[] = [];
    for (const row of mine) {
      const members = await this.memberIds(row.c);
      out.push({ id: row.c, peerIds: members.filter((m) => m !== userId), lastReadSeq: row.last });
    }
    return out;
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ u: chatMembers.userId })
      .from(chatMembers)
      .where(eq(chatMembers.conversationId, conversationId));
    return rows.map((r) => r.u);
  }

  async conversationPeers(userId: string): Promise<string[]> {
    const mine = await this.db
      .select({ c: chatMembers.conversationId })
      .from(chatMembers)
      .where(eq(chatMembers.userId, userId));
    const ids = mine.map((r) => r.c);
    if (!ids.length) return [];
    const rows = await this.db
      .select({ u: chatMembers.userId })
      .from(chatMembers)
      .where(and(inArray(chatMembers.conversationId, ids), ne(chatMembers.userId, userId)));
    return [...new Set(rows.map((r) => r.u))];
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ u: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  async appendMessage(conversationId: string, senderId: string, ciphertext: string): Promise<ChatMessageDTO> {
    return this.db.transaction(async (tx) => {
      const agg = await tx
        .select({ max: sql<number>`coalesce(max(${chatMessages.seq}), 0)` })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId));
      const seq = (agg[0]?.max ?? 0) + 1;
      const rows = await tx.insert(chatMessages).values({ conversationId, senderId, seq, ciphertext }).returning();
      const r = rows[0]!;
      return { id: r.id, conversationId, senderId, seq, ciphertext, createdAt: r.createdAt.getTime() };
    });
  }

  async listMessages(conversationId: string, opts: { beforeSeq?: number; limit?: number } = {}): Promise<ChatMessageDTO[]> {
    const limit = opts.limit ?? 50;
    const cond =
      opts.beforeSeq != null
        ? and(eq(chatMessages.conversationId, conversationId), lt(chatMessages.seq, opts.beforeSeq))
        : eq(chatMessages.conversationId, conversationId);
    const rows = await this.db.select().from(chatMessages).where(cond).orderBy(desc(chatMessages.seq)).limit(limit);
    return rows
      .reverse()
      .map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        senderId: r.senderId,
        seq: r.seq,
        ciphertext: r.ciphertext,
        createdAt: r.createdAt.getTime(),
      }));
  }

  async setLastRead(conversationId: string, userId: string, seq: number): Promise<void> {
    await this.db
      .update(chatMembers)
      .set({ lastReadSeq: seq })
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId)));
  }

  async setLastSeen(userId: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(userPresence)
      .values({ userId, lastSeenAt: now })
      .onConflictDoUpdate({ target: userPresence.userId, set: { lastSeenAt: now } });
  }

  async getLastSeen(userId: string): Promise<number | null> {
    const rows = await this.db.select().from(userPresence).where(eq(userPresence.userId, userId)).limit(1);
    return rows[0] ? rows[0].lastSeenAt.getTime() : null;
  }
}

let current: ChatRepo | undefined;

export function getChatRepo(): ChatRepo {
  if (!current) current = new DrizzleChatRepo();
  return current;
}

export function setChatRepo(repo: ChatRepo): void {
  current = repo;
}
