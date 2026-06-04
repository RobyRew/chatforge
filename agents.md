# ChatForge — Architecture Decision Log & Agent Guide

> **This file is the living source of truth for architectural decisions.**
> Whenever we make a decision (stack, library, pattern, trade-off), append/update an
> **ADR entry** below with: _Context · Decision · Rationale · Status · Date_.
> Agents working in this repo MUST read this file first and keep it current.

ChatForge is a privacy-first **chat converter + (future) chat platform**. It imports
*official self-export files* from messaging apps (the user's own data — no scraping),
converts losslessly between formats, and will grow accounts, encrypted storage, an admin
access-control panel, real-time E2E chat, and native apps. Greenfield rewrite of the old
`chat-converter` (vanilla-JS, WhatsApp⇄Telegram only).

## Core principles
1. **Privacy-first / hybrid** — conversion runs **client-side by default**; plaintext stays in
   the browser. Large files may **opt in** to an **ephemeral server sandbox** (tmpfs, zeroized,
   never persisted in plaintext, audit-logged). Stored data is **always E2E-encrypted blobs**;
   not even an admin can decrypt. "Admin access" = RBAC over accounts/features/moderation.
2. **Lossless** — a rich canonical model is the single intermediate representation. Nothing is
   silently dropped: unmodeled data is preserved in `raw`, and every conversion emits a
   **fidelity report** (preserved / approximated / dropped).
3. **Modular & reusable** — plugin registry for importers/exporters: adding a platform =
   dropping in one file. Each backend module is independently editable/removable.
4. **API-first** — web is a pure SPA against a typed API; native apps (later) reuse the same
   API + OpenAPI spec + canonical schema.
5. **Isomorphic core** — `@chatforge/core` runs unchanged in the browser (Web Worker) and in
   Node (server sandbox). No DOM/Node-only assumptions in core.

## Repository layout
```
chatforge/
├── agents.md                 # this file
├── package.json              # npm workspaces root + turbo scripts
├── turbo.json · tsconfig.base.json
├── packages/
│   ├── types/    @chatforge/types    — canonical model + DTOs (zod), enums, reports
│   ├── core/     @chatforge/core     — engine: contracts, registry, pipeline, importers, exporters
│   ├── crypto/   @chatforge/crypto   — client E2E: key hierarchy, blob enc, MLS stubs
│   ├── api-client/ @chatforge/api-client — typed client (OpenAPI) for web + native
│   ├── ui/       @chatforge/ui       — shared React components (optional)
│   └── config/   @chatforge/config   — shared tsconfig/eslint/tailwind presets
├── apps/
│   ├── api/      @chatforge/api      — Hono + zod-openapi + Drizzle + better-auth
│   └── web/      @chatforge/web      — Vite + React SPA
└── infra/        Dockerfiles, nginx.conf, docker-compose, Dokploy notes
```

Internal packages export **raw TypeScript** (`exports → ./src/index.ts`); consumers
(Vite/Vitest/tsx) transpile on the fly — no build step needed for dev/test. Production apps
bundle their deps.

---

# Decisions (ADR log)

> Status legend: Accepted · Superseded · Proposed. Newest amendments noted inline.

## ADR-0001 — Privacy model: hybrid (2026-06-01) · Accepted
**Context:** User wants both "E2E-encrypt everything" and "convert from social media" and
"admin can grant/revoke access." Pure server-side conversion would expose plaintext; pure
zero-knowledge can't process very large files comfortably.
**Decision:** Conversion is **client-side by default**; large files may **opt in** to an
ephemeral server sandbox. Stored artifacts are always E2E-encrypted blobs + client-wrapped
keys. Admin = RBAC, **never decryption**.
**Rationale:** Maximizes privacy while staying practical; reconciles all three requirements.

## ADR-0002 — Web frontend: Vite + React SPA (2026-06-01) · Accepted
API-first SPA mirrors how native apps will consume the backend; matches the user's
React/Zustand habits; leanest option. (Alternatives weighed: Next.js, SvelteKit, Astro.)

## ADR-0003 — Backend: Node 22 + Hono (2026-06-01) · Accepted
Ultra-light, fast, Dokploy-friendly, TS — enables sharing core/crypto/types with web + native.

## ADR-0004 — Monorepo: npm workspaces + Turborepo (2026-06-01) · Accepted
**Amended from plan:** plan proposed pnpm; pnpm/corepack are **not installed** on the machine
and the user's established convention is **npm + package-lock**. Decision: **npm workspaces**
(zero global install) with **Turborepo** as the task runner. Shared packages: core/crypto/types.

## ADR-0005 — Data: Postgres + Drizzle; encrypted blobs in S3-compatible (2026-06-01) · Accepted
Relational metadata in Postgres via Drizzle; encrypted file blobs in MinIO (local) / Backblaze
B2 (VPS — already in use for Restic). DB/object store hold ciphertext only.

## ADR-0006 — Auth/RBAC: better-auth (2026-06-01) · Accepted
Email+password + passkeys + sessions; admin plugin (user management) + organization/roles
(RBAC). Argon2 hashing. Self-hostable, TS-native.

## ADR-0007 — Crypto: libsodium + Argon2id + BIP39 (2026-06-01) · Accepted
XChaCha20-Poly1305 secretstream for streaming blob enc; passphrase → Argon2id → master key →
wraps per-item DEKs; BIP39 recovery; optional WebAuthn/passkey unlock. MLS (RFC 9420)
interfaces stubbed for future chat. Keys never leave the client.

## ADR-0008 — API contract: @hono/zod-openapi (2026-06-01) · Accepted
zod schemas → typed routes + generated OpenAPI spec → codegen for the TS api-client and
future native (Swift/Kotlin) clients.

## ADR-0009 — Conversion: plugin registry + lossless canonical model + fidelity report (2026-06-01) · Accepted
Importer/Exporter contracts + a registry keyed by platform/format. Streaming async-iterables;
browser runs it in a Web Worker, Node runs the same engine for the server sandbox.

## ADR-0010 — Native readiness (2026-06-01) · Accepted
v1 only guarantees a clean boundary: API-first + OpenAPI spec + language-neutral canonical
schema. Later, native reuses the engine via WASM-compiled core or reimpl against the schema.

## ADR-0011 — Server sandbox hardening (2026-06-01) · Accepted
Opt-in only; tmpfs working dir, zeroized buffers, no plaintext persistence, full audit log;
reuses the isomorphic core. Output returned/stored only as encrypted blobs.

## ADR-0012 — ZIP handling: fflate (2026-06-01) · Accepted
`fflate` (tiny, fast, isomorphic) for reading/writing export archives in both browser and
Node — replaces the old tool's CDN `jszip`. Keeps core dependency footprint minimal.

## ADR-0013 — Internal packages export source TS (2026-06-01) · Accepted
Workspace packages expose `./src/index.ts` via `exports`; no build step for dev/test. Apps
bundle. Revisit if/when we publish packages externally (would add tsup/tsc build).

## ADR-0014 — libsodium consumed via its CJS build (2026-06-01) · Accepted
`libsodium-wrappers-sumo`'s ESM build is broken (its `./libsodium-sumo.mjs` import points to a
file in the separate `libsodium-sumo` package). We alias it to the working CJS build in Vitest
(`packages/crypto/vitest.config.ts`); any app/bundler importing `@chatforge/crypto` must do the same.

