# Operations runbook

Production is a single IONOS VPS (2 GB RAM, Debian 13) running Dokploy + Traefik, alongside several
other apps. ChatForge is a Dokploy **Compose** app.

```bash
ssh -p 2222 cosmin@<vps>          # key-only; never attempt root (fail2ban will ban you)
sudo docker ps --format '{{.Names}}'
```

Container names look like `tools-chatforge-<hash>-{api,web,postgres,minio}-1`.

## First thing, every time

```bash
sudo docker ps -a --filter name=chatforge          # is anything restart-looping?
sudo docker logs <api-container> 2>&1 | tail -40   # what does the API say?
free -h                                            # memory pressure?
```

The API logs its own boot sequence: migrations applied → `chatforge-api listening` → any storage
warning. Most problems are visible in those three lines.

## Memory

2 GB is tight and the box is shared with Logto, AdGuard, Umami, Beszel, Traefik and several sites.
Swap (4 GB) is provisioned by the Ansible `common` role and is expected to be partly used — that is
normal, not an alarm. What matters is `available` in `free -h` and whether anything is being
OOM-killed:

```bash
sudo dmesg -T | grep -i "killed process" | tail
```

Approximate steady-state footprint: Dokploy ~130 MB, AdGuard ~110 MB, MinIO ~70 MB, Logto ~40 MB,
Traefik ~30 MB, ChatForge api ~25 MB, Postgres ~15 MB.

If Postgres becomes unreachable, **every** auth endpoint returns 500 while the app itself looks
healthy — the WebSocket still upgrades and `/api/me` returns 401 rather than 502. That specific
combination means "database", not "API down".

## Deploying

Push to `main` → Dokploy redeploys (or click Deploy). On boot the API runs `drizzle-kit migrate`
against the committed SQL in `apps/api/drizzle/`, then seeds the built-in roles, then serves.

A deploy can report success while Swarm has actually rolled the service back. Confirm with the
container's own logs and uptime rather than trusting the deploy status:

```bash
sudo docker ps --filter name=chatforge --format '{{.Names}}\t{{.Status}}'
```

## Backups

Restic → Backblaze B2, driven by the `backup` role in the infrastructure repo. The database is
captured as a nightly logical dump, not as a hot data directory:

```bash
sudo /opt/scripts/dump-chatforge-db.sh      # pg_dumpall → /opt/backups/db-dumps/
sudo ls -lht /opt/backups/db-dumps/         # last 3 kept locally; Restic holds the history
```

That dump is what saved the database on 2026-08-27 — keep it working. The script fails loudly if the
dump comes back empty, which is deliberate: a silent no-op would leave the snapshot with no usable
copy.

**Restic must also cover the MinIO volume** (`chatforge-minio`) — attachments exist nowhere else and
are not in any logical dump.

### Restoring the database

```bash
DUMP=/opt/backups/db-dumps/chatforge_<stamp>.sql.gz
sudo docker stop <api-container>                                  # keep migrations from racing
sudo sh -c "zcat $DUMP | docker exec -i <pg-container> psql -U chatforge -d postgres"
sudo docker start <api-container>                                 # applies any newer migrations
```

Restoring an older dump is safe with respect to schema drift: Drizzle's migration table is inside the
dump, so the API applies whatever migrations came after it on the next start.

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| All `/api/auth/*` return 500; `/api/me` returns 401; `/ws` still upgrades | Postgres unreachable | Restart Postgres; check memory and disk |
| Sign-in redirects then errors | Logto redirect URI mismatch, or empty `LOGTO_APP_ID`/`SECRET` | [configuration.md](configuration.md#identity-logto) |
| Uploads fail; log says `SignatureDoesNotMatch` | `S3_SECRET_KEY` ≠ `MINIO_ROOT_PASSWORD` | Clear the `S3_*` keys; the API falls back to MinIO's |
| Uploads 503 | No storage credentials reached the container | [configuration.md](configuration.md#object-storage-attachments--avatars) |
| Every site on the box returns 000/connection refused while Traefik shows "Up" | ufw-docker gwbridge IP drift (host-wide, not ChatForge) | Self-heals via the 5-minute timer; see the infrastructure repo |
| "X hasn't opened Chat yet (no encryption keys published)" | The peer has never loaded `/chat`, so has no MLS KeyPackages | Ask them to open Chat once |
| A message won't decrypt | A gap in the ratchet — MLS cannot decrypt out of order, and cannot re-decrypt old ciphertext on a new device | Expected behaviour of forward secrecy, not a bug |

## Things that are expected, not bugs

- **Swap in use.** Fine on a 2 GB box.
- **History missing on a new device.** MLS is forward-secret; plaintext is cached per device. A new
  browser sees messages from the moment it joins.
- **Metadata is visible to the server.** Who talks to whom, and when. ChatForge protects content, not
  the social graph — see [architecture.md](architecture.md#what-the-server-can-and-cannot-see).
