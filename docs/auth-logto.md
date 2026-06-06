# Authentication — Logto (Traditional Web)

ChatForge delegates **all** identity to self-hosted **Logto** (`auth.robyrew.com`). The app keeps a
thin local `user` row keyed by the Logto subject (`logto_sub`); passwords, passkeys, social logins
and MFA all live in Logto. There is no auth code of our own to maintain beyond the OIDC dance below.

> Identity only. The end-to-end crypto layer (MLS / vault sealing) is **independent and client-side** —
> the server never sees private keys or plaintext. Logto authenticates *who you are*; it has nothing to
> do with message confidentiality.

## Shape: Traditional Web (confidential client, server-side session)

The Logto **Application** is a **Traditional Web** app (it has a secret). The API (`apps/api`, Hono) is
the confidential OIDC client and owns the session; the web SPA (`apps/web`) is a thin front-end that
relies on a cookie. **No access/ID token ever reaches client JS** — the browser holds only an opaque
`cf_sid` cookie. Same-origin in prod: `chat.robyrew.com` serves the SPA and Traefik routes `/api` +
`/ws` to the API; in dev, Vite proxies `/api` + `/ws` → `localhost:8787` so the cookie stays
same-origin over http.

```
Browser ──(cf_sid cookie)──▶ Hono API ──(confidential client)──▶ Logto (auth.robyrew.com/oidc)
   ▲  full-page redirects to /api/auth/*                              tokens persisted in
   └──────────── SPA reads /api/me (cookie) ─────────────            logto_sessions (Postgres)
```

### Endpoints (`apps/api/src/modules/auth.ts`)

- `GET /api/auth/sign-in?returnTo=/path` — mints `cf_sid`, redirects to Logto's hosted UI. `returnTo`
  is sanitised to local paths only (no open-redirect).
- `GET /api/auth/callback` — exchanges the code, persists tokens server-side, creates the local user
  row (`ensureAppUser`), redirects back to `returnTo`.
- `GET|POST /api/auth/sign-out` — ends the Logto SSO session (not just the local one) and clears `cf_sid`.

The SPA never calls these via fetch — they are **top-level navigations** (`window.location`). See
`apps/web/src/lib/authClient.ts` (`signIn()` / `signOut()` / `useSession()`).

### Where the user is resolved

- **REST**: `apps/api/src/middleware.ts` `resolveUser` reads `cf_sid` → verified ID-token claims →
  `ensureAppUser` → attaches the user + RBAC permissions to every request.
- **WebSocket**: `apps/api/src/server.ts` `authenticate` reads the **same `cf_sid` cookie** off the
  upgrade request (same-origin WS sends it automatically) → app user id. No token-in-subprotocol.
- **Session store**: `logto_sessions` (Postgres) holds the `@logto/node` client state per `cf_sid`;
  pruned by TTL on each sign-in. See `apps/api/src/auth/logto.ts`.

## Config

| Env (API) | Meaning |
|---|---|
| `LOGTO_ENDPOINT` | Issuer base, e.g. `https://auth.robyrew.com` |
| `LOGTO_APP_ID` / `LOGTO_APP_SECRET` | The Traditional Web app credentials (secret is server-side only) |
| `APP_BASE_URL` | Public origin for redirect URIs (e.g. `https://chat.robyrew.com`) |
| `CORS_ORIGIN` | The web origin allowed to call the API with credentials |
| `ADMIN_EMAIL` | First sign-in with this email is granted the `owner` role (once) |
| `DATABASE_URL` | Postgres — holds `user`, `logto_sessions`, RBAC, chat metadata |

In the **Logto console** the app must have:
- Redirect URI: `${APP_BASE_URL}/api/auth/callback`
- Post sign-out redirect URI: `${APP_BASE_URL}`

RBAC (roles/permissions/grants) is unchanged and still enforced server-side; it just keys off the
Logto-backed `user.id`.

## Security properties

- Tokens stay **server-side** (in `logto_sessions`); the browser holds only an opaque, `HttpOnly`,
  `SameSite=Lax`, `Secure` (in prod) cookie. XSS can't exfiltrate a token.
- Sign-out hits Logto **end-session**, so it actually kills the SSO session.
- `returnTo` is restricted to local paths (no open-redirect).
- Behind Traefik the API trusts `APP_BASE_URL` for redirect URIs (TLS terminated upstream), not the
  raw request origin.
- The API never trusts client-set identity headers — the user is derived from the verified session.

## Deploy / cutover note

Migration `drizzle/0007_*` performs the better-auth → Logto cutover: it **drops** `account`,
`passkey`, `session`, `verification` and re-keys `user` (`+ logto_sub NOT NULL UNIQUE`, `- email_verified`).
`ADD COLUMN logto_sub NOT NULL` requires an **empty `user` table** — so this is a clean cutover: wipe
any pre-Logto `user` rows (or start from a fresh DB) before migrating. New users are created on their
first Logto sign-in.
