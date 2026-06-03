import {
  BUILTIN_ROLES,
  effectivePermissions,
  systemRolePermissions,
  type GrantEffect,
  type Permission,
  type PermissionGrant,
  type RoleDef,
} from '../rbac';
import type { AdminRepo, AdminUser, AuditEntry } from './repo';

/**
 * In-memory AdminRepo for tests/dev — exercises the full authorization path (custom roles + grants)
 * without Postgres. Seeds the built-in roles and the dev users (`u_owner`/`u_user`) that pair with
 * the middleware's dev bearer-token fallback.
 */
export class MemoryAdminRepo implements AdminRepo {
  private users = new Map<string, AdminUser>();
  private roleDefs = new Map<string, RoleDef>();
  private grants = new Map<string, Map<Permission, GrantEffect>>();
  private flags = new Map<string, boolean>();
  private audit: AuditEntry[] = [];
  private counter = 0;

  constructor(seed = true) {
    for (const r of BUILTIN_ROLES) this.roleDefs.set(r.name, { ...r, permissions: [...r.permissions] });
    if (seed) {
      const now = Date.now();
      this.users.set('u_owner', { id: 'u_owner', email: 'owner@chatforge.local', name: 'Owner', role: 'owner', status: 'active', mustChangePassword: false, createdAt: now });
      this.users.set('u_user', { id: 'u_user', email: 'user@chatforge.local', name: 'User', role: 'user', status: 'active', mustChangePassword: false, createdAt: now });
      this.flags.set('server-side-conversion', true);
      this.flags.set('chat', false);
      this.flags.set('registration', true);
    }
  }

  /** Test/dev helper: insert a user record directly. */
  addUser(u: AdminUser): void {
    this.users.set(u.id, u);
  }

  async listUsers(opts: { search?: string; limit?: number; offset?: number } = {}): Promise<AdminUser[]> {
    let arr = [...this.users.values()];
    if (opts.search) {
      const s = opts.search.toLowerCase();
      arr = arr.filter((u) => u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s));
    }
    arr.sort((a, b) => b.createdAt - a.createdAt);
    const offset = opts.offset ?? 0;
    return arr.slice(offset, offset + (opts.limit ?? 50));
  }

  async getUser(id: string): Promise<AdminUser | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByEmail(email: string): Promise<AdminUser | null> {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async setRole(id: string, role: string): Promise<void> {
    const u = this.users.get(id);
    if (u) u.role = role;
  }

  async setStatus(id: string, status: 'active' | 'suspended'): Promise<void> {
    const u = this.users.get(id);
    if (u) u.status = status;
  }

  async setMustChangePassword(id: string, value: boolean): Promise<void> {
    const u = this.users.get(id);
    if (u) u.mustChangePassword = value;
  }

  async countByRole(role: string): Promise<number> {
    return [...this.users.values()].filter((u) => u.role === role).length;
  }

  async listRoles(): Promise<RoleDef[]> {
    return [...this.roleDefs.values()].map((r) => ({ ...r, permissions: [...r.permissions] }));
  }

  async getRole(name: string): Promise<RoleDef | null> {
    const r = this.roleDefs.get(name);
    return r ? { ...r, permissions: [...r.permissions] } : null;
  }

  async upsertRole(role: RoleDef): Promise<void> {
    this.roleDefs.set(role.name, { ...role, permissions: [...role.permissions] });
  }

  async deleteRole(name: string): Promise<void> {
    const r = this.roleDefs.get(name);
    if (r && !r.isSystem) this.roleDefs.delete(name);
  }

  async listGrants(userId: string): Promise<PermissionGrant[]> {
    const m = this.grants.get(userId);
    return m ? [...m.entries()].map(([permission, effect]) => ({ permission, effect })) : [];
  }

  async setGrant(userId: string, permission: Permission, effect: GrantEffect, _grantedBy: string): Promise<void> {
    const m = this.grants.get(userId) ?? new Map<Permission, GrantEffect>();
    m.set(permission, effect);
    this.grants.set(userId, m);
  }

  async removeGrant(userId: string, permission: Permission): Promise<void> {
    this.grants.get(userId)?.delete(permission);
  }

  async rolePermissions(role: string): Promise<Permission[]> {
    return this.roleDefs.get(role)?.permissions.slice() ?? systemRolePermissions(role);
  }

  async effectivePermissionsFor(userId: string, role: string): Promise<Permission[]> {
    return effectivePermissions(await this.rolePermissions(role), await this.listGrants(userId));
  }

  async listFlags(): Promise<Record<string, boolean>> {
    return Object.fromEntries(this.flags);
  }

  async setFlag(flag: string, enabled: boolean): Promise<void> {
    this.flags.set(flag, enabled);
  }

  async log(action: string, actorId: string | null, detail?: string): Promise<void> {
    this.audit.unshift({ id: `a_${++this.counter}`, ts: Date.now(), actorId, action, detail: detail ?? null });
    if (this.audit.length > 500) this.audit.length = 500;
  }

  async listAudit(limit = 100): Promise<AuditEntry[]> {
    return this.audit.slice(0, limit);
  }
}
