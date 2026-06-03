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
  const out: Permission[] = [];
  for (const v of value) {
    if (!isPermission(v)) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
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
  const search = c.req.query('search') || undefined;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined;
  return c.json({ users: await repo().listUsers({ search, limit, offset }) });
});

adminModule.get('/users/:id', requirePermission('users:read'), async (c) => {
  const user = await repo().getUser(c.req.param('id'));
  if (!user) return c.json({ error: 'not found' }, 404);
  const [role, grants] = await Promise.all([repo().getRole(user.role), repo().listGrants(user.id)]);
  const effectivePermissions = await repo().effectivePermissionsFor(user.id, user.role);
  return c.json({ user, role, grants, effectivePermissions });
});

/** Create a user. v1 supports `method: 'password'` (set an initial password); `invite`/`ldap` are
 *  reserved seams returning 501 until SMTP/an LDAP connector is configured. */
adminModule.post('/users', requirePermission('users:write'), async (c) => {
  const a = actor(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
    method?: string;
    mustChangePassword?: boolean;
  };
  const method = body.method ?? 'password';
  if (method !== 'password') {
    return c.json({ error: `provisioning method '${method}' is not configured yet`, supported: ['password'] }, 501);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'a valid email is required' }, 400);
  if (typeof body.password !== 'string' || body.password.length < 8) {
    return c.json({ error: 'password must be at least 8 characters' }, 400);
  }
  const role = typeof body.role === 'string' && body.role ? body.role : 'user';
  const roleErr = await assertCanAssignRole(a, role);
  if (roleErr) return c.json({ error: roleErr }, 403);

  // Credentials are created by better-auth (correct password hashing); we then set role/flags.
  try {
    const { auth } = await import('../auth');
    const result = await auth.api.signUpEmail({ body: { email, password: body.password, name: body.name?.trim() || email } });
    const created = (result as { user?: { id?: string } } | null)?.user;
    if (!created?.id) return c.json({ error: 'failed to create user' }, 500);
    await repo().setRole(created.id, role);
    if (body.mustChangePassword !== false) await repo().setMustChangePassword(created.id, true);
    await repo().log('user:create', a.id, `${email} as ${role}`);
    return c.json({ user: await repo().getUser(created.id) }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to create user';
    return c.json({ error: message }, 409);
  }
});

adminModule.post('/users/:id/role', requirePermission('roles:assign'), async (c) => {
  const a = actor(c);
  const id = c.req.param('id');
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
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 100;
  return c.json({ audit: await repo().listAudit(limit) });
});
