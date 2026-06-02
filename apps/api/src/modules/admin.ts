import { Hono } from 'hono';
import { requirePermission, type Vars } from '../middleware';
import { isRole } from '../rbac';
import { stores } from '../stores';

/** Admin console API: manage users, roles, feature flags and the audit log — never content. */
export const adminModule = new Hono<Vars>();

adminModule.get('/users', requirePermission('users:read'), (c) => c.json({ users: [...stores.users.values()] }));

adminModule.post('/users/:id/role', requirePermission('roles:assign'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const { role } = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  if (!isRole(role)) return c.json({ error: 'invalid role' }, 400);
  if (role === 'owner' && actor.role !== 'owner') return c.json({ error: 'only an owner can grant owner' }, 403);
  const user = stores.users.get(id);
  if (!user) return c.json({ error: 'not found' }, 404);
  user.role = role;
  stores.log('role:assign', actor.id, `${id} -> ${role}`);
  return c.json({ user });
});

adminModule.post('/users/:id/status', requirePermission('users:write'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const { status } = (await c.req.json().catch(() => ({}))) as { status?: unknown };
  if (status !== 'active' && status !== 'suspended') return c.json({ error: 'invalid status' }, 400);
  const user = stores.users.get(id);
  if (!user) return c.json({ error: 'not found' }, 404);
  user.status = status;
  stores.log('user:status', actor.id, `${id} -> ${status}`);
  return c.json({ user });
});

adminModule.get('/flags', requirePermission('flags:write'), (c) =>
  c.json({ flags: Object.fromEntries(stores.flags) }),
);

adminModule.post('/flags/:flag', requirePermission('flags:write'), async (c) => {
  const actor = c.get('user')!;
  const flag = c.req.param('flag');
  const { enabled } = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof enabled !== 'boolean') return c.json({ error: 'enabled (boolean) required' }, 400);
  stores.flags.set(flag, enabled);
  stores.log('flag:set', actor.id, `${flag}=${enabled}`);
  return c.json({ flag, enabled });
});

adminModule.get('/audit', requirePermission('audit:read'), (c) => c.json({ audit: stores.audit.slice(0, 100) }));
