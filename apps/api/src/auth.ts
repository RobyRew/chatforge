import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb, type DB } from './db';
import * as schema from './db/schema';
import { loadEnv } from './env';

/**
 * better-auth configuration (ADR-0006/0018): email+password + passkeys, Drizzle/Postgres.
 * `role` is an admin-managed additional field (input:false → users can't self-assign) and feeds
 * the existing RBAC matrix (rbac.ts). A factory lets tests pass an in-memory (PGlite) db.
 */
export function createAuth(db: DB = getDb()) {
  const env = loadEnv();
  return betterAuth({
    secret: env.authSecret,
    baseURL: env.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [env.passkeyOrigin, env.corsOrigin],
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: false }),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    user: {
      additionalFields: {
        // input:false → clients can never self-assign these; only the admin API / bootstrap set them.
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
        status: { type: 'string', required: false, defaultValue: 'active', input: false },
        mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    plugins: [passkey({ rpID: env.rpID, rpName: 'ChatForge', origin: env.passkeyOrigin })],
  });
}

export const auth = createAuth();
export type Auth = ReturnType<typeof createAuth>;
