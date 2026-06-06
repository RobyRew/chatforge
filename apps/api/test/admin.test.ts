import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdminRepo } from '../src/admin/memoryRepo';
import { setAdminRepo } from '../src/admin/repo';
import { createApp } from '../src/app';

// Seeded dev users (middleware bearer fallback): u_owner=owner-token (owner), u_user=user-token (user).
const OWNER = 'owner-token';
const USER = 'user-token';

const app = createApp();
beforeEach(() => setAdminRepo(new MemoryAdminRepo())); // fresh state per test (no DB)

async function req(path: string, method: string, body?: unknown, token?: string): Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describe('admin — RBAC + users', () => {
  it('lists users only for a permitted role', async () => {
    expect((await req('/api/admin/users', 'GET', undefined, USER)).status).toBe(403);
    const res = await req('/api/admin/users', 'GET', undefined, OWNER);
    expect(res.status).toBe(200);
    const { users } = await json<{ users: Array<{ id: string }> }>(res);
    expect(users.map((u) => u.id).sort()).toEqual(['u_owner', 'u_user']);
  });

  it('exposes roles + permissions for the console', async () => {
    const roles = await json<{ roles: Array<{ name: string; isSystem: boolean }> }>(await req('/api/admin/roles', 'GET', undefined, OWNER));
    expect(roles.roles.map((r) => r.name).sort()).toEqual(['admin', 'moderator', 'owner', 'user']);
    const perms = await json<{ permissions: string[] }>(await req('/api/admin/permissions', 'GET', undefined, OWNER));
    expect(perms.permissions).toContain('permissions:grant');
  });

  it('assigns a role and reflects it in effective permissions', async () => {
    const res = await req('/api/admin/users/u_user/role', 'POST', { role: 'moderator' }, OWNER);
    expect(res.status).toBe(200);
    const detail = await json<{ user: { role: string }; effectivePermissions: string[] }>(
      await req('/api/admin/users/u_user', 'GET', undefined, OWNER),
    );
    expect(detail.user.role).toBe('moderator');
    expect(detail.effectivePermissions).toContain('audit:read'); // moderator perm
    expect(detail.effectivePermissions).not.toContain('convert:server');
  });
});

describe('admin — owner protection', () => {
  it('refuses to remove or suspend the last owner, or self-suspend', async () => {
    expect((await req('/api/admin/users/u_owner/role', 'POST', { role: 'user' }, OWNER)).status).toBe(409);
    expect((await req('/api/admin/users/u_owner/status', 'POST', { status: 'suspended' }, OWNER)).status).toBe(409);
  });
});

describe('admin — delegation (per-user grants)', () => {
  it('grants a permission that takes effect immediately, then revokes it', async () => {
    // Baseline: a plain user cannot read the audit log.
    expect((await req('/api/admin/audit', 'GET', undefined, USER)).status).toBe(403);

    // Owner delegates audit:read to the user.
    expect((await req('/api/admin/users/u_user/grants', 'POST', { permission: 'audit:read', effect: 'allow' }, OWNER)).status).toBe(200);
    expect((await req('/api/admin/audit', 'GET', undefined, USER)).status).toBe(200); // now allowed

    // Revoke → denied again.
    expect((await req('/api/admin/users/u_user/grants/audit:read', 'DELETE', undefined, OWNER)).status).toBe(200);
    expect((await req('/api/admin/audit', 'GET', undefined, USER)).status).toBe(403);
  });

  it('honors a deny grant that overrides a role permission', async () => {
    // user role has conversions:read; a deny grant removes it from effective permissions.
    await req('/api/admin/users/u_user/grants', 'POST', { permission: 'conversions:read', effect: 'deny' }, OWNER);
    const detail = await json<{ effectivePermissions: string[] }>(await req('/api/admin/users/u_user', 'GET', undefined, OWNER));
    expect(detail.effectivePermissions).not.toContain('conversions:read');
  });
});

