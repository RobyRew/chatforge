import { eq } from 'drizzle-orm';
import { loadEnv } from '../env';
import { BUILTIN_ROLES } from '../rbac';
import { getDb } from './index';
import { roles, user } from './schema';

/**
 * First-run / every-boot bootstrap. Runs after migrations (see server.ts). Safe to run repeatedly.
 */

/** Upsert the built-in system roles so the DB role definitions stay in sync with rbac.ts. */
export async function ensureBuiltinRoles(): Promise<void> {
  const db = getDb();
  for (const r of BUILTIN_ROLES) {
    await db
      .insert(roles)
      .values({ name: r.name, label: r.label, description: r.description, permissions: r.permissions, isSystem: true })
      .onConflictDoUpdate({
        target: roles.name,
        set: { label: r.label, description: r.description, permissions: r.permissions, isSystem: true },
      });
  }
}

/**
 * Grant the 'owner' role to ADMIN_EMAIL — but only when **no owner exists yet**. Identity lives in
 * Logto, so this only promotes an existing local user row (one is created on first Logto sign-in).
 * If that user hasn't signed in yet, the owner role is granted automatically on their first sign-in
 * (see auth/logto.ts → ensureAppUser). Once an owner exists, this is a no-op.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const env = loadEnv();
  if (!env.adminEmail) return;
  const db = getDb();

  const existingOwner = await db.select({ id: user.id }).from(user).where(eq(user.role, 'owner')).limit(1);
  if (existingOwner.length) return; // an owner already exists → no-op

  const byEmail = await db.select({ id: user.id }).from(user).where(eq(user.email, env.adminEmail)).limit(1);
  if (byEmail[0]) {
    await db.update(user).set({ role: 'owner', status: 'active' }).where(eq(user.id, byEmail[0].id));
    // eslint-disable-next-line no-console
    console.log(`bootstrap: promoted ${env.adminEmail} to owner`);
  }
}

/** Run all boot-time setup. Logs and continues on failure so a transient DB issue won't crash boot. */
export async function bootstrap(): Promise<void> {
  try {
    await ensureBuiltinRoles();
    await ensureBootstrapAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('bootstrap failed (continuing):', err instanceof Error ? err.message : err);
  }
}
