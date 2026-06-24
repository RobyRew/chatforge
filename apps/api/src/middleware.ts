import type { Context, MiddlewareHandler, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getAdminRepo } from './admin/repo';
import { SID_COOKIE } from './auth/logto';
import { PERMISSIONS, systemRolePermissions, type Permission } from './rbac';
import { stores } from './stores';

/** The authenticated user available to every handler, with computed effective permissions. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: 'active' | 'suspended';
  mustChangePassword: boolean;
  permissions: Permission[];
}

export type Vars = { Variables: { user?: SessionUser } };

type UserBase = Omit<SessionUser, 'permissions'>;

/** Owner is omnipotent and never lockable; everyone else = role permissions + grants (DB), with a
 *  role-only fallback if the DB is unreachable. Suspended users get no permissions. */
async function resolvePermissions(userId: string, role: string, status: 'active' | 'suspended'): Promise<Permission[]> {
  if (status === 'suspended') return [];
  if (role === 'owner') return [...PERMISSIONS];
  try {
    return await getAdminRepo().effectivePermissionsFor(userId, role);
  } catch {
    return systemRolePermissions(role);
  }
}

/** Baseline security response headers applied to every route. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-site');
};

/**
 * Resolve the current user from the Logto **session cookie** (`cf_sid`). The cookie maps to a
 * server-side session (logto_sessions) holding the tokens; we read verified ID-token claims from it
 * and upsert the local user row (role/status/profile) on first sign-in. A dev-only opaque-bearer
 * fallback (in-memory stores) is kept for the converter/chat API tests; it only runs outside
 * production and when there's no session-cookie user, so tests never touch the database. Identity
 * only — the E2E crypto layer is separate and client-side.
 */
export const resolveUser: MiddlewareHandler<Vars> = async (c, next) => {
  let base: UserBase | undefined;

  // 1) Logto session cookie (production path).
  const sid = getCookie(c, SID_COOKIE);
  if (sid) {
    try {
      const { sessionClaims, ensureAppUser } = await import('./auth/logto');
      const claims = await sessionClaims(sid);
      if (claims) base = await ensureAppUser(claims);
    } catch (err) {
      // Logto/DB unreachable — leave the request unauthenticated (fail closed).
      // eslint-disable-next-line no-console
      console.error('[auth] session resolution failed:', err instanceof Error ? err.message : err);
    }
  }

  // 2) Dev-only opaque bearer fallback (tests/converter): only when there's no session-cookie user.
  if (!base && process.env.NODE_ENV !== 'production') {
    const authz = c.req.header('Authorization');
    const token = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : null;
    if (token) {
      const uid = stores.sessions.get(token);
      if (uid) {
        const au = await getAdminRepo().getUser(uid).catch(() => null);
        if (au) {
          base = { id: au.id, email: au.email, name: au.name, username: au.username, role: au.role, status: au.status, mustChangePassword: au.mustChangePassword };
        } else {
          const u = stores.users.get(uid);
          if (u) base = { id: u.id, email: u.email, name: u.email, username: null, role: u.role, status: u.status, mustChangePassword: false };
        }
      }
    }
  }

  if (base) {
    const permissions = await resolvePermissions(base.id, base.role, base.status);
    c.set('user', { ...base, permissions });
  }

  await next();
};

/** True if the (effective) session user holds a permission. */
export function userCan(user: SessionUser | undefined, perm: Permission): boolean {
  return !!user && user.permissions.includes(perm);
}

export function requireAuth(): MiddlewareHandler<Vars> {
  return async (c: Context<Vars>, next: Next) => {
    if (!c.get('user')) return c.json({ error: 'unauthorized' }, 401);
    await next();
  };
}

export function requirePermission(perm: Permission): MiddlewareHandler<Vars> {
  return async (c: Context<Vars>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    if (!user.permissions.includes(perm)) return c.json({ error: 'forbidden', need: perm }, 403);
    await next();
  };
}
