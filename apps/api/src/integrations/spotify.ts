import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../env';
import { openToken, sealToken } from './tokenCrypto';

/**
 * Spotify "now playing" — reads the current track and publishes it as the user's chat status.
 *
 * Read-only: the only scope requested is `user-read-currently-playing`, so this can see what is
 * playing and nothing else — it cannot control playback, read the library, or modify the account.
 * Tokens live server-side, sealed (see tokenCrypto.ts); the browser never receives one.
 */
export const SPOTIFY_SCOPES = 'user-read-currently-playing';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing';

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  configured: boolean;
}

export function spotifyConfig(): SpotifyConfig {
  const { appBaseUrl } = loadEnv();
  const clientId = process.env['SPOTIFY_CLIENT_ID'] ?? '';
  const clientSecret = process.env['SPOTIFY_CLIENT_SECRET'] ?? '';
  return {
    clientId,
    clientSecret,
    redirectUri: `${appBaseUrl}/api/integrations/spotify/callback`,
    configured: !!(clientId && clientSecret),
  };
}

// ── CSRF state ──────────────────────────────────────────────────────────────
// Signed rather than stored: the callback must prove the flow was started by this user on this
// server. HMAC over `userId.expiry` with the app secret means no server-side state to clean up,
// and a state value cannot be replayed after it expires or reused for a different user.

const STATE_TTL_MS = 10 * 60 * 1000;

function stateKey(): Buffer {
  return Buffer.from(`spotify-oauth-state:${loadEnv().logtoAppSecret}`, 'utf8');
}

export function signState(userId: string): string {
  const payload = `${userId}.${Date.now() + STATE_TTL_MS}`;
  const mac = createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac}`;
}

/** Returns the userId the state was issued for, or null if it is forged, tampered or expired. */
export function verifyState(state: string): string | null {
  const [encoded, mac] = state.split('.');
  if (!encoded || !mac) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = createHmac('sha256', stateKey()).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const idx = payload.lastIndexOf('.');
  const userId = payload.slice(0, idx);
  const expiry = Number(payload.slice(idx + 1));
  if (!userId || !Number.isFinite(expiry) || Date.now() > expiry) return null;
  return userId;
}

export function authorizeUrl(userId: string): string {
  const cfg = spotifyConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    scope: SPOTIFY_SCOPES,
    state: signState(userId),
    show_dialog: 'false',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// ── token exchange ──────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const cfg = spotifyConfig();
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`spotify token request failed (${res.status})`);
  return (await res.json()) as TokenResponse;
}

export interface StoredTokens {
  accessToken: string; // sealed
  refreshToken: string; // sealed
  expiresAt: Date;
}

export async function exchangeCode(code: string): Promise<StoredTokens> {
  const cfg = spotifyConfig();
  const t = await tokenRequest(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }),
  );
  if (!t.refresh_token) throw new Error('spotify did not return a refresh token');
  return {
    accessToken: sealToken(t.access_token),
    refreshToken: sealToken(t.refresh_token),
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

/** Refresh an expired access token. Spotify may or may not rotate the refresh token. */
export async function refresh(sealedRefreshToken: string): Promise<StoredTokens> {
  const t = await tokenRequest(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: openToken(sealedRefreshToken) }),
  );
  return {
    accessToken: sealToken(t.access_token),
    refreshToken: t.refresh_token ? sealToken(t.refresh_token) : sealedRefreshToken,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

// ── now playing ─────────────────────────────────────────────────────────────

export interface NowPlaying {
  track: string;
  artist: string;
}

/**
 * The currently playing track, or null when nothing is playing. `null` is a normal, frequent
 * answer (Spotify returns 204 when idle) — not an error.
 */
export async function nowPlaying(sealedAccessToken: string): Promise<NowPlaying | null> {
  const res = await fetch(NOW_PLAYING_URL, {
    headers: { Authorization: `Bearer ${openToken(sealedAccessToken)}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 204) return null; // nothing playing
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`spotify now-playing failed (${res.status})`);
  const body = (await res.json()) as {
    is_playing?: boolean;
    currently_playing_type?: string;
    item?: { name?: string; artists?: Array<{ name?: string }> } | null;
  };
  if (!body.is_playing || body.currently_playing_type !== 'track' || !body.item?.name) return null;
  const artist = (body.item.artists ?? []).map((a) => a.name).filter(Boolean).join(', ');
  return { track: body.item.name, artist };
}

/** Signals that the access token needs refreshing. */
export class UnauthorizedError extends Error {
  constructor() {
    super('spotify access token rejected');
  }
}

/** The status line we publish. Bounded so it can't overflow the profile field. */
export function statusTextFor(np: NowPlaying): string {
  const s = np.artist ? `${np.track} — ${np.artist}` : np.track;
  return s.slice(0, 100);
}
