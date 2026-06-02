# Deploying ChatForge on Dokploy (IONOS VPS)

Single **origin**, same-domain topology: the web SPA and the API share one domain. The web
container's nginx (in compose) — or Traefik (Dokploy Applications) — routes **`/api/*`** and
**`/ws`** to the API; everything else is the SPA. This keeps the better-auth session cookie,
passkeys (WebAuthn), and the WebSocket all **same-origin**, with no CORS/SameSite gymnastics.

```
                         ┌────────── chat.<domain> (Traefik, TLS) ──────────┐
  browser ──https/wss──▶ │  /api/* , /ws  →  API (Hono :8787)               │
                         │  everything else →  web (nginx :8080, SPA)        │
                         └───────────────────────────────────────────────────┘
   API ──▶ Postgres (accounts, chat metadata, ciphertext)   ──▶ object storage (encrypted blobs, CH-5)
```

## 0. Prereqs
- Repo is at **`github.com/RobyRew/chatforge`** (already pushed).
- A Postgres database (Dokploy can provision one, or use the `postgres` service in compose).
- Object storage only needed for CH-5 (attachments) — Backblaze B2 or a MinIO service.

---

## Option A — Dokploy **Compose** (recommended, simplest)
Deploy `docker-compose.yml` as a Dokploy *Compose* service. It already defines `postgres`, `minio`,
`mailpit`, `api`, `web`. The **web** container proxies `/api` + `/ws` to `api` internally, so you
expose **only the web service** to the internet.

1. **Create** a Dokploy Compose app pointing at the repo (`docker-compose.yml`).
2. **Domain**: attach `chat.<domain>` to the **`web`** service (port **8080**), enable Let's Encrypt.
   (Remove/ignore the local `ports:` host mappings — Traefik fronts it.)
3. **Env** (Dokploy → override the dev defaults in compose):
   - `BETTER_AUTH_SECRET` = `openssl rand -base64 32`
   - `BETTER_AUTH_URL` = `https://chat.<domain>`  ·  `CORS_ORIGIN` = `https://chat.<domain>`
   - `PASSKEY_RPID` = `chat.<domain>`  ·  `PASSKEY_ORIGIN` = `https://chat.<domain>`
   - `POSTGRES_PASSWORD` (+ matching `DATABASE_URL`), `MINIO_ROOT_PASSWORD` — set real secrets.
4. **Deploy.** On boot the API runs `drizzle-kit migrate` (creates all 13 tables) then starts. The
   web SPA build needs no `VITE_API_URL` (same-origin).

That's it — one public domain, internal Postgres/MinIO, auto-migrations.

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
| API | `BETTER_AUTH_SECRET` | strong random (`openssl rand -base64 32`) |
| API | `BETTER_AUTH_URL` | `https://chat.<domain>` (public origin) |
| API | `CORS_ORIGIN` | `https://chat.<domain>` |
| API | `PASSKEY_RPID` | `chat.<domain>` (host, no scheme) |
| API | `PASSKEY_ORIGIN` | `https://chat.<domain>` (no trailing slash) |
| API | `S3_*` | object storage (CH-5 only) |
| Web (build arg) | `VITE_API_URL` | **leave unset** (same-origin). Only set for a split-origin deploy. |

## Migrations
The API image auto-runs `drizzle-kit migrate` on boot (CMD), applying the committed
`apps/api/drizzle/*.sql`. After changing the schema: run `npm run db:generate -w @chatforge/api`
locally and **commit** the new migration — it'll apply on the next deploy. (Ensure Postgres is
reachable at boot; the container will restart-loop until it is.)

## Passkeys (WebAuthn)
With same-origin, `PASSKEY_RPID` = the single domain (`chat.<domain>`) and `PASSKEY_ORIGIN` =
`https://chat.<domain>`. Passkeys require **HTTPS** (Let's Encrypt via Traefik handles this).

## Post-deploy checks
1. `https://chat.<domain>/` → converter loads (works even if the API is down).
2. `/account` → create an account, **register a passkey**, sign out, sign in with the passkey.
3. `https://chat.<domain>/api/openapi.json` → 200 (API reachable, same-origin).
4. Chat presence/typing/read once the CH-4 UI lands (the `/ws` transport is already live).

## Notes
- **RAM (2 GB VPS):** the API runs via `tsx`. To cut memory/startup, compile to JS (esbuild/tsup) for
  prod later — optional. Postgres + API + nginx + MinIO alongside your existing stack (Beszel/Umami/
  CrowdSec) is tight; watch memory.
- **Backups:** extend Restic→B2 to cover the Postgres volume (accounts + chat) and the object-storage bucket.
- **Secrets:** set via Dokploy env, never committed. The compose dev defaults are for local only.