## ADR-0015 — WhatsApp inline markup ↔ entities (2026-06-01) · Accepted
WhatsApp's `*bold*` / `_italic_` / `~strike~` / ` ```mono``` ` is parsed into canonical entities on
import and rendered back on export (nesting supported; word-boundary rules avoid mangling `2*3=6` or
`snake_case`). So bold/italic/strike/mono round-trip WhatsApp↔Telegram. Underline/spoiler/links have
no WhatsApp syntax → degrade to plain text (reported as `entities: approximated`).

## ADR-0016 — Telegram polls/locations/contacts textualized (2026-06-01) · Accepted
v1 has no structured poll/location/contact model, so they become readable text (`📊 question…`,
`📍 place…`, `👤 name…`) with an appropriate message `kind`; the original payload stays in `raw`.
Nothing is silently dropped. Inline WhatsApp attachments-with-caption and empty `Sender:` messages
are also handled. Validated against real exports (below).

## ADR-0017 — Conversion = import → edit → export (2026-06-01) · Accepted
The worker's one-shot `convert()` is split into `importConversation()` + `exportConversation()`
(`convert()` stays as a thin wrapper, so the API/tests are unchanged). User edits are a pure, reversible
patch — `applyEdits(conv, Edits)` (rename participants, title/type, date-range filter, drop messages) —
applied between the two; isomorphic, reused by web now and api/native later. The web preview renders the
canonical model directly in React (instant, no re-export); tiny `@chatforge/core/{transforms,richtext}`
subpath exports keep the SPA bundle lean (+~9 KB).

