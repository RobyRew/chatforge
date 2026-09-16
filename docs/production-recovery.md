# Image-only recovery and release procedure

## Deployment gate

ChatForge's automatic deployment is paused. The old PostgreSQL and MinIO volumes are retained.
Do not deploy the development compose file or restart the archived MinIO image.
This document describes the replacement; it is not a claim that production recovery is complete.

`Build and test production images` installs the lockfile with Node 22 / npm 11.19.1, rejects npm
advisories at moderate or above, runs uncached tests/typechecks/build, builds off-host, and rejects
HIGH/CRITICAL runtime findings (including unfixed ones) and detected secrets. Runtime tests use
disposable data: PostgreSQL initialization/migrations/restart, real AWS SDK S3 operations,
authentication and bucket-administration denials, storage restart, and web security headers.
Images are published only after these checks. The successful run's summary records four immutable
`ghcr.io/robyrew/chatforge-<component>@sha256:...` references. Never select a failed run or a mutable
tag for production. Image vulnerability scans are not a complete security audit.

Production uses `docker-compose.production.yml`: no build directives, no published host ports,
non-root/read-only containers, dropped capabilities, resource limits and an internal storage
network. Only web joins `dokploy-network`. Keep Dokploy's domain pointed to web port 8080; nginx
proxies the authenticated API and WebSocket on the same origin.

## First recovery

1. Keep auto-deploy paused. Obtain a fresh cold backup of the existing stopped PostgreSQL volume
   and verify its archive before changing credentials or starting migrations. Preserve the original
   MinIO volume even if inventory says it contains no objects. Never run `down --volumes` on this app.
2. Rotate ChatForge's Logto application secret in Logto and update `LOGTO_APP_SECRET` in Dokploy;
   revoke the old secret. On 2026-09-16, an isolated cold database copy had zero integration rows,
   zero blob rows, one user and three sessions. Recheck if the app has run since that inspection.
   Integration tokens, when present, are encrypted using a key derived from this secret: rotation
   needs an explicit reconnect/re-encryption plan. Do not change the shared Logto server's secrets.
3. Rotate the PostgreSQL role password **inside PostgreSQL**, then update `POSTGRES_PASSWORD` and
   the URL-encoded password in `DATABASE_URL` together. Changing only the environment does not
   change a password in an existing data directory. Keep the API stopped during this operation.
   Verify password authentication over TCP with the new value; do not print URLs or secrets.
4. Generate independent cryptographically random `S3_ACCESS_KEY`, `S3_SECRET_KEY` and
   `GARAGE_RPC_SECRET` in a protected session. RPC secret: 32 random bytes represented as hex.
   Set `S3_BUCKET=chatforge`. Remove obsolete `MINIO_ROOT_*` values from active configuration.
   The Garage entrypoint imports the dedicated key and grants only bucket read/write, never
   create-bucket or owner permissions. An existing key's secret is not silently overwritten:
   rotate with a new key ID, test it, then explicitly revoke the old key.
5. Save all four `CHATFORGE_*_IMAGE` values from one successful CI run. Verify the registry pull
   works from the VPS. New GHCR packages may be private: arrange scoped read access or obtain
   explicit approval for public visibility; never make a source repository public as a workaround.
6. Set `CHATFORGE_POSTGRES_VOLUME=tools-chatforge-zmz4mf_chatforge-postgres`, and verify that exact
   volume exists and contains PostgreSQL 17 data. It is external so a typo fails instead of silently
   initializing a replacement database. Confirm its UID/GID matches the image's postgres user.
7. Change Dokploy's compose path to `./docker-compose.production.yml`, retain the existing project
   identity and HTTPS domain. Pipe `docker compose -f docker-compose.production.yml config --format json`
   directly to `python3 infra/check-production.py` in the protected server session; never print or
   save the rendered environment in logs. The checker emits only pass/fail.
   Check available memory, disk, the family DNS probe, and kernel unreclaimable memory first.
   No app builds on this 2 GB VPS; production limits total 480 MiB, not a reservation or capacity
   guarantee. Watch actual usage during startup and migrations before admitting user traffic.
