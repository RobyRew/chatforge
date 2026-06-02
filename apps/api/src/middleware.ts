import type { Context, MiddlewareHandler, Next } from 'hono';
import { hasPermission, isRole, type Permission, type Role } from './rbac';
import { stores } from './stores';

/** The authenticated user available to every handler. */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export type Vars = { Variables: { user?: SessionUser } };

function roleOf(u: { role?: unknown }): Role {
  return isRole(u.role) ? u.role : 'user';
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
 * Resolve the current user from the better-auth session cookie. A dev-only bearer fallback
 * (in-memory stores) is kept for the existing converter API tests; it only runs when there is
 * no session cookie, so tests never touch the database.
 */
export const resolveUser: MiddlewareHandler<Vars> = async (c, next) => {
  const cookie = c.req.header('cookie');
  if (cookie && cookie.includes('better-auth')) {
    try {
      // Lazy import keeps better-auth out of test/converter paths that never see a session cookie.
      const { auth } = await import('./auth');
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session?.user) {
        c.set('user', { id: session.user.id, email: session.user.email, role: roleOf(session.user) });
      }
    } catch {
      // DB unavailable or no valid session — fall through.
    }
  }

  if (!c.get('user') && process.env.NODE_ENV !== 'production') {
    const authz = c.req.header('Authorization');
    if (authz?.startsWith('Bearer ')) {
      const uid = stores.sessions.get(authz.slice(7));
      const u = uid ? stores.users.get(uid) : undefined;
      if (u && u.status === 'active') c.set('user', { id: u.id, email: u.email, role: u.role });
    }
  }

  await next();
};

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
    if (!hasPermission(user.role, perm)) return c.json({ error: 'forbidden', need: perm }, 403);
    await next();
  };
}
