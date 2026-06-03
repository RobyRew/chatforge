import type { ComponentType } from 'react';
import { AuditSection } from './sections/AuditSection';
import { FlagsSection } from './sections/FlagsSection';
import { RolesSection } from './sections/RolesSection';
import { UsersSection } from './sections/UsersSection';
import type { AdminSectionProps } from './types';

/**
 * The admin console is assembled from this registry. Adding a feature = write a section component
 * and append one entry here; it appears as a tab for any user holding `permission`. Keep it modular.
 */
export interface AdminSection {
  id: string;
  label: string;
  /** Permission required to see this tab (effective permission, from /api/me). */
  permission: string;
  Component: ComponentType<AdminSectionProps>;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { id: 'users', label: 'Users', permission: 'users:read', Component: UsersSection },
  { id: 'roles', label: 'Roles', permission: 'roles:manage', Component: RolesSection },
  { id: 'flags', label: 'Feature flags', permission: 'flags:write', Component: FlagsSection },
  { id: 'audit', label: 'Audit log', permission: 'audit:read', Component: AuditSection },
];
