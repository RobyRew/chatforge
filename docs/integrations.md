# Integrations — Spotify "now playing"

Optional. With no credentials configured the routes answer `503` and nothing else changes.

## What it does

When you connect Spotify, your chat status follows what you're playing — `🎵 Track — Artist` — and
disappears when you stop. Peers see it live via the same `profile` frame that carries a name or
avatar change.

## What it deliberately does not do

| | |
|---|---|
| Scope requested | **`user-read-currently-playing` only** — it cannot control playback, read your library, or see anything else |
| Where tokens live | Server-side, **encrypted at rest** (AES-256-GCM, key derived from `LOGTO_APP_SECRET` via HKDF). A leaked database dump does not hand over your Spotify account |
| What the browser receives | Nothing. No token is ever sent to the client |
| When it polls | Only while you have a **live WebSocket** — no polling for people who aren't using the app |
| How often | Once a minute, sequentially across users |
| Manual status | **Never overwritten.** The integration records the status it set; if the profile no longer matches, it backs off and leaves your text alone |

## Setup

1. Create an app at [developer.spotify.com](https://developer.spotify.com/dashboard).
2. Add the redirect URI **exactly**:
   ```
   https://chat.robyrew.com/api/integrations/spotify/callback
   ```
   (`<APP_BASE_URL>/api/integrations/spotify/callback` in general. Spotify requires an exact match.)
3. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in Dokploy → Environment, then deploy.
4. In the app: **Settings → Integrations → Connect**.

## How the OAuth flow is secured

The `state` parameter is an **HMAC** over `userId.expiry`, signed with the app secret — not a random
value stashed in a session. That means:

- a callback cannot be replayed after 10 minutes,
- a state issued for one user cannot be re-pointed at another (the payload is inside the MAC),
- there is no server-side state to store or clean up.

The callback deliberately does **not** trust the session cookie for identity — it trusts the signed
state — so a cross-session redirect can't attach someone else's Spotify account to your user.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Connect` button missing | `SPOTIFY_CLIENT_ID`/`SECRET` not set — the API reports the integration as unavailable |
| Redirected back with `spotify=invalid` | The state expired (>10 min) or was tampered with. Just connect again |
| Redirected back with `spotify=failed` | Spotify rejected the code exchange — usually a redirect URI that doesn't match character-for-character |
| Connected, but status never updates | Status only updates while the app is open. Check the API log for `[spotify]` warnings |
| Status stuck on an old track | You (or another device) set a status manually; the integration will not overwrite it |
| All integrations broke after rotating `LOGTO_APP_SECRET` | Expected — the token encryption key derives from it. Reconnect |

## Adding another provider

`apps/api/src/integrations/` is structured for it: `tokenCrypto.ts` is provider-agnostic, the
`user_integrations` table is keyed by `(userId, provider)`, and the poller in `nowPlaying.ts` reads
rows by provider. A new provider needs its own OAuth module plus one entry in the settings registry.
