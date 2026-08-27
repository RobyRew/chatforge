# ChatForge

> Privacy-first **chat converter** + (future) chat platform.
> Import your *own* official chat exports, convert losslessly between formats, keep everything
> end-to-end encrypted. Web now; native macOS/iOS/Android later.

This is a greenfield rewrite of the old `chat-converter` (vanilla JS, WhatsApp⇄Telegram only).
See [`agents.md`](./agents.md) for the architecture decision log — the source of truth.

## What works today (v1)
- **Conversion engine** (`@chatforge/core`): plugin registry + lossless canonical model.
  - Importers: **WhatsApp** (`.txt`), **Telegram** (JSON). _(Meta/Discord/Signal stubbed.)_
  - Exporters: **Telegram JSON**, **WhatsApp txt**, **HTML viewer**, **Markdown**, **canonical JSON**.
  - Every conversion produces a **fidelity report** (preserved / approximated / dropped).
  - Runs the **same engine** in the browser (Web Worker) and in Node (server sandbox).
- **Web SPA** (`@chatforge/web`): drag-drop converter, auto-detect, preview report, download — 100% client-side.
- **Crypto** (`@chatforge/crypto`): zero-knowledge `seal`/`open` (Argon2id + XChaCha20-Poly1305), BIP39 recovery,
  and **real MLS (RFC 9420)** via `ts-mls` behind a bytes-only, swappable provider.
- **API** (`@chatforge/api`): Hono + OpenAPI, RBAC admin (roles / feature flags / audit), and an **opt-in
  server-side conversion sandbox** (ephemeral, zeroized, audit-logged). Identity via self-hosted **Logto** (OIDC),
  data in Postgres/Drizzle, blobs in S3-compatible object storage.
- **Infra**: multi-stage Dockerfiles (web → nginx-unprivileged, api → node:22), nginx CSP, `docker compose` (Postgres/MinIO/Mailpit), Dokploy notes.

## Documentation

Full docs live in **[`docs/`](docs/)** — start at [docs/README.md](docs/README.md).

| | |
|---|---|
| [architecture.md](docs/architecture.md) | How it fits together, and exactly what the server can and cannot see |
| [configuration.md](docs/configuration.md) | Every environment variable, and where to set it |
| [storage.md](docs/storage.md) | Attachments, avatars, MinIO, backups |
| [auth-logto.md](docs/auth-logto.md) | Sign-in, sessions, roles |
| [operations.md](docs/operations.md) | Production runbook — symptoms → causes → fixes |
| [infra/dokploy/DEPLOY.md](infra/dokploy/DEPLOY.md) | Deploying to the VPS |
| [agents.md](agents.md) | Decision log (ADRs) — *why* each choice was made |

**Verified:** 65 tests green (core 25 · api 33 · crypto 7); all packages TypeScript-strict-clean; web builds.

## Not yet (next iteration)
MLS safety-number key verification · Spotify “now playing” status · api-client codegen from OpenAPI ·
Meta/Discord/Signal importers · attachment garbage collection · native apps.
(Running status lives at the bottom of [`agents.md`](./agents.md).)

## Layout
`packages/{types,core,crypto}` · `apps/{web,api}` · `infra/` · `docs/`
(full map in [`agents.md`](./agents.md)).

## Quickstart
```bash
npm install                              # installs all workspaces
npm test                                 # run every workspace's tests (turbo)
npm run dev:web                          # converter UI at http://localhost:4321 (no backend needed)
npm run dev   --workspace @chatforge/api # API at http://localhost:8787 ( /health, /openapi.json )
docker compose up                        # full local stack: web + api + postgres + minio + mailpit
```

## Privacy
Conversion is client-side by default — plaintext never leaves your browser. Large files can
opt into an ephemeral, audit-logged server sandbox. Saved data is always E2E-encrypted; not
even an admin can read it. Admin controls accounts/roles/features — never content.

## License
Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
