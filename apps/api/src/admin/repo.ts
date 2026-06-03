import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { auditLog, featureFlags, roles, user, userGrants } from '../db/schema';
import {
  BUILTIN_ROLES,
  effectivePermissions,
  isPermission,
  systemRolePermissions,
  type GrantEffect,
  type Permission,
  type PermissionGrant,
  type RoleDef,
} from '../rbac';

/**
 * Persistence boundary for the admin console: users, custom roles, per-user grants, feature flags
 * and the audit log. Two implementations (Drizzle for prod, in-memory for tests/dev), swappable via
 * `setAdminRepo` — exactly like `ChatRepo`. Authorization logic stays testable without a database.
 */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: 'active' | 'suspended';
  mustChangePassword: boolean;
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  actorId: string | null;
  action: string;
  detail: string | null;
}

export interface AdminRepo {
  listUsers(opts?: { search?: string; limit?: number; offset?: number }): Promise<AdminUser[]>;
  getUser(id: string): Promise<AdminUser | null>;
  getUserByEmail(email: string): Promise<AdminUser | null>;
  setRole(id: string, role: string): Promise<void>;
  setStatus(id: string, status: 'active' | 'suspended'): Promise<void>;
  setMustChangePassword(id: string, value: boolean): Promise<void>;
  countByRole(role: string): Promise<number>;

  listRoles(): Promise<RoleDef[]>;
  getRole(name: string): Promise<RoleDef | null>;
  upsertRole(role: RoleDef): Promise<void>;
  deleteRole(name: string): Promise<void>;

  listGrants(userId: string): Promise<PermissionGrant[]>;
  setGrant(userId: string, permission: Permission, effect: GrantEffect, grantedBy: string): Promise<void>;
  removeGrant(userId: string, permission: Permission): Promise<void>;

  /** Permissions of a role (custom from DB, else built-in fallback). */
  rolePermissions(role: string): Promise<Permission[]>;
  /** role permissions + grants (owner omnipotence is applied by the caller). */
  effectivePermissionsFor(userId: string, role: string): Promise<Permission[]>;

  listFlags(): Promise<Record<string, boolean>>;
  setFlag(flag: string, enabled: boolean): Promise<void>;

  log(action: string, actorId: string | null, detail?: string): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;
}

function toRoleDef(row: { name: string; label: string; description: string; permissions: string[] | null; isSystem: boolean }): RoleDef {
  return {
    name: row.name,
    label: row.label,
    description: row.description,
    permissions: (row.permissions ?? []).filter(isPermission),
    isSystem: row.isSystem,
  };
}

export class DrizzleAdminRepo implements AdminRepo {
  private get db() {
    return getDb();
  }

  async listUsers(opts: { search?: string; limit?: number; offset?: number } = {}): Promise<AdminUser[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where = opts.search
      ? or(ilike(user.email, `%${opts.search}%`), ilike(user.name, `%${opts.search}%`))
      : undefined;
    const rows = await this.db
      .select()
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(this.mapUser);
  }

