import { randomUUID } from 'node:crypto';
import LogtoClient, { type LogtoConfig } from '@logto/node';
import { eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { logtoSessions, user } from '../db/schema';
import { loadEnv } from '../env';

/**
 * Logto identity for ChatForge — **Traditional Web** (confidential client, server-side session).
 * This module is the ONLY place that talks to Logto. Flow:
 *   /api/auth/sign-in  → redirect to Logto's hosted UI
 *   /api/auth/callback → exchange the code, persist tokens server-side
 *   /api/auth/sign-out → end the Logto SSO session
 * Tokens live in the `logto_sessions` table (Postgres); the browser only ever holds the opaque
 * `cf_sid` cookie — no access/ID token ever reaches client JS. The WebSocket gateway and the REST
 * middleware both resolve the user from that same cookie. Identity only — the E2E crypto layer is
 * independent and client-side. See docs/auth-logto.md.
 */

const env = loadEnv();
export const SID_COOKIE = 'cf_sid';
const SESSION_TTL_MS = 14 * 86_400_000; // 14 days

// No requireEnv() here on purpose: importing this module must never throw (tests + the converter
// path import the app without Logto env / Postgres). A misconfigured client fails at request time.
export const logtoConfig: LogtoConfig = {
  endpoint: env.logtoEndpoint,
  appId: env.logtoAppId,
  appSecret: env.logtoAppSecret,
  // Claims we cache locally; Logto maps these onto the ID token.
  scopes: ['openid', 'profile', 'email'],
};

/** Public origin for redirect URIs. Behind Traefik (TLS terminated) trust APP_BASE_URL. */
export function publicOrigin(fallback: string): string {
  return (env.appBaseUrl || fallback).replace(/\/+$/, '');
}

// ── DB-backed Logto storage (one row per session id) ─────────────────────────
type StorageKV = Record<string, string>;

async function loadSession(sid: string): Promise<StorageKV> {
  const rows = await getDb().select({ data: logtoSessions.data }).from(logtoSessions).where(eq(logtoSessions.id, sid)).limit(1);
  const data = rows[0]?.data;
  if (!data) return {};
  try {
    return JSON.parse(data) as StorageKV;
  } catch {
    return {};
  }
}

async function saveSession(sid: string, data: StorageKV): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const json = JSON.stringify(data);
  await getDb()
    .insert(logtoSessions)
    .values({ id: sid, data: json, createdAt: now, expiresAt })
    .onConflictDoUpdate({ target: logtoSessions.id, set: { data: json, expiresAt } });
}

export async function dropSession(sid: string): Promise<void> {
  await getDb().delete(logtoSessions).where(eq(logtoSessions.id, sid));
}

export async function pruneExpiredSessions(): Promise<void> {
  await getDb().delete(logtoSessions).where(lt(logtoSessions.expiresAt, new Date()));
}

/**
 * @logto/node Storage interface (getItem/setItem/removeItem). The session blob is loaded once
 * (async) up-front and held in memory; writes persist back to Postgres. Hence makeLogtoClient is
 * async — callers `await` it.
 */
async function dbStorage(sid: string) {
  const data = await loadSession(sid);
  return {
    async getItem(key: string) {
      return data[key] ?? null;
    },
    async setItem(key: string, value: string) {
      data[key] = value;
      await saveSession(sid, data);
    },
    async removeItem(key: string) {
      delete data[key];
      await saveSession(sid, data);
    },
  };
}

/** Per-request Logto client bound to a session id. `navigate` captures redirect URLs. */
export async function makeLogtoClient(sid: string, navigate: (url: string) => void) {
  return new LogtoClient(logtoConfig, { navigate, storage: await dbStorage(sid) });
}

export interface LogtoIdClaims {
  sub: string;
  email?: string;
  name?: string;
  username?: string;
  email_verified?: boolean;
}

/** Verified ID-token claims for a session cookie, or null. Used by the middleware + WS gateway. */
export async function sessionClaims(sid: string): Promise<LogtoIdClaims | null> {
  try {
    const client = await makeLogtoClient(sid, () => {});
    const { isAuthenticated, claims } = await client.getContext();
    if (!isAuthenticated || !claims) return null;
    return claims as LogtoIdClaims;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth/logto] sessionClaims failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface AppUserBase {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: 'active' | 'suspended';
  mustChangePassword: boolean;
}

function mapBase(r: typeof user.$inferSelect): AppUserBase {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    username: r.username ?? null,
    role: r.role,
    status: r.status === 'suspended' ? 'suspended' : 'active',
    mustChangePassword: r.mustChangePassword,
  };
}

/** App `user.id` for a Logto subject, or null. Used by the WebSocket gateway. */
export async function appUserIdForSub(sub: string): Promise<string | null> {
  const rows = await getDb().select({ id: user.id }).from(user).where(eq(user.logtoSub, sub)).limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Get-or-create the local user row for verified Logto claims. On first sign-in the email/name come
 * from the ID token (scopes openid profile email); the username is left null (the user picks a handle
 * via /api/me/profile). The first sign-in matching ADMIN_EMAIL is granted 'owner' (once).
 */
export async function ensureAppUser(claims: LogtoIdClaims): Promise<AppUserBase> {
  const db = getDb();
  const found = await db.select().from(user).where(eq(user.logtoSub, claims.sub)).limit(1);
  if (found[0]) return mapBase(found[0]);

  const email = (claims.email ?? `${claims.sub}@users.noreply.logto`).trim().toLowerCase();
  const name = claims.name ?? claims.username ?? email;

  let role = 'user';
  if (env.adminEmail && email === env.adminEmail) {
    const owners = await db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.role, 'owner'));
    if ((owners[0]?.n ?? 0) === 0) role = 'owner';
  }

  await db
    .insert(user)
    .values({
      id: randomUUID(),
      logtoSub: claims.sub,
      email,
      name,
      role,
      status: 'active',
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: user.logtoSub });

  const rows = await db.select().from(user).where(eq(user.logtoSub, claims.sub)).limit(1);
  return mapBase(rows[0]!);
}
