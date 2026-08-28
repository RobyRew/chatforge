# Storage — attachments, avatars, MinIO

## The design in one paragraph

Chat attachments are **end-to-end encrypted**; avatars deliberately are not. When you attach a file,
the browser generates a fresh AES-256-GCM key, encrypts the file, and uploads **only the ciphertext**.
The key, the filename and the MIME type travel inside the MLS payload — which is itself encrypted to
the conversation. So the server stores bytes it cannot name, cannot type, and cannot open, and a blob
id is useless to anyone outside the conversation. Avatars are the explicit exception: they are profile
data like a display name, which the server already stores in the clear, so encrypting them would make
them unrenderable to peers for no real gain. This asymmetry is a decision, not an oversight — ADR-0024.

## Upload and download path

Bytes are **proxied through the API**, not fetched with presigned URLs. Presigning would mean putting
MinIO on its own public hostname with CORS; proxying keeps one origin, one authentication path (the
`cf_sid` cookie), no MinIO exposure, and central quota enforcement.

```
 browser                              api                          minio
 ───────                              ───                          ─────
 encrypt(file, fresh AES key)
   └─ ciphertext ──POST /api/blobs/attachments/:conversationId──▶ membership check
                                                                  quota + rate limit
                                                                  put(object) ────────▶ stored
   ◀── { id } ───────────────────────────────────────────────────
 send MLS payload { blobId, key, iv, name, mime, size }  ──────▶ relayed as ciphertext

 peer: GET /api/blobs/:id ──▶ membership check ──▶ stream ──▶ decrypt with key from payload
```

## Limits

| Thing | Limit | Enforced where |
|---|---|---|
| Attachment size | 25 MB | API (`Content-Length` checked *before* buffering), nginx `client_max_body_size 32m` |
| Avatar size | 2 MB | API |
| Avatar formats | PNG, JPEG, GIF, WebP | API, by **magic bytes** — the declared `Content-Type` is ignored |
| Per-user total | `BLOB_QUOTA_BYTES`, default 512 MB | API, `SUM(size)` before accepting |
| Upload rate | burst 20, then 1 per 3s | API, per-user token bucket |

**SVG is rejected** for avatars. It is a document format that can carry script, and these are served
from the app's own origin.

## Security properties worth knowing

- **Membership, not ownership**, gates attachment reads — both sides of a DM must be able to fetch a
  file, not just the sender.
- A non-member gets **404, never 403**. A 403 would confirm the id exists; 404 reveals nothing.
- Object keys are freshly generated UUIDs. No user-controlled string ever becomes part of a path.
- Blobs are served `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`. Avatars are `inline` with their sniffed type.
- On the client, a **peer-supplied MIME type is never applied to a `blob:` URL verbatim** — an
  allowlist maps anything unrecognised to `application/octet-stream`, so a hostile peer cannot get a
  same-origin scriptable blob URL rendered.
- Replacing your avatar deletes the previous blob, so they don't accumulate against your quota.

## Operations

### Where the bytes live

**MinIO uses a named Docker volume, `chatforge-minio`** (`/var/lib/docker/volumes/...`).

```bash
sudo docker volume inspect chatforge-minio
sudo du -sh /var/lib/docker/volumes/tools-chatforge-*_chatforge-minio/_data
```

It did not start that way, and the reason it changed is worth knowing.

> **This already bit us once (2026-08-27).** MinIO originally used a *relative bind mount*,
> `./.data/minio`, which resolves to a path **inside the directory Dokploy checks the repository out
> into**. A deploy refreshed that checkout and deleted the directory out from under the running
> container. MinIO kept running against a deleted inode: the bucket still answered `HeadBucket`, but
> every write failed with `SlowDownRead — Resource requested is unreadable`. Nothing in the API log
> said "your storage is gone", because from the API's point of view the bucket existed.
>
> A named volume lives outside the checkout, so no git operation can touch it. That is the fix.

> **Postgres hit the same bug, for real, the same day.** It was on `./.data/postgres`. A deploy
> refreshed the checkout and deleted the live PGDATA out from under the running server. Postgres kept
> answering queries from its open file handles and shared buffers — its healthcheck stayed green — and
> only failed once it needed a file that wasn't cached (`could not open file "global/pg_filenode.map"`).
> It is now on the named volume `chatforge-postgres`, restored from the nightly `pg_dumpall`.
>
> The lesson generalises: **never put a database or object store on a path inside a directory your
> deploy tool manages.** And note how quiet both failures were — a green healthcheck and a successful
> `HeadBucket` while the underlying storage no longer existed.

Restic must cover the database **and** the MinIO volume — attachments exist nowhere else.

### Checking it's healthy

```bash
sudo docker logs <api-container> 2>&1 | grep -i blob
```

- Silence — good, nothing to report.
- `S3_ACCESS_KEY/S3_SECRET_KEY not set — attachments and avatar uploads are disabled` — running
  without storage on purpose; uploads return 503.
- `bucket check failed: The request signature we calculated does not match` — **credential
  mismatch.** `S3_SECRET_KEY` disagrees with `MINIO_ROOT_PASSWORD`. Clear `S3_ACCESS_KEY`/
  `S3_SECRET_KEY` and let the API fall back to the MinIO credentials. See
  [configuration.md](configuration.md#object-storage-attachments--avatars).

### Symptoms → cause

| Symptom | Cause |
|---|---|
| Upload returns **503** | No storage credentials reached the API |
| Upload returns **413** at ~1 MB | An upstream proxy is capping the body. The bundled nginx allows 32 MB; check Traefik if you added your own middleware |
| Upload returns **413** with "quota exceeded" | The user hit `BLOB_QUOTA_BYTES` |
| Upload returns **415** | The avatar isn't a PNG/JPEG/GIF/WebP by magic bytes |
| Upload returns **429** | Upload rate limit; it refills on its own |
| Image shows "⚠ attachment is no longer available" | The blob was deleted, or the sender's quota cleanup removed it |
| Everything 401s | A session problem, not storage — see [auth-logto.md](auth-logto.md) |

### Garbage collection

The server cannot read a message, so it cannot work out which blob that message referenced. The link
is therefore recorded explicitly: the send frame carries `blobIds`, and the server stores
`blobs.message_seq`. That leaks nothing new — the server already stored those blobs — and without it
"delete" would be a lie about the part that actually costs storage.

| Path | When |
|---|---|
| Attachments of a deleted message | Immediately, when the message is deleted for everyone |
| Abandoned uploads (never attached to a message) | Hourly sweeper, after a **6 hour** grace period |
| A replaced avatar | Immediately, on profile save |

Objects are deleted before their database rows: a failure the other way round would orphan bytes with
nothing left pointing at them. Only the sender's **own, unattached, same-conversation** blobs can be
linked, so a hostile client cannot attach — and later cause the deletion of — someone else's file.
