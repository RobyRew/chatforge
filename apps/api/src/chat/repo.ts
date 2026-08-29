import type { ChatMessageDTO, ConversationSummary, WelcomeDTO } from '@chatforge/types';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { chatConversations, chatMembers, chatMessages, keyPackages, mlsWelcomes, user, userPresence } from '../db/schema';

/**
 * Persistence boundary for chat. Bodies are opaque base64 `ciphertext` — the server never reads
 * them. Two implementations: Drizzle/Postgres (prod) and in-memory (tests/dev), swappable via
 * `setChatRepo` so the WS transport can be verified in-process without a database.
 */
export interface ChatRepo {
  createDm(a: string, b: string): Promise<{ id: string; created: boolean }>;
  /** Create a group conversation. `creator` becomes its owner — the only one who may add/remove. */
  createGroup(creator: string, title: string, memberIds: string[]): Promise<{ id: string }>;
  /** Add a member. Owner-only; returns false if the caller isn't the owner or they're already in. */
  addGroupMember(conversationId: string, actorId: string, userId: string): Promise<boolean>;
  /** Remove a member — the owner removing someone, or anyone removing themselves (leaving). */
  removeGroupMember(conversationId: string, actorId: string, userId: string): Promise<boolean>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
  memberIds(conversationId: string): Promise<string[]>;
  conversationPeers(userId: string): Promise<string[]>;
  isMember(conversationId: string, userId: string): Promise<boolean>;
  /** Directory lookup — resolving a handle to a user id. Behind the seam so routes stay testable. */
  findUserIdByEmail(email: string): Promise<string | undefined>;
  findUserIdByUsername(username: string): Promise<string | undefined>;
  appendMessage(conversationId: string, senderId: string, ciphertext: string): Promise<ChatMessageDTO>;
  listMessages(conversationId: string, opts?: { beforeSeq?: number; limit?: number }): Promise<ChatMessageDTO[]>;
  setLastRead(conversationId: string, userId: string, seq: number): Promise<void>;
  setLastSeen(userId: string): Promise<void>;
  getLastSeen(userId: string): Promise<number | null>;
  // ── CH-3 MLS public artifacts (ciphertext/public-only) ──
  /** Publish a device's public KeyPackages so peers can claim one to start a DM. */
  publishKeyPackages(userId: string, deviceId: string, packages: string[]): Promise<void>;
  /** Claim and consume one of a user's KeyPackages (single-use, for forward secrecy). */
  claimKeyPackage(userId: string): Promise<string | null>;
  /** How many unclaimed KeyPackages the user has left (so a client knows when to replenish). */
  countKeyPackages(userId: string): Promise<number>;
  /** Relay an MLS Welcome to a recipient. */
  storeWelcome(conversationId: string, recipientId: string, senderId: string, welcome: string): Promise<{ id: string }>;
  /** List the Welcomes waiting for a recipient. */
  listWelcomes(recipientId: string): Promise<WelcomeDTO[]>;
  /** Acknowledge (delete) a processed Welcome. */
  deleteWelcome(id: string, recipientId: string): Promise<void>;
  /**
   * Delete a message for everyone. Only the sender may; returns false otherwise (or if it's gone).
   * Blanks the ciphertext but keeps the row — `seq` is the shared id replies/reactions point at.
   */
  deleteMessage(conversationId: string, seq: number, requesterId: string): Promise<boolean>;
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
      .select({ c: chatMembers.conversationId, last: chatMembers.lastReadSeq, kind: chatConversations.kind, title: chatConversations.title, createdBy: chatConversations.createdBy })
      .from(chatMembers)
      .innerJoin(chatConversations, eq(chatMembers.conversationId, chatConversations.id))
      .where(eq(chatMembers.userId, userId));
    const out: ConversationSummary[] = [];
    for (const row of mine) {
      const peers = await this.db
        .select({ id: user.id, email: user.email, name: user.name, username: user.username, image: user.image, statusEmoji: user.statusEmoji, statusText: user.statusText })
        .from(chatMembers)
        .innerJoin(user, eq(chatMembers.userId, user.id))
        .where(and(eq(chatMembers.conversationId, row.c), ne(chatMembers.userId, userId)));
      out.push({
        id: row.c,
        peers,
        lastReadSeq: row.last,
        kind: row.kind === 'group' ? 'group' : 'dm',
        title: row.title,
        createdBy: row.createdBy,
      });
    }
    return out;
  }

  async createGroup(creator: string, title: string, memberIds: string[]): Promise<{ id: string }> {
    const inserted = await this.db
      .insert(chatConversations)
      .values({ kind: 'group', title, createdBy: creator })
      .returning({ id: chatConversations.id });
    const id = inserted[0]!.id;
    const unique = [...new Set([creator, ...memberIds])];
    await this.db.insert(chatMembers).values(unique.map((userId) => ({ conversationId: id, userId })));
    return { id };
  }

  /** True only if `actorId` created this conversation and it is a group. */
  private async isGroupOwner(conversationId: string, actorId: string): Promise<boolean> {
    const rows = await this.db
      .select({ kind: chatConversations.kind, createdBy: chatConversations.createdBy })
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId))
      .limit(1);
    return rows[0]?.kind === 'group' && rows[0]?.createdBy === actorId;
  }

  async addGroupMember(conversationId: string, actorId: string, userId: string): Promise<boolean> {
    if (!(await this.isGroupOwner(conversationId, actorId))) return false;
    const added = await this.db
      .insert(chatMembers)
      .values({ conversationId, userId })
      .onConflictDoNothing()
      .returning({ userId: chatMembers.userId });
    return added.length > 0;
  }

  async removeGroupMember(conversationId: string, actorId: string, userId: string): Promise<boolean> {
    // Either the owner removing someone, or anyone removing themselves (leaving).
    const allowed = actorId === userId || (await this.isGroupOwner(conversationId, actorId));
    if (!allowed) return false;
    // The owner leaving would orphan the group with nobody able to manage it.
    if (actorId === userId && (await this.isGroupOwner(conversationId, actorId))) return false;
    const removed = await this.db
      .delete(chatMembers)
      .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId)))
      .returning({ userId: chatMembers.userId });
    return removed.length > 0;
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

  async findUserIdByEmail(email: string): Promise<string | undefined> {
    const rows = await this.db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    return rows[0]?.id;
  }

  async findUserIdByUsername(username: string): Promise<string | undefined> {
    const rows = await this.db.select({ id: user.id }).from(user).where(eq(user.username, username)).limit(1);
    return rows[0]?.id;
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
        ...(r.deletedAt ? { deletedAt: r.deletedAt.getTime() } : {}),
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

  async publishKeyPackages(userId: string, deviceId: string, packages: string[]): Promise<void> {
    if (!packages.length) return;
    await this.db.insert(keyPackages).values(packages.map((keyPackage) => ({ userId, deviceId, keyPackage })));
  }

  async claimKeyPackage(userId: string): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      // Lock + skip-locked so concurrent claims hand out distinct packages rather than the same one.
      const rows = await tx
        .select({ id: keyPackages.id, kp: keyPackages.keyPackage })
        .from(keyPackages)
        .where(eq(keyPackages.userId, userId))
        .orderBy(asc(keyPackages.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      const row = rows[0];
      if (!row) return null;
      await tx.delete(keyPackages).where(eq(keyPackages.id, row.id));
      return row.kp;
    });
  }

  async countKeyPackages(userId: string): Promise<number> {
    const agg = await this.db.select({ n: sql<number>`count(*)::int` }).from(keyPackages).where(eq(keyPackages.userId, userId));
    return agg[0]?.n ?? 0;
  }

  async storeWelcome(conversationId: string, recipientId: string, senderId: string, welcome: string): Promise<{ id: string }> {
    const rows = await this.db
      .insert(mlsWelcomes)
      .values({ conversationId, recipientId, senderId, welcome })
      .returning({ id: mlsWelcomes.id });
    return { id: rows[0]!.id };
  }

  async listWelcomes(recipientId: string): Promise<WelcomeDTO[]> {
    const rows = await this.db
      .select()
      .from(mlsWelcomes)
      .where(eq(mlsWelcomes.recipientId, recipientId))
      .orderBy(asc(mlsWelcomes.createdAt));
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      welcome: r.welcome,
      createdAt: r.createdAt.getTime(),
    }));
  }

  async deleteMessage(conversationId: string, seq: number, requesterId: string): Promise<boolean> {
    const updated = await this.db
      .update(chatMessages)
      .set({ ciphertext: '', deletedAt: new Date() })
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          eq(chatMessages.seq, seq),
          eq(chatMessages.senderId, requesterId), // sender-only, enforced in the WHERE
          isNull(chatMessages.deletedAt),
        ),
      )
      .returning({ seq: chatMessages.seq });
    return updated.length > 0;
  }

  async deleteWelcome(id: string, recipientId: string): Promise<void> {
    await this.db.delete(mlsWelcomes).where(and(eq(mlsWelcomes.id, id), eq(mlsWelcomes.recipientId, recipientId)));
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