describe('admin — anti-privilege-escalation', () => {
  it('stops an admin from granting owner/admin or delegating permissions they lack', async () => {
    // Promote the user to admin (only an owner can).
    expect((await req('/api/admin/users/u_user/role', 'POST', { role: 'admin' }, OWNER)).status).toBe(200);

    // As that admin: cannot assign owner/admin…
    expect((await req('/api/admin/users/u_owner/role', 'POST', { role: 'owner' }, USER)).status).toBe(403);
    // …and cannot delegate a permission an admin doesn't hold (roles:manage is owner-only).
    expect((await req('/api/admin/users/u_owner/grants', 'POST', { permission: 'roles:manage', effect: 'allow' }, USER)).status).toBe(403);
  });

  it('blocks changing your OWN role or permissions (no self-escalation / self-lockout)', async () => {
    await req('/api/admin/users/u_user/role', 'POST', { role: 'admin' }, OWNER); // promote to admin
    expect((await req('/api/admin/users/u_user/role', 'POST', { role: 'moderator' }, USER)).status).toBe(409);
    expect((await req('/api/admin/users/u_user/grants', 'POST', { permission: 'chat:use', effect: 'allow' }, USER)).status).toBe(409);
    expect((await req('/api/admin/users/u_user/grants/chat:use', 'DELETE', undefined, USER)).status).toBe(409);
  });
});

describe('admin — custom roles', () => {
  it('creates, assigns, protects and deletes a custom role', async () => {
    // Reserved + system-role protection.
    expect((await req('/api/admin/roles', 'POST', { name: 'admin', permissions: [] }, OWNER)).status).toBe(409);
    expect((await req('/api/admin/roles/user', 'DELETE', undefined, OWNER)).status).toBe(409);

    // Create a custom role and assign it.
    expect((await req('/api/admin/roles', 'POST', { name: 'support', label: 'Support', permissions: ['conversions:read', 'chat:use'] }, OWNER)).status).toBe(201);
    expect((await req('/api/admin/users/u_user/role', 'POST', { role: 'support' }, OWNER)).status).toBe(200);
    const detail = await json<{ effectivePermissions: string[] }>(await req('/api/admin/users/u_user', 'GET', undefined, OWNER));
    expect(detail.effectivePermissions.sort()).toEqual(['chat:use', 'conversions:read']);

    // Cannot delete a role still in use; can after reassigning.
    expect((await req('/api/admin/roles/support', 'DELETE', undefined, OWNER)).status).toBe(409);
    await req('/api/admin/users/u_user/role', 'POST', { role: 'user' }, OWNER);
    expect((await req('/api/admin/roles/support', 'DELETE', undefined, OWNER)).status).toBe(200);
  });
});

describe('admin — flags, audit, user creation (delegated to Logto)', () => {
  it('toggles flags, records audit entries; user creation is a 501 stub', async () => {
    expect((await req('/api/admin/flags/chat', 'POST', { enabled: true }, USER)).status).toBe(403);
    expect((await req('/api/admin/flags/chat', 'POST', { enabled: true }, OWNER)).status).toBe(200);

    await req('/api/admin/users/u_user/role', 'POST', { role: 'moderator' }, OWNER);
    const audit = await json<{ audit: Array<{ action: string }> }>(await req('/api/admin/audit', 'GET', undefined, OWNER));
    expect(audit.audit.some((e) => e.action === 'user:role')).toBe(true);
    expect(audit.audit.some((e) => e.action === 'flag:set')).toBe(true);

    // User creation is delegated to Logto (hosted sign-up); the admin endpoint is a 501 stub.
    // Authorization is still enforced first: a non-privileged user gets 403, an owner gets 501.
    expect((await req('/api/admin/users', 'POST', { email: 'x@y.z', password: 'pw' }, USER)).status).toBe(403);
    expect((await req('/api/admin/users', 'POST', { email: 'a@b.co', password: 'longenough' }, OWNER)).status).toBe(501);
  });
});
