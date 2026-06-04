import { Hono } from 'hono';
import { requireAuth, type Vars } from '../middleware';

/** Self-service account API (mounted at /api/me): identity, password, profile, passkeys. */
export const accountModule = new Hono<Vars>();

/** Current session user + computed effective permissions — the web reads this to drive its UI. */
accountModule.get('/', requireAuth(), (c) => c.json({ user: c.get('user') }));

/** Self-service password change (also clears the must-change-on-first-login flag on success). */
accountModule.post('/password', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { currentPassword?: string; newPassword?: string };
  if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
    return c.json({ error: 'currentPassword and newPassword (min 8 chars) are required' }, 400);
  }
  try {
    const { auth } = await import('../auth');
    await auth.api.changePassword({
      body: { currentPassword: body.currentPassword, newPassword: body.newPassword },
      headers: c.req.raw.headers,
    });
    const { getAdminRepo } = await import('../admin/repo');
    await getAdminRepo().setMustChangePassword(me.id, false);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'password change failed' }, 400);
  }
});

/** Update profile: a unique handle (`username`) and/or display `name`. */
accountModule.post('/profile', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; name?: unknown };
  const updates: { username?: string; name?: string; updatedAt: Date } = { updatedAt: new Date() };

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 60) return c.json({ error: 'name must be 1–60 characters' }, 400);
    updates.name = name;
  }
  if (body.username !== undefined && body.username !== null && body.username !== '') {
    if (typeof body.username !== 'string') return c.json({ error: 'invalid username' }, 400);
    const username = body.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return c.json({ error: 'username must be 3–20 chars: a–z, 0–9, underscore' }, 400);
    updates.username = username;
  }
  if (updates.name === undefined && updates.username === undefined) return c.json({ error: 'nothing to update' }, 400);

  const { getDb } = await import('../db');
  const { user } = await import('../db/schema');
  const { and, eq, ne } = await import('drizzle-orm');
  const db = getDb();
  if (updates.username) {
    const clash = await db.select({ id: user.id }).from(user).where(and(eq(user.username, updates.username), ne(user.id, me.id))).limit(1);
    if (clash.length) return c.json({ error: 'that username is taken' }, 409);
  }
  try {
    await db.update(user).set(updates).where(eq(user.id, me.id));
  } catch {
    return c.json({ error: 'that username is taken' }, 409); // unique-constraint race
  }
  const rows = await db.select({ id: user.id, email: user.email, name: user.name, username: user.username }).from(user).where(eq(user.id, me.id)).limit(1);
  return c.json({ user: rows[0] });
});

/** List the current user's passkeys (for an inventory / revoke UI). */
accountModule.get('/passkeys', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { passkey } = await import('../db/schema');
  const { desc, eq } = await import('drizzle-orm');
  const rows = await getDb()
    .select({ id: passkey.id, name: passkey.name, deviceType: passkey.deviceType, backedUp: passkey.backedUp, createdAt: passkey.createdAt })
    .from(passkey)
    .where(eq(passkey.userId, me.id))
    .orderBy(desc(passkey.createdAt));
  return c.json({
    passkeys: rows.map((r) => ({ id: r.id, name: r.name, deviceType: r.deviceType, backedUp: r.backedUp, createdAt: r.createdAt ? r.createdAt.getTime() : null })),
  });
});

/** Revoke one of the current user's passkeys (ownership enforced). */
accountModule.delete('/passkeys/:id', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { passkey } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');
  await getDb().delete(passkey).where(and(eq(passkey.id, c.req.param('id')), eq(passkey.userId, me.id)));
  return c.json({ ok: true });
});

/** Public PBKDF2 salt for the cross-device vault passphrase (null = passphrase mode not enabled). */
accountModule.get('/vault-salt', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { user } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await getDb().select({ salt: user.vaultSalt }).from(user).where(eq(user.id, me.id)).limit(1);
  return c.json({ salt: rows[0]?.salt ?? null });
});

/** Ensure a vault salt exists (generate once on first passphrase setup); returns the salt. */
accountModule.post('/vault-salt', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { user } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const db = getDb();
  const rows = await db.select({ salt: user.vaultSalt }).from(user).where(eq(user.id, me.id)).limit(1);
  let salt = rows[0]?.salt ?? null;
  if (!salt) {
    const { randomBytes } = await import('node:crypto');
    salt = randomBytes(16).toString('base64');
    await db.update(user).set({ vaultSalt: salt }).where(eq(user.id, me.id));
  }
  return c.json({ salt });
});
