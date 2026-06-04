import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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

/**
 * Vault: imported chats a user purposely saved, end-to-end encrypted. The server stores only the
 * opaque `ciphertext` (a sealed canonical Conversation) + light metadata; it can never read the
 * content. Optionally `linkedConversationId` ties a saved chat to a live DM.
 */
export const vaultConversations = pgTable('vault_conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull().default(''),
  sourcePlatform: text('source_platform'),
  messageCount: integer('message_count').notNull().default(0),
  ciphertext: text('ciphertext').notNull(), // base64 sealed canonical Conversation — server can't read it
  salt: text('salt'), // base64; for passphrase-derived sealing (null when a device key is used)
  linkedConversationId: uuid('linked_conversation_id').references(() => chatConversations.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ── Chat E2E (CH-3) ── MLS *public* artifacts only: published KeyPackages + relayed Welcomes.
// The server never sees private keys or group secrets; message bodies stay opaque in chat_messages.

/** Public MLS KeyPackages, published per device; claimed (and consumed) one-per-DM to bootstrap E2E. */
export const keyPackages = pgTable(
  'key_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    keyPackage: text('key_package').notNull(), // base64 wire-encoded public KeyPackage
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ byUser: index('key_packages_user_idx').on(t.userId) }),
);

// ── RBAC ── custom roles + per-user permission grants (delegation). ──

/** Roles, system + custom. `permissions` is an array of Permission names (see rbac.ts). */
export const roles = pgTable('roles', {
  name: text('name').primaryKey(),
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Per-user grants: allow/deny a single permission on top of the user's role (delegation). */
export const userGrants = pgTable(
  'user_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    effect: text('effect').notNull().default('allow'), // 'allow' | 'deny'
    grantedBy: text('granted_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ uqUserPerm: unique('user_grants_user_perm').on(t.userId, t.permission) }),
);

/** Relayed MLS Welcomes — the server forwards opaque `mls_welcome` bytes from inviter to invitee. */
export const mlsWelcomes = pgTable(
  'mls_welcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    welcome: text('welcome').notNull(), // base64 wire-encoded mls_welcome
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ byRecipient: index('mls_welcomes_recipient_idx').on(t.recipientId) }),
);
