# Deploying ChatForge on Dokploy (IONOS VPS)

Two apps, deployed independently behind Traefik (Let's Encrypt), matching the existing
infra (Dokploy + Traefik v3 + Tailscale + Beszel + Restic→B2).

## Web (SPA)
- **Type:** Dockerfile → `infra/web.Dockerfile` (build context = repo root)
- **Port:** 8080 (nginx-unprivileged)
- **Domain:** e.g. `chatforge.<domain>`
- Append the API origin to `connect-src` in `infra/nginx.conf` before going live.

## API (Hono)
- **Type:** Dockerfile → `infra/api.Dockerfile` (build context = repo root)
- **Port:** 8787 (`/health` for healthchecks)
- **Env:** `PORT`, `CORS_ORIGIN=https://chatforge.<domain>`, `DATABASE_URL`, `S3_*`
- **Domain:** e.g. `api.chatforge.<domain>`

## Backing services
- **Postgres** — Dokploy database (or the compose service). Run `npm run db:migrate -w @chatforge/api` after wiring Drizzle.
- **Object storage** — Backblaze B2 (already used for Restic) or self-hosted MinIO. Stores **ciphertext only**.

## Notes
- Both images are non-root with healthchecks.
- Secrets via Dokploy env (never committed). Keep `.env` out of git (see `.gitignore`).
