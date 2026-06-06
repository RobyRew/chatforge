import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * User identity table. Authentication is delegated to **Logto** (OIDC); we keep a thin local row
 * keyed by the Logto subject (`logtoSub`). All app data (chat, vault, blobs, RBAC, MLS key packages)
 * FKs to `user.id`. Profile + RBAC fields (username/role/status/vaultSalt) live here; passwords,
 * passkeys, social login, and MFA all live in Logto. See docs/auth-logto.md.
 *
 * The E2E crypto layer is independent of auth: `vaultSalt` is a public salt the client uses to
 * derive vault keys from a passphrase/device key — the server never sees the key or plaintext.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(), // app-side id (uuid)
  logtoSub: text('logto_sub').notNull().unique(), // Logto subject — the link to identity
  email: text('email').notNull(),
  name: text('name').notNull(),
  image: text('image'),
  username: text('username').unique(), // unique handle (nullable until the user picks one)
  vaultSalt: text('vault_salt'), // public PBKDF2 salt for the E2E vault passphrase (client-managed)
  bio: text('bio'),
  about: text('about'),
  statusEmoji: text('status_emoji'),
  statusText: text('status_text'),
  role: text('role').notNull().default('user'),
  status: text('status').notNull().default('active'), // 'active' | 'suspended'
  mustChangePassword: boolean('must_change_password').notNull().default(false), // legacy/no-op under Logto
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Server-side Logto session store (Traditional Web flow). One row per opaque `cf_sid` cookie; the
 * JSON blob holds the @logto/node client state (PKCE/state during sign-in, then the tokens). The
 * browser never sees these — only the cookie id. Pruned by TTL on each sign-in. See auth/logto.ts.
 */
export const logtoSessions = pgTable('logto_sessions', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});
