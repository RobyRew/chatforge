import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { blobs } from '../db/schema';

/**
 * Metadata boundary for blobs. Mirrors `ChatRepo`/`AdminRepo`: a Drizzle implementation for
 * production and an in-memory one so the whole authorization path (membership checks, quota,
 * ownership) is testable without Postgres.
 */
export type BlobKind = 'attachment' | 'avatar';

export interface BlobRecord {
  id: string;
  ownerId: string;
  kind: BlobKind;
  /** Access-control scope for attachments — only members of this conversation may read it. */
  conversationId: string | null;
  /** Set for avatars only; attachments are opaque ciphertext with no server-known type. */
  contentType: string | null;
  objectKey: string;
  size: number;
  /** The message `seq` this blob is attached to; null while unattached (or for avatars). */
  messageSeq: number | null;
  createdAt: number;
}

export type NewBlob = Omit<BlobRecord, 'id' | 'createdAt' | 'messageSeq'>;

export interface BlobRepo {
  create(input: NewBlob): Promise<BlobRecord>;
  get(id: string): Promise<BlobRecord | null>;
  delete(id: string): Promise<void>;
  /** Total bytes this user is storing — the quota check. */
  usedBytes(ownerId: string): Promise<number>;
  /**
   * Attach uploaded blobs to the message that references them, so deleting the message can reclaim
   * them. Only the owner's own, still-unattached, same-conversation blobs are linked — a hostile
   * client cannot hijack someone else's blob by naming its id.
   */
  linkToMessage(ids: string[], ownerId: string, conversationId: string, seq: number): Promise<void>;
  /** The blobs attached to a message (to delete alongside it). */
  listForMessage(conversationId: string, seq: number): Promise<BlobRecord[]>;
  /** Attachments never linked to a message and older than `olderThanMs` — abandoned uploads. */
  listOrphans(olderThanMs: number, limit: number): Promise<BlobRecord[]>;
}

export class DrizzleBlobRepo implements BlobRepo {
  private get db() {
    return getDb();
  }

  async create(input: NewBlob): Promise<BlobRecord> {
    const rows = await this.db
      .insert(blobs)
      .values({
        ownerId: input.ownerId,
        kind: input.kind,
        conversationId: input.conversationId,
        contentType: input.contentType,
        objectKey: input.objectKey,
        size: input.size,
      })
      .returning();
    return toRecord(rows[0]!);
  }

  async get(id: string): Promise<BlobRecord | null> {
    const rows = await this.db.select().from(blobs).where(eq(blobs.id, id)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(blobs).where(eq(blobs.id, id));
  }

  async usedBytes(ownerId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${blobs.size}), 0)` })
      .from(blobs)
      .where(eq(blobs.ownerId, ownerId));
    return Number(rows[0]?.total ?? 0);
  }

  async linkToMessage(ids: string[], ownerId: string, conversationId: string, seq: number): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(blobs)
      .set({ messageSeq: seq })
      .where(
        and(
          inArray(blobs.id, ids),
          eq(blobs.ownerId, ownerId),
          eq(blobs.conversationId, conversationId),
          eq(blobs.kind, 'attachment'),
          isNull(blobs.messageSeq),
        ),
      );
  }

  async listForMessage(conversationId: string, seq: number): Promise<BlobRecord[]> {
    const rows = await this.db
      .select()
      .from(blobs)
      .where(and(eq(blobs.conversationId, conversationId), eq(blobs.messageSeq, seq)));
    return rows.map(toRecord);
  }

  async listOrphans(olderThanMs: number, limit: number): Promise<BlobRecord[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(blobs)
      .where(and(eq(blobs.kind, 'attachment'), isNull(blobs.messageSeq), lt(blobs.createdAt, cutoff)))
      .limit(limit);
    return rows.map(toRecord);
  }
}

export class MemoryBlobRepo implements BlobRepo {
  private rows = new Map<string, BlobRecord>();

  create(input: NewBlob): Promise<BlobRecord> {
    const rec: BlobRecord = { ...input, id: crypto.randomUUID(), messageSeq: null, createdAt: Date.now() };
    this.rows.set(rec.id, rec);
    return Promise.resolve(rec);
  }

  get(id: string): Promise<BlobRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  delete(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  usedBytes(ownerId: string): Promise<number> {
    let total = 0;
    for (const r of this.rows.values()) if (r.ownerId === ownerId) total += r.size;
    return Promise.resolve(total);
  }

  linkToMessage(ids: string[], ownerId: string, conversationId: string, seq: number): Promise<void> {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && r.ownerId === ownerId && r.conversationId === conversationId && r.kind === 'attachment' && r.messageSeq === null) {
        r.messageSeq = seq;
      }
    }
    return Promise.resolve();
  }

  listForMessage(conversationId: string, seq: number): Promise<BlobRecord[]> {
    return Promise.resolve([...this.rows.values()].filter((r) => r.conversationId === conversationId && r.messageSeq === seq));
  }

  listOrphans(olderThanMs: number, limit: number): Promise<BlobRecord[]> {
    const cutoff = Date.now() - olderThanMs;
    return Promise.resolve(
      [...this.rows.values()].filter((r) => r.kind === 'attachment' && r.messageSeq === null && r.createdAt < cutoff).slice(0, limit),
    );
  }
}

type Row = typeof blobs.$inferSelect;

function toRecord(row: Row): BlobRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    kind: row.kind === 'avatar' ? 'avatar' : 'attachment',
    conversationId: row.conversationId,
    contentType: row.contentType,
    objectKey: row.objectKey,
    size: row.size,
    messageSeq: row.messageSeq,
    createdAt: row.createdAt.getTime(),
  };
}

let repo: BlobRepo | null = null;

export function setBlobRepo(next: BlobRepo | null): void {
  repo = next;
}

export function getBlobRepo(): BlobRepo {
  if (!repo) repo = new DrizzleBlobRepo();
  return repo;
}