## ADR-0018 — Chat platform: better-auth (passkeys) + ts-mls + ws (2026-06-01) · Accepted
Live E2E chat, foundation-first. **Auth:** better-auth (email+password + passkeys via `@better-auth/passkey`)
on Drizzle/Postgres, owning user/session/account/verification/passkey; a `role` additionalField feeds
`rbac.ts`; cookie sessions (a dev-only bearer fallback is retained so the converter API tests don't need a DB).
**E2E:** MLS (RFC 9420) via `ts-mls` behind the `MlsProvider` seam — unaudited, swappable for mls-rs/WASM.
**Transport:** `ws` attached to the Node server. Gotchas: better-auth's `@better-auth/*` peer chain
(`@better-auth/core`, `better-call`, `@better-auth/utils`) needs explicit installs under `legacy-peer-deps`
(ADR-0019); and `auth` is **lazy-imported** in the API so converter routes/tests never load the auth stack.

## ADR-0019 — legacy-peer-deps for the better-auth/zod split (2026-06-01) · Accepted
better-auth's `better-call` lists zod@^4 as an optional peer while the monorepo uses zod@3 (via
`@hono/zod-openapi`). `.npmrc` sets `legacy-peer-deps=true` so they coexist; the `@better-auth/*` peers are
installed explicitly. App tsconfigs set `declaration:false` (avoids TS2742 from the non-portable zod-v4 type).

## ADR-0020 — MLS realized: ts-mls behind a bytes-only, stateless `MlsProvider` (2026-06-03) · Accepted
**Context:** CH-3 wires real E2E. ADR-0018 chose `ts-mls`; this records the *realized* seam.
**Decision:** `packages/crypto/src/mls.ts` exposes `MlsProvider` where **every value crossing the seam is a
`Uint8Array`** (KeyPackages, group state, Welcomes, ciphertext). The provider is **stateless across calls**
(holds only the ciphersuite impl); the caller persists the returned group-state bytes (sealed via the vault →
IndexedDB) and relays the public bytes over the CH-2 transport unchanged. `createMlsProvider()` resolves
`getCiphersuiteImpl(getCiphersuiteFromName('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'))` (ts-mls **1.6.2**,
suite ID 1 — only `@hpke/core`, no `@noble`). Group state persists via `encode/decodeGroupState` (the
non-serializable `clientConfig` is reattached from `defaultClientConfig`); the private KeyPackage is
length-prefix-packed (ts-mls has no wire encoder for it). `startDm` = `createGroup` + `createCommit(add,
{ ratchetTreeExtension:true })` so the **Welcome is self-contained** (the joiner needs no external ratchet
tree). MLS is exposed via a **libsodium-free subpath** `@chatforge/crypto/mls` (only imports `ts-mls`), so
consumers — and the api test — pull MLS without the sodium stack/alias.
**Server:** `key_packages` + `mls_welcomes` tables (public artifacts only) + REST under `/api/chat`
(publish/count/claim KeyPackage, relay/list/ack Welcome) on the swappable `ChatRepo`. KeyPackages are
single-use (claim consumes one, `FOR UPDATE SKIP LOCKED`). The CH-2 WS gateway relays the opaque ciphertext
unchanged — MLS just produces it.
**Rationale:** bytes-only keeps all ts-mls types inside `@chatforge/crypto` (swappable for an audited
mls-rs/WASM impl per ADR-0018), makes client-side encrypted persistence trivial, and preserves the
zero-knowledge server (ADR-0001).
**Status:** Accepted. Verified by a crypto vitest (2-member group, bidirectional exchange, reload-from-bytes,
foreign-ciphertext rejection) + an api vitest (REST bootstrap + a real MLS message relayed over the gateway;
DB holds only ciphertext). `ts-mls` remains **unaudited** (ADR-0018 caveat stands).

