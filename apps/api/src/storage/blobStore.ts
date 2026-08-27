/**
 * Object-storage boundary for blobs (chat attachments + avatars).
 *
 * Two implementations, swappable via `setBlobStore` exactly like `ChatRepo`/`AdminRepo`:
 *  - `S3BlobStore`  — any S3-compatible endpoint (MinIO on the VPS, Backblaze B2 later)
 *  - `MemoryBlobStore` — tests/dev, so the whole upload/download path is verifiable without MinIO
 *
 * Attachment bodies that arrive here are **already client-side encrypted** (AES-256-GCM, key never
 * leaves the browser — it rides inside the MLS payload). The store therefore handles opaque bytes;
 * it is not a second encryption layer and must never be treated as one. Avatars are the deliberate
 * exception: like `name`/`username`/`bio` they are plaintext profile data (see ADR-0024).
 */
export interface PutOptions {
  contentType: string;
  contentLength: number;
}

export interface BlobBody {
  /** Web stream so a Hono `Response` can pipe it straight to the client without buffering. */
  stream: ReadableStream<Uint8Array>;
  contentLength: number;
  contentType: string;
}

export interface BlobStore {
  put(key: string, body: Uint8Array, opts: PutOptions): Promise<void>;
  get(key: string): Promise<BlobBody | null>;
  delete(key: string): Promise<void>;
}

/** In-memory store — used by the API tests and by `npm run dev` without a MinIO container. */
export class MemoryBlobStore implements BlobStore {
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  put(key: string, body: Uint8Array, opts: PutOptions): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(body), contentType: opts.contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<BlobBody | null> {
    const o = this.objects.get(key);
    if (!o) return Promise.resolve(null);
    const bytes = o.bytes;
    return Promise.resolve({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      contentLength: bytes.byteLength,
      contentType: o.contentType,
    });
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/**
 * S3-compatible store. The AWS SDK is **lazy-imported on first use** so an instance that never
 * serves a blob request never pays its startup/memory cost (the VPS is small).
 */
export class S3BlobStore implements BlobStore {
  private clientPromise: Promise<S3Like> | null = null;

  constructor(
    private readonly cfg: { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string },
  ) {}

  private client(): Promise<S3Like> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import('@aws-sdk/client-s3');
        return new S3Client({
          endpoint: this.cfg.endpoint,
          region: this.cfg.region,
          forcePathStyle: true, // MinIO serves path-style (http://host:9000/bucket/key)
          credentials: { accessKeyId: this.cfg.accessKey, secretAccessKey: this.cfg.secretKey },
        }) as unknown as S3Like;
      })();
    }
    return this.clientPromise;
  }

  /** Create the bucket if it doesn't exist yet. Called once on boot; failures are non-fatal. */
  async ensureBucket(): Promise<void> {
    const [client, { CreateBucketCommand, HeadBucketCommand }] = await Promise.all([this.client(), import('@aws-sdk/client-s3')]);
    try {
      await client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
    }
  }

  async put(key: string, body: Uint8Array, opts: PutOptions): Promise<void> {
    const [client, { PutObjectCommand }] = await Promise.all([this.client(), import('@aws-sdk/client-s3')]);
    const command = (): unknown =>
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      });
    try {
      await client.send(command());
    } catch (err) {
      // The boot-time bucket check runs before MinIO is necessarily up, so self-heal here rather
      // than leaving uploads broken until the next API restart.
      if (!isNoSuchBucket(err)) throw err;
      await this.ensureBucket();
      await client.send(command());
    }
  }

  async get(key: string): Promise<BlobBody | null> {
    const [client, { GetObjectCommand }] = await Promise.all([this.client(), import('@aws-sdk/client-s3')]);
    try {
      const out = await client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      if (!out.Body) return null;
      return {
        stream: out.Body.transformToWebStream(),
        contentLength: out.ContentLength ?? 0,
        contentType: out.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const [client, { DeleteObjectCommand }] = await Promise.all([this.client(), import('@aws-sdk/client-s3')]);
    await client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

/** Structural view of the bits of `S3Client` we use — keeps the SDK types out of the seam. */
interface S3Like {
  send(command: unknown): Promise<{
    Body?: { transformToWebStream(): ReadableStream<Uint8Array> };
    ContentLength?: number;
    ContentType?: string;
  }>;
}

function isNoSuchBucket(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchBucket';
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

let store: BlobStore | null = null;

/** Swap the store (tests inject `MemoryBlobStore`). */
export function setBlobStore(next: BlobStore | null): void {
  store = next;
}

/**
 * The active store, or `null` when object storage isn't configured — callers answer 503 rather than
 * silently accepting uploads they can't persist.
 */
export function getBlobStore(): BlobStore | null {
  if (store) return store;
  return null;
}

/** Build the real store from env (called on boot when S3 credentials are present). */
export async function initBlobStore(cfg: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}): Promise<void> {
  const s3 = new S3BlobStore(cfg);
  store = s3;
  try {
    await s3.ensureBucket();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[blobs] bucket check failed (uploads may fail):', err instanceof Error ? err.message : err);
  }
}
