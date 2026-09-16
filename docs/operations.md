# Operations runbook

Production is a single IONOS VPS (2 GB RAM, Debian 13) running Dokploy + Traefik, alongside several
other apps. ChatForge is a Dokploy **Compose** app.

```bash
ssh -p 2222 cosmin@<vps>          # key-only; never attempt root (fail2ban will ban you)
sudo docker ps --format '{{.Names}}'
```

Container names after recovery look like `tools-chatforge-<hash>-{api,web,postgres,garage}-1`.
The production cutover is still gated by [production-recovery.md](production-recovery.md).

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

Measure current container and kernel usage instead of relying on historical RSS estimates.
The replacement limits PostgreSQL/Garage/API/web to 128/128/192/32 MiB respectively. Limits are
ceilings, not reservations; leave host headroom and watch for OOMs during migrations and uploads.

If Postgres becomes unreachable, **every** auth endpoint returns 500 while the app itself looks
healthy — the WebSocket still upgrades and `/api/me` returns 401 rather than 502. That specific
combination means "database", not "API down".

## Deploying

Push to `main` → CI builds and tests images. Production deployment is explicit: select the four
approved digests and use `docker-compose.production.yml`, as described in the recovery runbook.
Auto-deploy remains paused. On boot the API runs `drizzle-kit migrate` against committed SQL,
then starts and bootstraps built-in roles; check the database rather than relying on HTTP alone.

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

**Restic must also cover both Garage volumes**, with a fresh consistent metadata snapshot before
copying. Keep the original `chatforge-minio` volume backed up while it is retained. Attachments are
not in the logical database dump. A restore drill is required before declaring recovery complete.

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
| Uploads fail; log says `SignatureDoesNotMatch` | S3 pair does not match Garage's persistent key | Check the bucket-scoped key; never substitute root credentials |
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
