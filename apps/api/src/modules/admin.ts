import { Hono } from 'hono';
import { getAdminRepo } from '../admin/repo';
import { requirePermission, type SessionUser, type Vars } from '../middleware';
import { BUILTIN_ROLES, isPermission, isSystemRole, PERMISSIONS, type Permission, type RoleDef } from '../rbac';

/**
 * Admin console API — manage users, roles, per-user grants, feature flags and the audit log.
 * Never decrypts content. Hardened against privilege escalation: you can only assign roles / delegate
 * permissions that are a subset of your own; only an owner touches owner/admin; the last owner is
 * protected from removal or suspension. Every mutation is written to the audit log.
 */
export const adminModule = new Hono<Vars>();

const repo = () => getAdminRepo();
const actor = (c: { get: (k: 'user') => SessionUser | undefined }): SessionUser => c.get('user')!;

function parsePermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 100) return null;
  const out: Permission[] = [];
  for (const v of value) {
    if (!isPermission(v)) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Coerce/clamp a query param to a safe integer (rejects NaN/negative/huge → bounded). */
function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** Returns an error string if the actor may not assign `roleName`, else null (anti-escalation). */
async function assertCanAssignRole(a: SessionUser, roleName: string): Promise<string | null> {
  const role = await repo().getRole(roleName);
  if (!role) return 'role does not exist';
  if ((roleName === 'owner' || roleName === 'admin') && a.role !== 'owner') return 'only an owner can assign owner or admin';
  if (a.role !== 'owner') {
    const missing = role.permissions.filter((p) => !a.permissions.includes(p));
    if (missing.length) return `cannot assign a role granting permissions you lack: ${missing.join(', ')}`;
  }
  return null;
}

// ── Users ──────────────────────────────────────────────────────────────────

adminModule.get('/users', requirePermission('users:read'), async (c) => {
  const search = (c.req.query('search') || '').slice(0, 200) || undefined;
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 1_000_000);
  return c.json({ users: await repo().listUsers({ search, limit, offset }) });
});

adminModule.get('/users/:id', requirePermission('users:read'), async (c) => {
  const user = await repo().getUser(c.req.param('id'));
  if (!user) return c.json({ error: 'not found' }, 404);
  const [role, grants] = await Promise.all([repo().getRole(user.role), repo().listGrants(user.id)]);
  const effectivePermissions = await repo().effectivePermissionsFor(user.id, user.role);
  return c.json({ user, role, grants, effectivePermissions });
});

/** Create a user. Identity is owned by Logto — new login accounts are created in Logto (or via a
 *  Logto invitation), not here. A local user row appears automatically on first Logto sign-in; this
 *  console then manages their role/status/grants. Returns 501 to make that explicit. */
adminModule.post('/users', requirePermission('users:write'), (c) =>
  c.json(
    { error: 'create login accounts in Logto; this console manages roles/permissions for users who have signed in', supported: [] as string[] },
    501,
  ),
);

adminModule.post('/users/:id/role', requirePermission('roles:assign'), async (c) => {
  const a = actor(c);
  const id = c.req.param('id');
  if (id === a.id) return c.json({ error: 'cannot change your own role' }, 409);
  const { role } = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  if (typeof role !== 'string') return c.json({ error: 'role required' }, 400);
  const target = await repo().getUser(id);
  if (!target) return c.json({ error: 'not found' }, 404);
  const roleErr = await assertCanAssignRole(a, role);
  if (roleErr) return c.json({ error: roleErr }, 403);
  if (target.role === 'owner' && role !== 'owner' && (await repo().countByRole('owner')) <= 1) {
    return c.json({ error: 'cannot remove the last owner' }, 409);
  }
  await repo().setRole(id, role);
  await repo().log('user:role', a.id, `${id} -> ${role}`);
  return c.json({ user: await repo().getUser(id) });
});

adminModule.post('/users/:id/status', requirePermission('users:write'), async (c) => {
  const a = actor(c);
  const id = c.req.param('id');
  const { status } = (await c.req.json().catch(() => ({}))) as { status?: unknown };
  if (status !== 'active' && status !== 'suspended') return c.json({ error: 'status must be active|suspended' }, 400);
  const target = await repo().getUser(id);
  if (!target) return c.json({ error: 'not found' }, 404);
  if (status === 'suspended') {
    if (id === a.id) return c.json({ error: 'cannot suspend yourself' }, 409);
    if (target.role === 'owner' && (await repo().countByRole('owner')) <= 1) {
      return c.json({ error: 'cannot suspend the last owner' }, 409);
    }
  }
  await repo().setStatus(id, status);
  await repo().log('user:status', a.id, `${id} -> ${status}`);
  return c.json({ user: await repo().getUser(id) });
});

// ── Grants (delegation) ────────────────────────────────────────────────────

adminModule.get('/users/:id/grants', requirePermission('permissions:grant'), async (c) => {
  return c.json({ grants: await repo().listGrants(c.req.param('id')) });
});

