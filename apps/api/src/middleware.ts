import type { Context, MiddlewareHandler, Next } from 'hono';
import { getAdminRepo } from './admin/repo';
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
 * Resolve the current user from the better-auth session cookie (role/status/mustChangePassword come
 * from the session). A dev-only bearer fallback (in-memory stores) is kept for the converter/chat
 * API tests; it only runs when there is no session cookie, so tests never touch the database.
 */
export const resolveUser: MiddlewareHandler<Vars> = async (c, next) => {
  let base:
    | { id: string; email: string; name: string; username: string | null; role: string; status: 'active' | 'suspended'; mustChangePassword: boolean }
    | undefined;

  const cookie = c.req.header('cookie');
  if (cookie && cookie.includes('better-auth')) {
    try {
      // Lazy import keeps better-auth out of test/converter paths that never see a session cookie.
      const { auth } = await import('./auth');
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session?.user) {
        const u = session.user as {
          id: string;
          email: string;
          name?: unknown;
          username?: unknown;
          role?: unknown;
          status?: unknown;
          mustChangePassword?: unknown;
        };
        base = {
          id: u.id,
          email: u.email,
          name: typeof u.name === 'string' ? u.name : u.email,
          username: typeof u.username === 'string' ? u.username : null,
          role: typeof u.role === 'string' ? u.role : 'user',
          status: u.status === 'suspended' ? 'suspended' : 'active',
          mustChangePassword: u.mustChangePassword === true,
        };
      }
    } catch {
      // DB unavailable or no valid session — fall through.
    }
  }

  if (!base && process.env.NODE_ENV !== 'production') {
    const authz = c.req.header('Authorization');
    if (authz?.startsWith('Bearer ')) {
      const uid = stores.sessions.get(authz.slice(7));
      if (uid) {
        // Prefer the AdminRepo so role/status/grant changes reflect; fall back to the seed stores.
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
    c.set('user', {
      id: base.id,
      email: base.email,
      name: base.name,
      username: base.username,
      role: base.role,
      status: base.status,
      mustChangePassword: base.mustChangePassword,
      permissions,
    });
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