  private mapUser(r: typeof user.$inferSelect): AdminUser {
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status === 'suspended' ? 'suspended' : 'active',
      mustChangePassword: r.mustChangePassword,
      createdAt: r.createdAt.getTime(),
    };
  }

  async getUser(id: string): Promise<AdminUser | null> {
    const rows = await this.db.select().from(user).where(eq(user.id, id)).limit(1);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async getUserByEmail(email: string): Promise<AdminUser | null> {
    const rows = await this.db.select().from(user).where(eq(user.email, email)).limit(1);
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async setRole(id: string, role: string): Promise<void> {
    await this.db.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, id));
  }

  async setStatus(id: string, status: 'active' | 'suspended'): Promise<void> {
    await this.db.update(user).set({ status, updatedAt: new Date() }).where(eq(user.id, id));
  }

  async setMustChangePassword(id: string, value: boolean): Promise<void> {
    await this.db.update(user).set({ mustChangePassword: value, updatedAt: new Date() }).where(eq(user.id, id));
  }

  async countByRole(role: string): Promise<number> {
    const agg = await this.db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.role, role));
    return agg[0]?.n ?? 0;
  }

  async listRoles(): Promise<RoleDef[]> {
    const rows = await this.db.select().from(roles);
    return rows.length ? rows.map(toRoleDef) : BUILTIN_ROLES;
  }

  async getRole(name: string): Promise<RoleDef | null> {
    const rows = await this.db.select().from(roles).where(eq(roles.name, name)).limit(1);
    if (rows[0]) return toRoleDef(rows[0]);
    return BUILTIN_ROLES.find((r) => r.name === name) ?? null;
  }

  async upsertRole(role: RoleDef): Promise<void> {
    await this.db
      .insert(roles)
      .values({ name: role.name, label: role.label, description: role.description, permissions: role.permissions, isSystem: role.isSystem })
      .onConflictDoUpdate({
        target: roles.name,
        set: { label: role.label, description: role.description, permissions: role.permissions },
      });
  }

  async deleteRole(name: string): Promise<void> {
    await this.db.delete(roles).where(and(eq(roles.name, name), eq(roles.isSystem, false)));
  }

  async listGrants(userId: string): Promise<PermissionGrant[]> {
    const rows = await this.db.select().from(userGrants).where(eq(userGrants.userId, userId));
    const out: PermissionGrant[] = [];
    for (const r of rows) {
      if (isPermission(r.permission)) out.push({ permission: r.permission, effect: r.effect === 'deny' ? 'deny' : 'allow' });
    }
    return out;
  }

  async setGrant(userId: string, permission: Permission, effect: GrantEffect, grantedBy: string): Promise<void> {
    await this.db
      .insert(userGrants)
      .values({ userId, permission, effect, grantedBy })
      .onConflictDoUpdate({ target: [userGrants.userId, userGrants.permission], set: { effect, grantedBy } });
  }

  async removeGrant(userId: string, permission: Permission): Promise<void> {
    await this.db.delete(userGrants).where(and(eq(userGrants.userId, userId), eq(userGrants.permission, permission)));
  }

  async rolePermissions(role: string): Promise<Permission[]> {
    return (await this.getRole(role))?.permissions ?? systemRolePermissions(role);
  }

  async effectivePermissionsFor(userId: string, role: string): Promise<Permission[]> {
    const [rolePerms, grants] = await Promise.all([this.rolePermissions(role), this.listGrants(userId)]);
    return effectivePermissions(rolePerms, grants);
  }

  async listFlags(): Promise<Record<string, boolean>> {
    const rows = await this.db.select().from(featureFlags);
    return Object.fromEntries(rows.map((r) => [r.flag, r.enabled]));
  }

  async setFlag(flag: string, enabled: boolean): Promise<void> {
    await this.db
      .insert(featureFlags)
      .values({ flag, enabled })
      .onConflictDoUpdate({ target: featureFlags.flag, set: { enabled } });
  }

  async log(action: string, actorId: string | null, detail?: string): Promise<void> {
    await this.db.insert(auditLog).values({ action, actorId, detail: detail ?? null });
  }

  async listAudit(limit = 100): Promise<AuditEntry[]> {
    const rows = await this.db.select().from(auditLog).orderBy(desc(auditLog.ts)).limit(Math.min(limit, 500));
    return rows.map((r) => ({ id: r.id, ts: r.ts.getTime(), actorId: r.actorId, action: r.action, detail: r.detail }));
  }
}

let current: AdminRepo | undefined;

/** Defaults to Drizzle/Postgres; tests inject `MemoryAdminRepo` via `setAdminRepo` (no DB needed). */
export function getAdminRepo(): AdminRepo {
  if (!current) current = new DrizzleAdminRepo();
  return current;
}

export function setAdminRepo(repo: AdminRepo): void {
  current = repo;
}
