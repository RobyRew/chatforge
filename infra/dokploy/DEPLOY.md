# Deploying ChatForge on Dokploy (IONOS VPS)

Single **origin**, same-domain topology: the web SPA and the API share one domain. The web
container's nginx (in compose) — or Traefik (Dokploy Applications) — routes **`/api/*`** and
**`/ws`** to the API; everything else is the SPA. This keeps the Logto session cookie (`cf_sid`), the
WebSocket, and blob uploads all **same-origin**, with no CORS/SameSite gymnastics.

```
                         ┌────────── chat.<domain> (Traefik, TLS) ──────────┐
  browser ──https/wss──▶ │  /api/* , /ws  →  API (Hono :8787)               │
                         │  everything else →  web (nginx :8080, SPA)        │
                         └───────────────────────────────────────────────────┘
   API ──▶ Postgres (accounts, chat metadata, ciphertext)   ──▶ MinIO (encrypted attachments, avatars)
```

## 0. Prereqs
- Repo is at **`github.com/RobyRew/chatforge`** (already pushed).
- A Postgres database (Dokploy can provision one, or use the `postgres` service in compose).
- Object storage for attachments/avatars — the bundled `minio` service, or any S3-compatible endpoint.

---

## Option A — Dokploy **Compose** (recommended, simplest)
Deploy `docker-compose.yml` as a Dokploy *Compose* service. It already defines `postgres`, `minio`,
`mailpit`, `api`, `web`. The **web** container proxies `/api` + `/ws` to `api` internally, so you
expose **only the web service** to the internet.

1. **Create** a Dokploy Compose app pointing at the repo (`docker-compose.yml`).
2. **Domain**: attach `chat.<domain>` to the **`web`** service (port **8080**), enable Let's Encrypt.
   (Remove/ignore the local `ports:` host mappings — Traefik fronts it.)
3. **Env** (Dokploy → override the dev defaults in compose):
   - `LOGTO_ENDPOINT` = `https://auth.<domain>`  ·  `LOGTO_APP_ID` + `LOGTO_APP_SECRET` from the Logto
     console (**Traditional Web** application — see `docs/auth-logto.md`)
   - `APP_BASE_URL` = `https://chat.<domain>`  ·  `CORS_ORIGIN` = `https://chat.<domain>`
   - `ADMIN_EMAIL` — **first-run owner**: the first person to sign in with this email gets the `owner`
     role (once). Inert afterwards.
   - `POSTGRES_PASSWORD` (+ matching `DATABASE_URL`) — set a real secret.
   - `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` — set real secrets. That's all: the API falls back to
     these for object storage, so there is no second credential pair to keep in sync. Set
     `S3_ACCESS_KEY` / `S3_SECRET_KEY` **only** to point at an external S3. Leave everything blank to
     run without attachments/avatars — the blob routes answer 503 and nothing else breaks.
   In the **Logto console**, the app's redirect URI must be `https://chat.<domain>/api/auth/callback`
   and its post-sign-out URI `https://chat.<domain>`.
4. **Deploy.** On boot the API runs `drizzle-kit migrate`, then **bootstraps** the built-in roles, then
   starts. The web SPA build needs no `VITE_API_URL` (same-origin).

That's it — one public domain, internal Postgres/MinIO, auto-migrations.