## ADR-0021 — Admin console: env-bootstrap owner + RBAC (roles + custom roles + grants) (2026-06-03) · Accepted
**Context:** A powerful, modular, hardened admin panel + web auth/dashboard was needed; the admin module
previously ran on the in-memory dev `stores`, not the real DB.
**Decision:**
- **Authorization, three layers** (`rbac.ts`): built-in system roles (owner/admin/moderator/user),
  admin-defined **custom roles** (DB `roles`), and per-user **grants** (DB `user_grants`, allow/deny) =
  *delegation*. Effective = role perms ∪ allow − deny; **owner is omnipotent and unlockable**.
  `requirePermission` checks the computed effective-permission list attached by `resolveUser` (per request).
- **Persistence** behind a swappable **`AdminRepo`** (Drizzle + in-memory), mirroring `ChatRepo`, so the full
  authorization path is tested without a DB. The admin module was migrated off `stores` onto it.
- **better-auth owns credentials:** user creation = `signUpEmail` (server) then set role/flags; new
  `status` + `mustChangePassword` are `input:false` additionalFields. Self-service `POST /api/me/password`
  proxies better-auth then clears the flag. Create-user is a seam (`method: password|invite|ldap` — only
  `password` now; others 501) so SMTP-invite/LDAP drop in later.
- **Bootstrap** (`db/bootstrap.ts`, after `drizzle-kit migrate` in `server.ts`): upsert built-in roles each
  boot; seed the owner from `ADMIN_EMAIL`/`ADMIN_PASSWORD` **only if no owner exists** → changing it in the
  panel makes the env inert.
- **Hardening:** anti-privilege-escalation (can't assign a role / delegate a permission beyond your own;
  only owner touches owner/admin), last-owner + self-suspend protection, suspended ⇒ **zero permissions**,
  every mutation audit-logged, secrets never client-side. Edge brute-force/rate-limiting is the VPS's job
  (Traefik + CrowdSec) plus better-auth's built-in auth rate limit; admin routes are RBAC-gated + SameSite.
- **Web** (`apps/web/src/features/admin/*`): a section **registry** (Users/Roles/Flags/Audit) — adding a
  feature = one entry — each gated by a permission read from `/api/me`; plus a dashboard + change-password.
**Status:** Accepted. Verified: 9 admin vitest (RBAC, delegation end-to-end, anti-escalation, owner
protection, custom roles, flags/audit) + typecheck + web build. DB-backed bits (bootstrap, user creation,
password change) verified live (no Docker here). Migration `0002`.

## ADR-0022 — CH-4 chat UI: MLS in a Web Worker + IndexedDB; hardened gateway (2026-06-03) · Accepted
**Context:** CH-3 shipped the MLS engine, WS transport and REST; CH-4 is the chat UI + client
orchestration, plus server-side abuse hardening ("safety first on the server").
**Decision:**
- **MLS runs in a dedicated Web Worker** (`apps/web/src/worker/chat.worker.ts`) importing the
  libsodium-free `@chatforge/crypto/mls`. All key material + per-conversation group state live in the
  worker and the origin's **IndexedDB** (`lib/chatDb.ts`: `bundles`/`groups`/`messages`), never on the
  main thread or the wire in plaintext. The worker processes ops **strictly serially** so the ratchet
  never races. v1 stores group state unsealed in IndexedDB (origin-isolated; the *server* stays
  zero-knowledge); device-at-rest sealing via `vault` is a follow-up.
- **Forward-secrecy-aware history:** decrypted plaintext is cached locally per message (MLS can't
  re-decrypt old ciphertext); on load the client renders the local cache and decrypts only messages
  with `seq` beyond what it already has, **in order**.
- **Orchestration** (`lib/chatClient.ts`): drives the worker + the same-origin WebSocket (cookie-authed
  upgrade, auto-reconnect) + REST; tops the server KeyPackage pool up to 5; **processes pending Welcomes
  (joins) before decrypting**; optimistic send confirmed by `delivered`; presence/typing/read receipts.
  React via a subscribable snapshot (`useChat`). Components: ConversationList / NewChat / Thread / Composer.
- **Navbar Admin shortcut** shown from server-computed permissions (`/api/me`) — covers owner/admin/
  moderator + any delegated user. The panel + every endpoint enforce server-side regardless of UI.
- **Server hardening (vs a hostile client):** WS `maxPayload` 256 KB + per-socket token-bucket rate limit
  + per-user connection cap; zod frame caps (ciphertext ≤ 256 KB, bounded ids); REST caps on KeyPackage
  size/count + Welcome size; admin pagination clamping; **self-modification of own role/grants blocked**
  (no self-escalation/lockout) — on top of existing anti-escalation, owner-protection, RBAC-on-every-route,
  suspended⇒no-perms, and Drizzle parameterized queries.
