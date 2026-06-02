import { Hono } from 'hono';
import type { Vars } from '../middleware';
import { stores, type User } from '../stores';

/**
 * Auth module — SCAFFOLD. Issues an opaque bearer token; there is no password/passkey check
 * yet. This is the seam where better-auth (passwords + passkeys + sessions) plugs in (ADR-0006).
 */
export const authModule = new Hono<Vars>();

authModule.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  if (!body.email) return c.json({ error: 'email required' }, 400);

  let user: User | undefined = [...stores.users.values()].find((u) => u.email === body.email);
  if (!user) {
    if (!stores.flagEnabled('registration')) return c.json({ error: 'registration disabled' }, 403);
    user = { id: 'u_' + Math.random().toString(36).slice(2, 11), email: body.email, role: 'user', status: 'active', createdAt: Date.now() };
    stores.users.set(user.id, user);
    stores.log('user:register', user.id, body.email);
  }
  if (user.status === 'suspended') return c.json({ error: 'account suspended' }, 403);

  const token = stores.newToken(user.id);
  return c.json({ token, user });
});

authModule.get('/me', (c) => {
  const user = c.get('user');
  return user ? c.json({ user }) : c.json({ error: 'unauthorized' }, 401);
});