adminModule.post('/users/:id/grants', requirePermission('permissions:grant'), async (c) => {
  const a = actor(c);
  const id = c.req.param('id');
  if (id === a.id) return c.json({ error: 'cannot change your own permissions' }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { permission?: unknown; effect?: unknown };
  if (!isPermission(body.permission)) return c.json({ error: 'unknown permission' }, 400);
  const effect = body.effect === 'deny' ? 'deny' : 'allow';
  if (!(await repo().getUser(id))) return c.json({ error: 'not found' }, 404);
  // Anti-escalation: you can only delegate a permission you hold yourself (owner holds all).
  if (a.role !== 'owner' && effect === 'allow' && !a.permissions.includes(body.permission)) {
    return c.json({ error: `cannot delegate a permission you lack: ${body.permission}` }, 403);
  }
  await repo().setGrant(id, body.permission, effect, a.id);
  await repo().log('grant:set', a.id, `${id} ${effect} ${body.permission}`);
  return c.json({ grants: await repo().listGrants(id) });
});

adminModule.delete('/users/:id/grants/:permission', requirePermission('permissions:grant'), async (c) => {
  const a = actor(c);
  const id = c.req.param('id');
  if (id === a.id) return c.json({ error: 'cannot change your own permissions' }, 409);
  const permission = c.req.param('permission');
  if (!isPermission(permission)) return c.json({ error: 'unknown permission' }, 400);
  await repo().removeGrant(id, permission);
  await repo().log('grant:remove', a.id, `${id} ${permission}`);
  return c.json({ grants: await repo().listGrants(id) });
});

// ── Roles ──────────────────────────────────────────────────────────────────

adminModule.get('/roles', requirePermission('users:read'), async (c) => c.json({ roles: await repo().listRoles() }));

/** All known permission names (+ a label) so the console can render a permission picker. */
adminModule.get('/permissions', requirePermission('users:read'), (c) => c.json({ permissions: PERMISSIONS }));

adminModule.post('/roles', requirePermission('roles:manage'), async (c) => {
  const a = actor(c);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; label?: unknown; description?: unknown; permissions?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
  if (!name) return c.json({ error: 'a role name (a-z0-9_-) is required' }, 400);
  if (isSystemRole(name) || BUILTIN_ROLES.some((r) => r.name === name)) return c.json({ error: 'that name is reserved' }, 409);
  if (await repo().getRole(name)) return c.json({ error: 'role already exists' }, 409);
  const permissions = parsePermissions(body.permissions);
  if (!permissions) return c.json({ error: 'permissions must be an array of known permission names' }, 400);
  if (a.role !== 'owner') {
    const missing = permissions.filter((p) => !a.permissions.includes(p));
    if (missing.length) return c.json({ error: `cannot grant permissions you lack: ${missing.join(', ')}` }, 403);
  }
  const role: RoleDef = { name, label: typeof body.label === 'string' && body.label ? body.label : name, description: typeof body.description === 'string' ? body.description : '', permissions, isSystem: false };
  await repo().upsertRole(role);
  await repo().log('role:create', a.id, name);
  return c.json({ role }, 201);
});

adminModule.post('/roles/:name', requirePermission('roles:manage'), async (c) => {
  const a = actor(c);
  const name = c.req.param('name');
  const existing = await repo().getRole(name);
  if (!existing) return c.json({ error: 'not found' }, 404);
  if (existing.isSystem) return c.json({ error: 'system roles cannot be edited' }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { label?: unknown; description?: unknown; permissions?: unknown };
  const permissions = body.permissions === undefined ? existing.permissions : parsePermissions(body.permissions);
  if (!permissions) return c.json({ error: 'permissions must be an array of known permission names' }, 400);
  if (a.role !== 'owner') {
    const missing = permissions.filter((p) => !a.permissions.includes(p));
    if (missing.length) return c.json({ error: `cannot grant permissions you lack: ${missing.join(', ')}` }, 403);
  }
  const role: RoleDef = {
    name,
    label: typeof body.label === 'string' && body.label ? body.label : existing.label,
    description: typeof body.description === 'string' ? body.description : existing.description,
    permissions,
    isSystem: false,
  };
  await repo().upsertRole(role);
  await repo().log('role:update', a.id, name);
  return c.json({ role });
});

adminModule.delete('/roles/:name', requirePermission('roles:manage'), async (c) => {
  const a = actor(c);
  const name = c.req.param('name');
  const existing = await repo().getRole(name);
  if (!existing) return c.json({ error: 'not found' }, 404);
  if (existing.isSystem) return c.json({ error: 'system roles cannot be deleted' }, 409);
  if ((await repo().countByRole(name)) > 0) return c.json({ error: 'role is still assigned to users; reassign them first' }, 409);
  await repo().deleteRole(name);
  await repo().log('role:delete', a.id, name);
  return c.json({ ok: true });
});

// ── Feature flags ──────────────────────────────────────────────────────────

adminModule.get('/flags', requirePermission('flags:write'), async (c) => c.json({ flags: await repo().listFlags() }));

adminModule.post('/flags/:flag', requirePermission('flags:write'), async (c) => {
  const a = actor(c);
  const flag = c.req.param('flag');
  const { enabled } = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof enabled !== 'boolean') return c.json({ error: 'enabled (boolean) required' }, 400);
  await repo().setFlag(flag, enabled);
  await repo().log('flag:set', a.id, `${flag}=${enabled}`);
  return c.json({ flag, enabled });
});

// ── Audit log ──────────────────────────────────────────────────────────────

adminModule.get('/audit', requirePermission('audit:read'), async (c) => {
  const limit = clampInt(c.req.query('limit'), 100, 1, 500);
  return c.json({ audit: await repo().listAudit(limit) });
});
