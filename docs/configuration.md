# Configuration

Every environment variable the API reads, what it does, and what happens if you get it wrong.
The single source of truth in code is [`apps/api/src/env.ts`](../apps/api/src/env.ts); the defaults
used by the stack are in [`docker-compose.yml`](../docker-compose.yml).

## Where to set these

**In production (Dokploy Compose app):**

1. Dokploy → your ChatForge Compose app → **Environment**.
2. Enter them as `KEY=value`, one per line — no quotes, no `export`.
3. **Save**, then **Deploy** (saving alone does not restart anything).

Dokploy writes that box to `/etc/dokploy/compose/<app>/code/.env` and Docker Compose uses it to fill
in the `${VAR}` placeholders in `docker-compose.production.yml`. The root `docker-compose.yml`
is development-only. Use the [production release checklist](production-recovery.md) for the VPS.

> **The one rule that bites:** a variable only reaches a container if it is listed under that
> service's `environment:` block in `docker-compose.yml`. Setting a var in Dokploy that compose
> doesn't forward does nothing at all — it will be silently ignored. If you add a new setting, add it
> to `environment:` in the same commit.

**In local development:** copy `apps/api/.env.example` to `apps/api/.env`. The converter can run
without a backend; authenticated features still require a separately configured Logto application.

## Identity (Logto)

| Variable | Required | Meaning |
|---|---|---|
| `LOGTO_ENDPOINT` | yes | Logto issuer base, e.g. `https://auth.robyrew.com` |
| `LOGTO_APP_ID` | yes | The **Traditional Web** application's id, from the Logto console |
| `LOGTO_APP_SECRET` | yes | Its secret. Server-side only — it never reaches the browser |
| `APP_BASE_URL` | yes | Public origin, e.g. `https://chat.robyrew.com`. Builds the OIDC redirect URIs. **No trailing slash** |
| `CORS_ORIGIN` | yes | The web origin allowed to call the API with credentials. Normally identical to `APP_BASE_URL` |
| `ADMIN_EMAIL` | first run | The first person to sign in with this email is granted `owner`, once. Inert afterwards |

In the Logto console the application must have redirect URI `<APP_BASE_URL>/api/auth/callback` and
post-sign-out redirect URI `<APP_BASE_URL>`. If sign-in loops or errors, that mismatch is the first
thing to check.

**If `LOGTO_APP_ID`/`LOGTO_APP_SECRET` are empty**, every sign-in fails. Passwords, passkeys, MFA and
social login are all configured in Logto, not here.

## Database

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/chatforge` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose only | Credentials for the bundled Postgres. **Must match `DATABASE_URL`** |

Migrations run automatically on boot. If Postgres isn't reachable at boot the container restart-loops
until it is — that is intentional, not a crash.

## Object storage (attachments + avatars)

| Variable | Required | Meaning |
|---|---|---|
| `GARAGE_RPC_SECRET` | production | Independent 32-byte random hex secret, storage service only |
| `S3_ENDPOINT` | — | `http://garage:3900` inside compose; loopback port 3900 for host-side development |
| `S3_BUCKET` / `S3_REGION` | — | `chatforge` / `us-east-1`; Garage provisions the bucket at startup |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | production | One dedicated random pair shared by Garage provisioning and the API, scoped to bucket read/write |
| `BLOB_QUOTA_BYTES` | — | Per-user storage cap. Default `536870912` (512 MB) |

There is no MinIO-root credential fallback. Production Compose fails when the S3 pair is missing.
Garage's existing keys are persistent: changing the secret for the same key ID only in an environment
file does not rotate the stored key. Follow the explicit rotation procedure in the recovery runbook.

**With no credentials at all**, uploads are simply disabled: the blob routes answer `503` and the rest
of the app is unaffected. That's a supported way to run ChatForge, not a broken state.

See [storage.md](storage.md) for how blobs actually work and how to back them up.

## Integrations (optional)

| Variable | Required | Meaning |
|---|---|---|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | no | Enables the "now playing" status. Blank = the integration reports itself unavailable and its routes answer 503 |

The redirect URI in the Spotify dashboard must be `<APP_BASE_URL>/api/integrations/spotify/callback`,
matched exactly. Tokens are encrypted at rest with a key derived from `LOGTO_APP_SECRET` — **rotating
that secret invalidates stored integration tokens** and users must reconnect. See
[integrations.md](integrations.md).

## Web

| Variable | Required | Meaning |
|---|---|---|
| `VITE_API_URL` | no | **Leave unset.** Build-time only. The SPA calls `/api` on its own origin; set this only for a split-origin deploy |

## Verifying what actually reached a container

Check presence without exposing values:

```bash
sudo docker exec <api-container> node -e 'for (const k of ["DATABASE_URL", "LOGTO_APP_SECRET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]) console.log(k + ": " + (process.env[k] ? "set" : "missing"))'
```

Find the container name with `sudo docker ps --format '{{.Names}}'`. If a variable you set in Dokploy
is reported missing, check its explicit environment mapping. Never print all environment variables,
rendered Compose configuration, or control-plane responses into diagnostics.
