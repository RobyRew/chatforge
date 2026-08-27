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
in the `${VAR}` placeholders in `docker-compose.yml`.

> **The one rule that bites:** a variable only reaches a container if it is listed under that
> service's `environment:` block in `docker-compose.yml`. Setting a var in Dokploy that compose
> doesn't forward does nothing at all — it will be silently ignored. If you add a new setting, add it
> to `environment:` in the same commit.

**In local development:** copy `apps/api/.env.example` to `apps/api/.env`. Every value has a working
dev default, so `docker compose up` and `npm run dev` both work with no configuration.

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
| `MINIO_ROOT_USER` | recommended | Username for the bundled MinIO. Default `chatforge` |
| `MINIO_ROOT_PASSWORD` | recommended | Password for the bundled MinIO. **Set a real secret.** Minimum 8 characters |
| `S3_ENDPOINT` | — | Default `http://minio:9000` (the compose service) |
| `S3_BUCKET` / `S3_REGION` | — | Default `chatforge` / `us-east-1`. The bucket is created automatically on first use |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | only for external S3 | Point at Backblaze B2 or similar. **These take precedence over the MinIO values** |
| `BLOB_QUOTA_BYTES` | — | Per-user storage cap. Default `536870912` (512 MB) |

**You normally only set `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`.** The API falls back to them, so
there is one credential pair, not two to keep in sync. Setting `S3_SECRET_KEY` to something *different*
from `MINIO_ROOT_PASSWORD` is the classic mistake — it fails with an opaque
`SignatureDoesNotMatch` in the API log and every upload breaks.

**With no credentials at all**, uploads are simply disabled: the blob routes answer `503` and the rest
of the app is unaffected. That's a supported way to run ChatForge, not a broken state.

See [storage.md](storage.md) for how blobs actually work and how to back them up.

## Web

| Variable | Required | Meaning |
|---|---|---|
| `VITE_API_URL` | no | **Leave unset.** Build-time only. The SPA calls `/api` on its own origin; set this only for a split-origin deploy |

## Verifying what actually reached a container

Guessing is the enemy here. Ask the container:

```bash
sudo docker exec <api-container> printenv | sort
```

Find the container name with `sudo docker ps --format '{{.Names}}'`. If a variable you set in Dokploy
isn't in that list, it isn't forwarded in `docker-compose.yml` — that's the bug, not the value.
