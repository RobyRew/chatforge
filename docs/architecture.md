# Architecture

## Repository layout

```
chatforge/
├── agents.md                  decision log (ADRs) — read this for *why*
├── docs/                      this documentation — *what exists now*
├── packages/
│   ├── types/    @chatforge/types    canonical model + DTOs (zod), wire protocol
│   ├── core/     @chatforge/core     conversion engine: importers, exporters, transforms
│   └── crypto/   @chatforge/crypto   vault sealing (libsodium) + MLS provider (ts-mls)
├── apps/
│   ├── api/      @chatforge/api      Hono + zod-openapi + Drizzle/Postgres + ws
│   └── web/      @chatforge/web      Vite + React 19 SPA
└── infra/                     Dockerfiles, nginx.conf, Dokploy notes
```

Internal packages export **raw TypeScript** (`exports → ./src/index.ts`) — no build step for dev or
test; the apps bundle them. npm workspaces + Turborepo (`npx turbo run test typecheck build`).

## Runtime topology

One public domain. The web container's nginx (compose) or Traefik (Dokploy) routes `/api/*` and `/ws`
to the API; everything else is the SPA. Same-origin means the session cookie, the WebSocket and blob
uploads all work with no CORS or SameSite gymnastics.

```
                    ┌──────────── chat.robyrew.com (Traefik, TLS) ─────────────┐
  browser ─https──▶ │  /api/*, /ws  →  api (Hono :8787)                        │
                    │  everything else → web (nginx :8080, static SPA)         │
                    └──────────────────────────┬──────────────────────────────┘
                                               │
                        ┌──────────────────────┼──────────────────────┐
                        ▼                      ▼                      ▼
                  postgres:5432           minio:9000          auth.robyrew.com
                  metadata + ciphertext   blob bytes          Logto (identity)
```

Nothing except `web` is exposed to the internet. Postgres and MinIO are reachable only over the
compose network; their published ports are bound to `127.0.0.1`.

## The three independent security layers

These are often confused. They are separate, and each can fail without breaking the others:

1. **Identity** — *who you are*. Delegated entirely to self-hosted **Logto** (OIDC). The browser holds
   only an opaque `cf_sid` cookie; access/ID tokens never reach client JS. See [auth-logto.md](auth-logto.md).
2. **Authorization** — *what you may do*. Three layers in `apps/api/src/rbac.ts`: built-in system roles
   → admin-defined custom roles → per-user allow/deny grants (delegation). Effective permissions =
   role ∪ allow − deny; `owner` is omnipotent and unlockable. Enforced **server-side on every route**;
   the UI only hides what the server already refuses.
3. **Confidentiality** — *what can be read*. Client-side only. MLS (RFC 9420) for live chat, AES-GCM
   for the vault and attachments. The server is not a participant and holds no keys.

An admin has power over *accounts and features*, never over *content*. There is no "read messages"
permission, because there is no mechanism that could implement one.

## End-to-end chat: how a message actually travels

```
 sender browser                        server                      recipient browser
 ─────────────                         ──────                      ─────────────────
 Web Worker (chat.worker.ts)
   MLS group state in IndexedDB
   encrypt(payload) ──────► opaque bytes ──► chat_messages ──► ws relay ──► decrypt()
                                             (ciphertext,                    Web Worker
                                              seq, sender)                   IndexedDB cache
```

- **MLS runs in a dedicated Web Worker.** Key material and per-conversation group state live in the
  worker and the origin's IndexedDB — never on the main thread, never on the wire in plaintext. The
  worker processes operations **strictly serially** so the ratchet never races.
- **The payload inside the ciphertext is structured** (`apps/web/src/lib/chatPayload.ts`):
  `{t:'msg'}`, `{t:'file'}` or `{t:'reaction'}`. Replies and reactions reference a message by its
  **`seq`** — the per-conversation sequence number, which is the only id both peers share (local ids
  differ between sender and receiver). Attachment keys and filenames ride in here too.
- **Forward secrecy has a consequence:** MLS cannot re-decrypt old ciphertext, so decrypted plaintext
  is cached locally per device. On load the client renders its cache and decrypts only messages with a
  `seq` beyond its cursor, **in order**. A gap stops the run — later messages could not decrypt anyway.
