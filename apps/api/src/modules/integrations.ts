import { Hono } from 'hono';
import { requireAuth, type Vars } from '../middleware';
import { authorizeUrl, exchangeCode, spotifyConfig, verifyState } from '../integrations/spotify';

/**
 * Third-party integrations (P4). Currently Spotify "now playing".
 *
 * The OAuth dance runs entirely server-side: the browser is redirected to Spotify and back, and the
 * tokens never leave the server (they are sealed before they touch the database). With no
 * `SPOTIFY_CLIENT_ID`/`SECRET` configured every route answers 503 and the rest of the app is
 * unaffected — the same "optional capability" pattern as object storage.
 */
export const integrationsModule = new Hono<Vars>();

/** What the Settings UI needs to render the card. */
integrationsModule.get('/', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const { configured } = spotifyConfig();
  let connected = false;
  if (configured) {
    const { getDb } = await import('../db');
    const { userIntegrations } = await import('../db/schema');
    const { and, eq } = await import('drizzle-orm');
    const rows = await getDb()
      .select({ id: userIntegrations.id })
      .from(userIntegrations)
      .where(and(eq(userIntegrations.userId, me.id), eq(userIntegrations.provider, 'spotify')))
      .limit(1)
      .catch(() => []);
    connected = rows.length > 0;
  }
  return c.json({ spotify: { available: configured, connected } });
});

/** Start the OAuth flow — a top-level navigation, not a fetch. */
integrationsModule.get('/spotify/connect', requireAuth(), (c) => {
  const me = c.get('user')!;
  if (!spotifyConfig().configured) return c.json({ error: 'spotify integration is not configured' }, 503);
  return c.redirect(authorizeUrl(me.id));
});

/**
 * OAuth callback. Note this does NOT use the session: the `state` parameter is an HMAC that already
 * proves which user started the flow, so a cross-session redirect can't attach someone else's
 * Spotify account to your user.
 */
integrationsModule.get('/spotify/callback', async (c) => {
  const { appBaseUrl } = (await import('../env')).loadEnv();
  const settings = `${appBaseUrl}/settings`;
  if (!spotifyConfig().configured) return c.redirect(`${settings}?spotify=unavailable`);

  const error = c.req.query('error');
  if (error) return c.redirect(`${settings}?spotify=denied`);

  const code = c.req.query('code');
  const state = c.req.query('state');
  const userId = state ? verifyState(state) : null;
  if (!code || !userId) return c.redirect(`${settings}?spotify=invalid`);

  try {
    const tokens = await exchangeCode(code);
    const { getDb } = await import('../db');
    const { userIntegrations } = await import('../db/schema');
    await getDb()
      .insert(userIntegrations)
      .values({ userId, provider: 'spotify', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt })
      .onConflictDoUpdate({
        target: [userIntegrations.userId, userIntegrations.provider],
        set: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, updatedAt: new Date() },
      });
    return c.redirect(`${settings}?spotify=connected`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[spotify] callback failed:', err instanceof Error ? err.message : err);
    return c.redirect(`${settings}?spotify=failed`);
  }
});

/** Disconnect: drop the tokens and clear any status this integration set. */
integrationsModule.delete('/spotify', requireAuth(), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { user, userIntegrations } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');
  const db = getDb();

  const rows = await db
    .select({ lastStatusText: userIntegrations.lastStatusText })
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, me.id), eq(userIntegrations.provider, 'spotify')))
    .limit(1);
  await db.delete(userIntegrations).where(and(eq(userIntegrations.userId, me.id), eq(userIntegrations.provider, 'spotify')));

  // Only clear the status if it is still the one we wrote — never wipe a manual status.
  const last = rows[0]?.lastStatusText;
  if (last) {
    const current = await db.select({ statusText: user.statusText }).from(user).where(eq(user.id, me.id)).limit(1);
    if (current[0]?.statusText === last) {
      const { clearStatus } = await import('../integrations/nowPlaying');
      await clearStatus(me.id);
    }
  }
  return c.json({ ok: true });
});
