import type { ConversionRecord } from '@chatforge/types';

/**
 * In-memory data layer for the dev bearer-token fallback and the converter/chat API tests (the real
 * admin data lives in Postgres via AdminRepo). Keeping it behind this module localizes the seam.
 */
export interface User {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'suspended';
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  actorId?: string;
  action: string;
  detail?: string;
}

function rid(prefix: string): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 11);
}

class Stores {
  readonly users = new Map<string, User>();
  readonly sessions = new Map<string, string>(); // token -> userId
  readonly flags = new Map<string, boolean>(); // global feature flags
  readonly userFlags = new Map<string, Map<string, boolean>>(); // userId -> flag -> enabled
  readonly audit: AuditEntry[] = [];
  readonly conversions = new Map<string, ConversionRecord[]>(); // userId -> records

  constructor() {
    this.seed();
  }

  private seed(): void {
    const owner: User = { id: 'u_owner', email: 'owner@chatforge.local', role: 'owner', status: 'active', createdAt: Date.now() };
    const user: User = { id: 'u_user', email: 'user@chatforge.local', role: 'user', status: 'active', createdAt: Date.now() };
    this.users.set(owner.id, owner);
    this.users.set(user.id, user);
    this.sessions.set('owner-token', owner.id);
    this.sessions.set('user-token', user.id);
    this.flags.set('server-side-conversion', true);
    this.flags.set('chat', false);
    this.flags.set('registration', true);
  }

  flagEnabled(flag: string, userId?: string): boolean {
    const override = userId ? this.userFlags.get(userId)?.get(flag) : undefined;
    if (override !== undefined) return override;
    return this.flags.get(flag) ?? false;
  }

  newToken(userId: string): string {
    const token = rid('tok');
    this.sessions.set(token, userId);
    return token;
  }

  log(action: string, actorId?: string, detail?: string): void {
    const entry: AuditEntry = { id: rid('a'), ts: Date.now(), action };
    if (actorId) entry.actorId = actorId;
    if (detail) entry.detail = detail;
    this.audit.unshift(entry);
    if (this.audit.length > 500) this.audit.length = 500;
  }
}

export const stores = new Stores();