**Status:** Accepted. Verified: `turbo run test typecheck` (crypto 7, core 25, api 21, all typechecks) +
web build (the chat worker bundles ts-mls + @hpke/core). The **live two-browser E2E flow needs on-machine
testing** — the client (worker/WS/IndexedDB/MLS ordering) can't be runtime-tested in the sandbox; expect
minor iteration. ts-mls remains unaudited (ADR-0018).

---

# Conventions
- **TypeScript strict** everywhere (`noUncheckedIndexedAccess`, `noUnusedLocals`, etc.) — see
  `tsconfig.base.json`. Parsers must be defensive: never assume a regex group/array index exists.
- **zod** is the single source of truth for shapes shared across packages (canonical model,
  DTOs). Derive TS types via `z.infer`.
- **Deterministic IDs** — hash-based, never `Math.random()` (the old tool's bug).
- **Timezone-correct** timestamps; store as epoch ms + optional original tz offset.
- **Tests** — every importer/exporter has Vitest round-trip tests against real fixtures.
- **Lossless first** — when a target format can't represent something, record it in the
  fidelity report; never drop silently.

# Validated source formats (app versions)
Export formats drift across app versions — these are the versions the v1 parsers were verified
against (2026-06-01):
- **WhatsApp** — macOS **26.19.76 (974675497)** / iOS **2.26.20.73**. Both emit the **iOS-style**
  `.txt` export: `[DD/MM/YYYY, HH:MM:SS] Sender:` + `‎<attached: …>` + U+200E marks +
  `*bold*`/`_italic_`/`~strike~`/```` ```mono``` ```` markup. The Android dash dialect
  (`DD/MM/YYYY, HH:MM - Sender:`) is handled in code but **not yet checked against a real Android export**.
- **Telegram** — exports are produced by **Telegram Desktop 6.8.2** (macOS); the iOS app
  (**12.7 / 32933**) can't produce full chat exports. Use **Machine-readable JSON** (`result.json`),
  not HTML. Verified roots: `personal_chat`, `private_supergroup`, `public_channel`.

# Status (v1 progress)
- [x] M0 monorepo scaffold + this log
- [x] M1 core engine — WhatsApp/Telegram importers, 5 exporters, registry, fidelity report (8/8 tests, strict-clean)
- [x] M2 web converter UI — client-only SPA, builds clean (worker bundles the engine)
- [x] M3 crypto — Argon2id + XChaCha20 seal/open + BIP39 recovery (4/4 tests); MLS stubbed (realized in CH-3)
- [x] M4 api — Hono + RBAC admin + opt-in server-side conversion sandbox + OpenAPI (smoke-tested); better-auth + Drizzle wiring next
- [x] M7 infra — Dockerfiles (web→nginx-unprivileged, api→node:22), nginx CSP, docker-compose (pg/minio/mailpit), Dokploy notes
- [x] Validated against **real exports** — WhatsApp DM+group, Telegram supergroup/channel/DM (JSON). Message count, text & attachments preserved 1:1 across conversions (incl. a 690-msg supergroup); formatting degrades only per-format and is reported. Telegram **HTML** export (no `result.json`) is not supported — export as JSON. 19 core tests.
- [x] **Details editor + live preview** — import → edit (rename chatters, title/type, date-range filter, drop/redact messages) → export, with a live chat-bubble preview (hover a message to remove/restore). Worker split into import/export actions; pure `applyEdits` transform in core. 25 core tests; web builds clean (+~9 KB bundle).
- [x] **CH-1 chat foundation** — better-auth (email+password + **passkeys**) on Drizzle/Postgres, cookie sessions + RBAC role; web login/passkey UI + TanStack Router. Typecheck/build clean, 6 API tests; live DB/passkey verified on-machine (no Docker in CI sandbox).
- [x] **CH-2 realtime transport** — `ws` gateway (session-authed upgrade) + chat schema (conversations/members/messages/presence) behind a swappable `ChatRepo`; message relay + delivered + typing + read receipts + presence. Server stores **opaque ciphertext** only. **9 API tests** incl. an in-process 2-client WS integration test (no Docker). Shared wire protocol in `@chatforge/types`.
- [x] **CH-3 MLS end-to-end** — real `MlsProvider` over **ts-mls 1.6.2** (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`) behind a bytes-only, stateless seam (ADR-0020): `generateKeyPackage`/`createGroup`/`startDm`/`addMember`/`joinGroup`/`encrypt`/`decrypt`, group state persisted via `encode/decodeGroupState`. Server adds `key_packages` + `mls_welcomes` (public-only) + REST under `/api/chat` (publish/claim KeyPackage, relay/ack Welcome) on the swappable `ChatRepo`; committed migration `0001_flawless_madrox.sql`. **Verified here (no Docker):** crypto vitest (2-member group, both-way exchange, reload-from-bytes, foreign-ciphertext reject) + api vitest (REST bootstrap + a real MLS message over the CH-2 gateway; DB stores only ciphertext). **crypto 7 + api 11 tests** green; web builds clean.
- [x] **Admin console + RBAC delegation (ADR-0021)** — env-bootstrap owner (`ADMIN_EMAIL`/`ADMIN_PASSWORD`, first-run only); built-in roles + **custom roles** + per-user **grants** (allow/deny delegation) behind a swappable `AdminRepo` (Drizzle + in-memory); hardened (anti-escalation, last-owner/self-suspend protection, suspended⇒no perms, full audit). Admin module migrated off `stores` to the real DB. Modular web console (`features/admin/*` registry: Users/Roles/Flags/Audit) + dashboard + change-password; `/api/me` drives permission-gated UI; `mustChangePassword` flow + `method:password|invite|ldap` seam. Migration `0002`. **9 admin tests** (incl. delegation end-to-end) + typecheck + web build green; DB-backed bootstrap/creation/password verified live.
- [x] **CH-4 chat UI (ADR-0022)** — MLS in a Web Worker + IndexedDB persistence (`worker/chat.worker.ts`, `lib/chat{Db,Client,WorkerClient,Protocol}.ts`); same-origin cookie-authed WS client w/ reconnect; `features/chat/` ConversationList / NewChat (by email) / Thread / Composer; presence + typing + read receipts; optimistic send; navbar **Admin** shortcut from `/api/me`. Server hardened: WS `maxPayload` + per-socket rate limit + per-user conn cap, zod frame caps, REST KeyPackage/Welcome size caps, admin pagination clamp + **self role/grant guards**. `turbo test typecheck` + web build green; **live 2-browser E2E pending on-machine** (untestable in sandbox).
- [x] **Account: profile + unique username + passkey inventory** — `/api/me` is now an `accountModule` (GET me, change password, **POST /profile** = unique `username` handle + display `name`, **GET/DELETE /passkeys** = inventory + revoke). Chats startable by **email OR @username** (`resolvePeerId`). Web **Settings** page (`features/settings`) + nav link. `username` is an `input:false` better-auth field set only via the validated profile endpoint; migration `0003`.
- [x] **Chat stability + lean deploy** — gateway hardened against crashes (try/catch on connect/close + `ws error` + process-level `unhandledRejection`/`uncaughtException`) and a 30s ping/pong **heartbeat** (fixes the 502/"connection lost" drops); `newChat` repairs half-set-up DMs + clear error when a peer has no published keys. Prod compose trimmed to **postgres + api + web** (MinIO/Mailpit gated behind the `dev` profile) to fit the 2 GB VPS.
- [x] **Vault Conversations** — save an imported/edited chat to an E2E vault (`vault_conversations`, server stores only ciphertext; migration `0004`) and view/link it to a live DM. Client encrypts with a **device key** (WebCrypto AES-256-GCM, non-extractable, in IndexedDB — "device key now, passphrase later"; `salt` column reserved for the future passphrase/cross-device mode). "Save to Vault" in the converter; **Vault** section + read-only decrypt view + link-to-DM in chat. `/api/vault` REST (save/list/get/link/delete, ownership-scoped + size-capped).
- [ ] Next: **CH-5** encrypted attachments (`blob.ts`→MinIO; reference `{objectKey, wrappedKey}` inside the MLS message). Also pending: passphrase/cross-device vault unlock, rich statuses (Spotify/Discord-style presence), device-at-rest sealing of chat group state, "linked vault" banner in the live thread, api-client codegen, Meta/Discord importers.