> **Memory:** MinIO measures ~70 MB RSS in this stack — lighter than its reputation. Swap on the VPS
> is already provisioned by the Ansible `common` role (`swap_size_mb`), so there is nothing to do.
> Add MinIO's volume (`./.data/minio`) to the Restic backup set — attachments live only there, and see
> [docs/storage.md](../../docs/storage.md#where-the-bytes-live) for why that path needs care.
> `minio/minio:latest` is unpinned; pin it to the digest you're running once it's confirmed working.

---

## Option B — Dokploy **Applications** (two apps)
1. **API app**: Dockerfile `infra/api.Dockerfile`, build context = repo root, port **8787**, healthcheck `/health`.
2. **Web app**: Dockerfile `infra/web.Dockerfile`, port **8080**, domain `chat.<domain>`.
3. **Same-origin routing** — add a higher-priority Traefik router (Dokploy → API app → Advanced/Labels) so
   `/api` + `/ws` on the web's host go to the API:
   ```
   traefik.http.routers.cf-api.rule=Host(`chat.<domain>`) && (PathPrefix(`/api`) || PathPrefix(`/ws`))
   traefik.http.routers.cf-api.priority=100
   traefik.http.routers.cf-api.entrypoints=websecure
   traefik.http.routers.cf-api.tls.certresolver=letsencrypt
   traefik.http.services.cf-api.loadbalancer.server.port=8787
   ```
4. **Postgres**: provision in Dokploy; set `DATABASE_URL` on the API app.
5. **Env**: same as Option A (set on the API app; web needs none for same-origin).

> WebSockets pass through Traefik automatically (it forwards the `Upgrade`). Consider raising
> Traefik's idle timeout for long-lived sockets.

---

## Environment variables
| Service | Var | Value |
|---|---|---|
| API | `DATABASE_URL` | `postgres://…:…@<pg-host>:5432/chatforge` |
| API | `LOGTO_ENDPOINT` | `https://auth.<domain>` (Logto issuer base) |
| API | `LOGTO_APP_ID` / `LOGTO_APP_SECRET` | Traditional Web app credentials (secret stays server-side) |
| API | `APP_BASE_URL` | `https://chat.<domain>` — builds the OIDC redirect URIs (no trailing slash) |
| API | `CORS_ORIGIN` | `https://chat.<domain>` |
| API | `ADMIN_EMAIL` | first-run owner email (granted `owner` on first sign-in; then inert) |
| API | `S3_ENDPOINT` | `http://minio:9000` in compose |
| API | `S3_BUCKET` / `S3_REGION` | `chatforge` / `us-east-1` (created automatically on boot) |
| API | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | bundled MinIO credentials — the API uses these by default |
| API | `S3_ACCESS_KEY` / `S3_SECRET_KEY` | only for external S3; overrides the MinIO pair. All blank = uploads disabled (503) |
| API | `BLOB_QUOTA_BYTES` | per-user storage cap, default `536870912` (512 MB) |
| Web (build arg) | `VITE_API_URL` | **leave unset** (same-origin). Only set for a split-origin deploy. |

## Migrations
The API image auto-runs `drizzle-kit migrate` on boot (CMD), applying the committed
`apps/api/drizzle/*.sql`. After changing the schema: run `npm run db:generate -w @chatforge/api`
locally and **commit** the new migration — it'll apply on the next deploy. (Ensure Postgres is
reachable at boot; the container will restart-loop until it is.)

## Passkeys, passwords, MFA
All owned by **Logto** — configure them in the Logto console, not here. ChatForge only ever sees the
`cf_sid` session cookie (see `docs/auth-logto.md`).

## Post-deploy checks
1. `https://chat.<domain>/` → converter loads (works even if the API is down).
2. `/account` → **Sign in** bounces to Logto's hosted UI and back; `/api/me` returns your user.
3. `https://chat.<domain>/api/openapi.json` → 200 (API reachable, same-origin).
4. Sign in as the bootstrap owner (`ADMIN_EMAIL`) → **`/dashboard`** then **`/admin`** → Users / Roles /
   Feature flags / Audit load; assign a role, delegate a permission.
5. **Storage**: Settings → *Upload photo* (your avatar appears in chat), then in a DM attach a file with
   📎 or drag-and-drop — an image should preview inline for both sides. Troubleshooting table:
   [docs/storage.md](../../docs/storage.md#symptoms--cause).
6. **Chat**: open `/chat` in two browsers, start a DM by `@username` or email, and check presence,
   typing and read receipts. Both sides must have opened `/chat` at least once to publish MLS keys.

## Notes
- **RAM (2 GB VPS):** the API runs via `tsx`. Compiling to JS (esbuild/tsup) for prod would cut
  memory/startup — optional. Measured footprint: api ~25 MB, postgres ~15 MB, minio ~70 MB, web ~2 MB.
- **Backups:** Restic→B2 must cover **both** `.data/postgres` and `.data/minio`. See
  [docs/operations.md](../../docs/operations.md#backups).
- **Secrets:** set via Dokploy env, never committed. The compose dev defaults are for local only.
