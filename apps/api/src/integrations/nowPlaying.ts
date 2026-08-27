import { broadcastToPeers, onlineUserIds } from '../chat/broadcast';
import { nowPlaying, refresh, spotifyConfig, statusTextFor, UnauthorizedError } from './spotify';

/**
 * The "now playing" poller.
 *
 * Polls **only users who currently have a live WebSocket** — on a 2 GB VPS, polling every account
 * that ever connected Spotify would be pure waste, and a status nobody is online to see is
 * pointless anyway. One pass every `POLL_INTERVAL_MS`, sequential rather than parallel, so a burst
 * of users can't fan out into a spike of outbound requests.
 *
 * It is careful never to clobber a status the user set by hand: it only writes or clears when the
 * stored `lastStatusText` still matches what is on the profile.
 */
const POLL_INTERVAL_MS = 60_000;
const MUSIC_EMOJI = '🎵';

let timer: ReturnType<typeof setInterval> | null = null;

export function startNowPlayingPoller(): void {
  if (timer || !spotifyConfig().configured) return;
  timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref(); // never hold the process open
}

export function stopNowPlayingPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** One pass over the online users who have connected Spotify. Exported for tests. */
export async function pollOnce(): Promise<void> {
  const online = onlineUserIds();
  if (!online.length) return;
  try {
    const { getDb } = await import('../db');
    const { userIntegrations } = await import('../db/schema');
    const { and, eq, inArray } = await import('drizzle-orm');
    const rows = await getDb()
      .select()
      .from(userIntegrations)
      .where(and(eq(userIntegrations.provider, 'spotify'), inArray(userIntegrations.userId, online)));
    for (const row of rows) {
      try {
        await syncUser(row);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[spotify] sync failed for a user:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[spotify] poll failed:', err instanceof Error ? err.message : err);
  }
}

type IntegrationRow = {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  lastStatusText: string | null;
};

async function syncUser(row: IntegrationRow): Promise<void> {
  const { getDb } = await import('../db');
  const { userIntegrations } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const db = getDb();

  let accessToken = row.accessToken;
  // Refresh a little early rather than waiting for a 401 round trip.
  if (row.expiresAt.getTime() - Date.now() < 60_000) {
    const t = await refresh(row.refreshToken);
    accessToken = t.accessToken;
    await db.update(userIntegrations).set({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, updatedAt: new Date() }).where(eq(userIntegrations.id, row.id));
  }

  let playing;
  try {
    playing = await nowPlaying(accessToken);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    const t = await refresh(row.refreshToken);
    await db.update(userIntegrations).set({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, updatedAt: new Date() }).where(eq(userIntegrations.id, row.id));
    playing = await nowPlaying(t.accessToken);
  }

  const next = playing ? statusTextFor(playing) : null;
  if (next === row.lastStatusText) return; // nothing changed — don't touch the profile or the wire

  const applied = await writeStatus(row.userId, next, row.lastStatusText);
  if (applied) {
    await db.update(userIntegrations).set({ lastStatusText: next, updatedAt: new Date() }).where(eq(userIntegrations.id, row.id));
  }
}

/**
 * Write the status only if the profile still carries the status we last set (or has none).
 * Returns false when the user has since set their own — in that case we leave it alone.
 */
async function writeStatus(userId: string, next: string | null, ours: string | null): Promise<boolean> {
  const { getDb } = await import('../db');
  const { user } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const db = getDb();

  const rows = await db.select({ statusText: user.statusText, statusEmoji: user.statusEmoji, name: user.name, username: user.username, email: user.email, image: user.image }).from(user).where(eq(user.id, userId)).limit(1);
  const current = rows[0];
  if (!current) return false;
  const manual = current.statusText !== null && current.statusText !== ours;
  if (manual) return false;

  const statusEmoji = next ? MUSIC_EMOJI : null;
  await db.update(user).set({ statusText: next, statusEmoji, updatedAt: new Date() }).where(eq(user.id, userId));
  broadcastToPeers(userId, {
    t: 'profile',
    userId,
    name: current.name,
    username: current.username,
    email: current.email,
    image: current.image,
    statusEmoji,
    statusText: next,
  });
  return true;
}

/** Clear a status this integration owns (used on disconnect). */
export async function clearStatus(userId: string): Promise<void> {
  await writeStatus(userId, null, null);
}