- **Bootstrapping a DM:** each client publishes public MLS *KeyPackages* to the server and keeps the
  pool topped up to 5. Starting a DM claims one (single-use, consumed under `FOR UPDATE SKIP LOCKED`),
  builds the group, and relays a self-contained *Welcome*. If a peer has never opened Chat they have no
  KeyPackages published, and the UI says so explicitly rather than failing obscurely.

## What the server can and cannot see

The honest table. Anything not listed as encrypted is stored in the clear.

| Data | Server sees | Why |
|---|---|---|
| Message bodies, replies, reactions | **Ciphertext only** | MLS; the server holds no keys |
| Chat attachments (the bytes) | **Ciphertext only** | Per-file AES-256-GCM key, carried in the MLS payload |
| Attachment filename + MIME type | **No** | Deliberately kept out of the DB — they're in the encrypted payload |
| Vault (saved imported chats) | **Ciphertext only** | Device key or passphrase-derived key |
| Who talks to whom, and when | **Yes** | Membership and `seq`/timestamps are needed to route and order |
| Attachment byte size | **Yes** | Needed to enforce the per-user quota |
| Email, display name, username, bio, status | **Yes** | Profile data; needed to render a peer list |
| **Avatar images** | **Yes — plaintext** | Deliberate: they're profile data like a display name. Encrypting them would make them unrenderable to peers for no real gain. Recorded as ADR-0024 |
| Presence / typing / read receipts | **Yes** | Transient routing signals |

**Metadata is not protected.** ChatForge protects content, not the social graph. If that distinction
matters for a given threat model, this is not the right tool.

## Data model (Postgres, via Drizzle)

Migrations live in `apps/api/drizzle/` and are applied automatically on boot (`drizzle-kit migrate` in
the container's CMD). After a schema change: `npm run db:generate -w @chatforge/api`, then **commit**
the generated SQL — it applies on the next deploy.

| Group | Tables |
|---|---|
| Identity | `user` (keyed by `logto_sub`), `logto_sessions` |
| Authorization | `roles`, `user_grants`, `feature_flags`, `audit_log` |
| Chat | `chat_conversations`, `chat_members`, `chat_messages`, `user_presence` |
| Chat E2E (public artifacts only) | `key_packages`, `mls_welcomes` |
| Content | `vault_conversations`, `blobs`, `conversions` |

## Swappable seams

Every external dependency sits behind an interface with an in-memory twin, so the full authorization
path is testable with no Postgres, no MinIO and no network:

| Seam | Production | Test | Defined in |
|---|---|---|---|
| `ChatRepo` | Drizzle/Postgres | `MemoryChatRepo` | `apps/api/src/chat/repo.ts` |
| `AdminRepo` | Drizzle/Postgres | `MemoryAdminRepo` | `apps/api/src/admin/repo.ts` |
| `BlobRepo` | Drizzle/Postgres | `MemoryBlobRepo` | `apps/api/src/storage/blobRepo.ts` |
| `BlobStore` | S3/MinIO | `MemoryBlobStore` | `apps/api/src/storage/blobStore.ts` |
| `MlsProvider` | ts-mls | — (real, it's fast) | `packages/crypto/src/mls.ts` |

The `MlsProvider` seam is **bytes-only**: every value crossing it is a `Uint8Array`, and the provider
is stateless across calls. That keeps all ts-mls types inside `@chatforge/crypto`, so it can be
swapped for an audited mls-rs/WASM implementation without touching a single caller.

> **ts-mls is unaudited.** It is a correct-looking implementation of RFC 9420, not a reviewed one.
> This is a known, accepted risk (ADR-0018) and the reason the seam exists.

## Testing

```bash
npx turbo run test typecheck build     # everything
npx vitest run -w @chatforge/api       # one workspace
```

Server-side security behaviour is covered by real tests, not by inspection — membership gating,
privilege-escalation refusals, quota, upload caps, and image-type validation all have cases in
`apps/api/test/`. When you change an authorization rule, the test for it should fail first.
