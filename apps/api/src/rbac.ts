/**
 * Role-based access control + per-user permission grants (delegation).
 *
 * Three layers, in increasing specificity:
 *   1. Built-in **system roles** (owner/admin/moderator/user) — non-deletable defaults.
 *   2. **Custom roles** — admin-defined roles with arbitrary permission sets (stored in `roles`).
 *   3. **Per-user grants** — allow/deny individual permissions on top of a user's role (`user_grants`).
 *
 * Effective permissions = role permissions ∪ {allow grants} − {deny grants}. The `owner` role is
 * always omnipotent and never lockable (computed in middleware). Admin "access" never decrypts content.
 */

export const PERMISSIONS = [
  'users:read', // list/view accounts
  'users:write', // create/suspend/reset accounts
  'roles:assign', // assign an existing role to a user
  'roles:manage', // create / edit / delete custom roles
  'permissions:grant', // grant or deny individual permissions to a user (delegation)
  'flags:write', // toggle feature flags
  'audit:read', // read the audit log
  'convert:server', // run the opt-in server-side conversion sandbox
  'conversions:read', // read conversion history metadata
  'conversions:write', // save conversion history metadata
  'chat:use', // use the live chat
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The four built-in roles. A user's `role` may also be any custom role name. */
export const SYSTEM_ROLES = ['owner', 'admin', 'moderator', 'user'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export type GrantEffect = 'allow' | 'deny';
export interface PermissionGrant {
  permission: Permission;
  effect: GrantEffect;
}

/** A role definition (system or custom). Custom roles live in the DB; these seed the built-ins. */
export interface RoleDef {
  name: string;
  label: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
}

const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    'users:read',
    'users:write',
    'roles:assign',
    'permissions:grant',
    'flags:write',
    'audit:read',
    'convert:server',
    'conversions:read',
    'conversions:write',
    'chat:use',
  ],
  moderator: ['users:read', 'audit:read', 'conversions:read', 'chat:use'],
  user: ['convert:server', 'conversions:read', 'conversions:write', 'chat:use'],
};

/** Seed data for the `roles` table; also the fallback when the DB isn't reachable. */
export const BUILTIN_ROLES: RoleDef[] = [
  {
    name: 'owner',
    label: 'Owner',
    description: 'Full control, including ownership transfer and custom roles. Cannot be locked out.',
    permissions: SYSTEM_ROLE_PERMISSIONS.owner,
    isSystem: true,
  },
  {
    name: 'admin',
    label: 'Administrator',
    description: 'Manage users, assign roles, delegate permissions, toggle flags, read the audit log.',
    permissions: SYSTEM_ROLE_PERMISSIONS.admin,
    isSystem: true,
  },
  {
    name: 'moderator',
    label: 'Moderator',
    description: 'Read users and the audit log; use chat.',
    permissions: SYSTEM_ROLE_PERMISSIONS.moderator,
    isSystem: true,
  },
  {
    name: 'user',
    label: 'User',
    description: 'Standard access: convert chats and use live chat.',
    permissions: SYSTEM_ROLE_PERMISSIONS.user,
    isSystem: true,
  },
];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function isSystemRole(value: unknown): value is SystemRole {
  return typeof value === 'string' && (SYSTEM_ROLES as readonly string[]).includes(value);
}

/** Built-in role → permissions (used as a fallback when the DB `roles` table is unavailable). */
export function systemRolePermissions(role: string): Permission[] {
  return isSystemRole(role) ? [...SYSTEM_ROLE_PERMISSIONS[role]] : [];
}

/** Effective permissions = role permissions, plus `allow` grants, minus `deny` grants. */
export function effectivePermissions(
  rolePermissions: readonly Permission[],
  grants: readonly PermissionGrant[] = [],
): Permission[] {
  const set = new Set<Permission>(rolePermissions);
  for (const g of grants) if (g.effect === 'allow') set.add(g.permission);
  for (const g of grants) if (g.effect === 'deny') set.delete(g.permission);
  return [...set];
}
