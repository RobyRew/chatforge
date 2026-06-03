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
 * Seed the first owner from ADMIN_EMAIL / ADMIN_PASSWORD — but only when **no owner exists yet**.
 * Once an owner exists (e.g. after you change the password in the panel), the env vars are inert.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const env = loadEnv();
  if (!env.adminEmail || !env.adminPassword) return;
  const db = getDb();

  const existingOwner = await db.select({ id: user.id }).from(user).where(eq(user.role, 'owner')).limit(1);
  if (existingOwner.length) return; // an owner already exists → bootstrap is a no-op

  // Reuse an account with this email if present; otherwise create it via better-auth (hashes password).
  const byEmail = await db.select({ id: user.id }).from(user).where(eq(user.email, env.adminEmail)).limit(1);
  let id = byEmail[0]?.id;
  if (!id) {
    const { auth } = await import('../auth');
    const res = await auth.api.signUpEmail({ body: { email: env.adminEmail, password: env.adminPassword, name: 'Owner' } });
    id = (res as { user?: { id?: string } } | null)?.user?.id;
  }
  if (id) {
    await db.update(user).set({ role: 'owner', status: 'active', mustChangePassword: false }).where(eq(user.id, id));
    // eslint-disable-next-line no-console
    console.log(`bootstrap: seeded owner ${env.adminEmail}`);
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
