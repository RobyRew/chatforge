import { getBlobRepo, type BlobRecord } from './blobRepo';
import { getBlobStore } from './blobStore';

/**
 * Blob garbage collection.
 *
 * The server cannot read a message, so it cannot discover which blob that message referenced — the
 * link is recorded explicitly at send time (`blobIds` on the send frame). Without it, deleting a
 * message would leave its attachment on disk forever, which would make "delete" a lie about the
 * part that actually costs storage.
 *
 * Two reclaim paths:
 *  - **on delete** — the attachments of a deleted message go with it, immediately;
 *  - **the sweeper** — attachments uploaded but never attached to a message (the browser closed
 *    mid-send, the send failed) after a grace period long enough that an in-flight upload is safe.
 */
const ORPHAN_GRACE_MS = 6 * 60 * 60 * 1000; // 6h — far longer than any legitimate send takes
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SWEEP_BATCH = 200;

async function remove(records: BlobRecord[]): Promise<number> {
  if (!records.length) return 0;
  const store = getBlobStore();
  const repo = getBlobRepo();
  let removed = 0;
  for (const r of records) {
    // Drop the object first: a failure there leaves a row we will retry, whereas dropping the row
    // first would orphan the object with nothing left pointing at it.
    try {
      await store?.delete(r.objectKey);
    } catch {
      continue;
    }
    await repo.delete(r.id).catch(() => undefined);
    removed++;
  }
  return removed;
}

/** Delete the attachments of a message that was just deleted. Best-effort. */
export async function deleteBlobsForMessage(conversationId: string, seq: number): Promise<number> {
  try {
    return await remove(await getBlobRepo().listForMessage(conversationId, seq));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blobs] failed to reclaim attachments for a deleted message:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** One sweep of abandoned uploads. Exported for tests. */
export async function sweepOrphans(): Promise<number> {
  try {
    const orphans = await getBlobRepo().listOrphans(ORPHAN_GRACE_MS, SWEEP_BATCH);
    const removed = await remove(orphans);
    if (removed) {
      // eslint-disable-next-line no-console
      console.log(`[blobs] swept ${removed} abandoned upload(s)`);
    }
    return removed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blobs] orphan sweep failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startBlobSweeper(): void {
  if (timer) return;
  timer = setInterval(() => void sweepOrphans(), SWEEP_INTERVAL_MS);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

export function stopBlobSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
