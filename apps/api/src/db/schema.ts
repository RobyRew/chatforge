import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

/**
 * Domain Postgres schema (Drizzle). better-auth owns the auth tables (see ./auth-schema, re-exported
 * below). NO message content is stored here — converted artifacts live as E2E-encrypted blobs in
 * object storage; only metadata + ciphertext references are persisted.
 */

// Auth tables (user/session/account/verification/passkey) come from better-auth.
export * from './auth-schema';

export const featureFlags = pgTable('feature_flags', {
  flag: text('flag').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  ts: timestamp('ts').notNull().defaultNow(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  detail: text('detail'),
});

/** Conversion metadata only — the artifact is an encrypted blob referenced by `blobRef`. */
export const conversions = pgTable('conversions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title'),
  source: text('source').notNull(),
  target: text('target').notNull(),
  messageCount: integer('message_count').notNull().default(0),
  report: jsonb('report'),
  blobRef: text('blob_ref'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Registry of E2E-encrypted blobs. Ciphertext lives in S3/MinIO; we track only wrapped keys. */
export const blobs = pgTable('blobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  wrappedKey: text('wrapped_key').notNull(), // base64
  salt: text('salt').notNull(), // base64
  size: integer('size').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ── Chat (CH-2) ── server stores only opaque ciphertext + membership; never plaintext. ──

export const chatConversations = pgTable('chat_conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: text('kind').notNull().default('dm'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const chatMembers = pgTable(
  'chat_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conversationId, t.userId] }) }),
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => user.id),
    seq: integer('seq').notNull(),
    ciphertext: text('ciphertext').notNull(), // opaque base64 (MLS in CH-3)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ uqSeq: unique('chat_messages_conv_seq').on(t.conversationId, t.seq) }),
);

export const userPresence = pgTable('user_presence', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
});
