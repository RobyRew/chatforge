/**
 * Typed, same-origin client for the ChatForge API (`/api/*`). Cookies are sent with every request
 * so the better-auth session authenticates the admin endpoints. Errors surface the server's
 * `{ error }` message. The web treats permissions as opaque strings (the API is the source of truth).
 */
import type { ChatMessageDTO, ConversationSummary, WelcomeDTO } from '@chatforge/types';

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function toError(res: Response): Promise<ApiError> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON */
  }
  return new ApiError(message, res.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);
const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' });

// ── Shapes (mirror the API DTOs; permissions/roles are dynamic strings) ──
export type GrantEffect = 'allow' | 'deny';
export interface Me {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: 'active' | 'suspended';
  mustChangePassword: boolean;
  permissions: string[];
}
export interface Passkey {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: number | null;
}
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: 'active' | 'suspended';
  mustChangePassword: boolean;
  createdAt: number;
}
export interface RoleDef {
  name: string;
  label: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
}
export interface Grant {
  permission: string;
  effect: GrantEffect;
}
export interface AuditEntry {
  id: string;
  ts: number;
  actorId: string | null;
  action: string;
  detail: string | null;
}
export interface UserDetail {
  user: AdminUser;
  role: RoleDef | null;
  grants: Grant[];
  effectivePermissions: string[];
}

export const api = {
  me: (): Promise<Me> => get<{ user: Me }>('/api/me').then((r) => r.user),
  changePassword: (currentPassword: string, newPassword: string): Promise<{ ok: boolean }> =>
    post('/api/me/password', { currentPassword, newPassword }),
  updateProfile: (input: { username?: string; name?: string }): Promise<{ user: { id: string; email: string; name: string; username: string | null } }> =>
    post('/api/me/profile', input),
  listPasskeys: (): Promise<Passkey[]> => get<{ passkeys: Passkey[] }>('/api/me/passkeys').then((r) => r.passkeys),
  deletePasskey: (id: string): Promise<{ ok: boolean }> => del(`/api/me/passkeys/${id}`),

  admin: {
    listUsers: (search?: string): Promise<AdminUser[]> =>
      get<{ users: AdminUser[] }>(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => r.users),
    getUser: (id: string): Promise<UserDetail> => get<UserDetail>(`/api/admin/users/${id}`),
    createUser: (input: { email: string; password: string; name?: string; role?: string; mustChangePassword?: boolean }): Promise<{ user: AdminUser }> =>
      post('/api/admin/users', input),
    setRole: (id: string, role: string): Promise<{ user: AdminUser }> => post(`/api/admin/users/${id}/role`, { role }),
    setStatus: (id: string, status: 'active' | 'suspended'): Promise<{ user: AdminUser }> =>
      post(`/api/admin/users/${id}/status`, { status }),
    listGrants: (id: string): Promise<Grant[]> => get<{ grants: Grant[] }>(`/api/admin/users/${id}/grants`).then((r) => r.grants),
    setGrant: (id: string, permission: string, effect: GrantEffect): Promise<{ grants: Grant[] }> =>
      post(`/api/admin/users/${id}/grants`, { permission, effect }),
    removeGrant: (id: string, permission: string): Promise<{ grants: Grant[] }> =>
      del(`/api/admin/users/${id}/grants/${permission}`),

    listRoles: (): Promise<RoleDef[]> => get<{ roles: RoleDef[] }>('/api/admin/roles').then((r) => r.roles),
    listPermissions: (): Promise<string[]> => get<{ permissions: string[] }>('/api/admin/permissions').then((r) => r.permissions),
    createRole: (input: { name: string; label?: string; description?: string; permissions: string[] }): Promise<{ role: RoleDef }> =>
      post('/api/admin/roles', input),
    updateRole: (name: string, input: { label?: string; description?: string; permissions?: string[] }): Promise<{ role: RoleDef }> =>
      post(`/api/admin/roles/${name}`, input),
    deleteRole: (name: string): Promise<{ ok: boolean }> => del(`/api/admin/roles/${name}`),

    listFlags: (): Promise<Record<string, boolean>> => get<{ flags: Record<string, boolean> }>('/api/admin/flags').then((r) => r.flags),
    setFlag: (flag: string, enabled: boolean): Promise<{ flag: string; enabled: boolean }> =>
      post(`/api/admin/flags/${flag}`, { enabled }),

    listAudit: (limit = 100): Promise<AuditEntry[]> =>
      get<{ audit: AuditEntry[] }>(`/api/admin/audit?limit=${limit}`).then((r) => r.audit),
  },

  chat: {
    listConversations: (): Promise<ConversationSummary[]> =>
      get<{ conversations: ConversationSummary[] }>('/api/chat/conversations').then((r) => r.conversations),
    createDm: (target: { userId?: string; email?: string; username?: string }): Promise<{ conversationId: string; created: boolean }> =>
      post('/api/chat/conversations', target),
    listMessages: (conversationId: string, limit = 100): Promise<ChatMessageDTO[]> =>
      get<{ messages: ChatMessageDTO[] }>(`/api/chat/conversations/${conversationId}/messages?limit=${limit}`).then((r) => r.messages),

    keyPackageCount: (): Promise<number> => get<{ count: number }>('/api/chat/keypackages').then((r) => r.count),
    publishKeyPackages: (deviceId: string, keyPackages: string[]): Promise<{ published: number }> =>
      post('/api/chat/keypackages', { deviceId, keyPackages }),
    claimKeyPackage: (target: { userId?: string; email?: string; username?: string }): Promise<{ userId: string; keyPackage: string }> =>
      post('/api/chat/keypackages/claim', target),

    listWelcomes: (): Promise<WelcomeDTO[]> => get<{ welcomes: WelcomeDTO[] }>('/api/chat/welcomes').then((r) => r.welcomes),
    relayWelcome: (conversationId: string, recipientId: string, welcome: string): Promise<{ id: string }> =>
      post('/api/chat/welcomes', { conversationId, recipientId, welcome }),
    ackWelcome: (id: string): Promise<{ ok: boolean }> => del(`/api/chat/welcomes/${id}`),
  },
};