8. Deploy, then inspect readiness, OOM/restart counts, image digests, volume mounts and limits.
   Verify HTTPS, security headers on HTML and JS, dotfile denial, anonymous `/api/me` rejection,
   Logto sign-in and a two-browser chat/attachment round trip. Never use real user data for a test.
9. Run the logical database dump and the snapshot-aware Restic backup. Restore to isolated,
   non-public test volumes and verify database rows plus synthetic object bytes before declaring
   recovery complete. Leave the preserved original storage in place until separately approved.

## Storage choice and limitations

The selected upstream is Garage 2.4.1, pinned by OCI digest in `infra/garage.Dockerfile`. Its official
binary is unchanged. A patched Alpine wrapper provisions least-privilege credentials without
logging CLI output. Both metadata and object blocks use separate named volumes outside checkouts.
RPC listens only inside the container; no admin HTTP or public S3 listener is published.

Source audit on 2026-09-16: official tag `v2.4.1`, commit
`268334bd2530fa99f8b06c7383b2e9f776691edd`. The complete Cargo.lock reports
GHSA-82j2-j2ch-gfr8 in rustls-webpki 0.101.7. An exact Linux release-feature dependency-tree check
places that version only in development/test dependencies; the normal release graph uses patched
0.103.13. No scanner ignore was added. Recheck this distinction on upgrades: a scratch/static image
scan alone does not inventory all Rust dependencies.

This is **single-host storage, not high availability**. Garage's replication-factor documentation
recommends redundant nodes for production; one VPS cannot meet that fault-tolerance standard.
The user chose this VPS, so independent encrypted off-host backups and restore exercises are
essential, and host failure still causes downtime and potential loss since the last backup.
`data_fsync` and `metadata_fsync` are enabled; SQLite uses WAL/NORMAL, not FULL, so this is not a
zero-RPO promise. See [upstream configuration](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/).

## Backup and restore

Back up PostgreSQL through the logical dump. A hot PGDATA copy is not a usable database backup;
the old stopped volume is also retained for recovery/forensics.

Before Restic reads Garage volumes, run `/garage meta snapshot` inside its healthy container.
The infrastructure backup role implements this hook. If Garage volumes exist but the server is
not healthy or the snapshot fails, the backup must fail visibly instead of claiming a fresh
application-consistent backup. Include both `chatforge-garage-data` and
`chatforge-garage-metadata`, node identity/layout, configuration and protected runtime secrets.
Automatic hourly metadata snapshots are additional protection, not independent off-host backups.

Restore to **new isolated volumes**, never over the only original. Stop all writers; restore the
same snapshot's block data and identity/layout, and use its consistent SQLite metadata snapshot
instead of a hot database/WAL copy. Start the matching image digest with no public routing, check
bucket/key permissions and full object byte hashes, and compare restored database blob references.
Do not advance to production until this restore drill succeeds. Live block copying relies on
Garage's delayed garbage collection; keep the backup shorter than that retention window and do
not force GC/repair during backup. A cold, coordinated backup is required for exact point-in-time
cross-database/object-store consistency.

## Subsequent releases and rollback

Push source changes, wait for all CI gates, review the four resulting digests, preserve the current
digest set and take a pre-migration backup. Update all four image variables together in Dokploy,
then explicitly deploy and repeat the smoke checks. This manual promotion is intentional; pushes
do not restart production. No production secret enters GitHub builds.

For a runtime-only regression, revert the four image references only after checking schema/data
compatibility. A migration rollback requires a coordinated database/storage restore, not just an
older image. Never fall back to the known-vulnerable archived MinIO image. Keep DNS and unrelated
services untouched throughout recovery.
