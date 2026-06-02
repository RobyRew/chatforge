/** Role-based access control. Admin "access" lives here — it never extends to decrypting content. */
export const ROLES = ['owner', 'admin', 'moderator', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'users:read',
  'users:write',
  'roles:assign',
  'flags:write',
  'audit:read',
  'convert:server',
  'conversions:read',
  'conversions:write',
  'chat:use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: [
    'users:read',
    'users:write',
    'roles:assign',
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

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
