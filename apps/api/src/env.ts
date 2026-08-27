export interface Env {
  port: number;
  corsOrigin: string;
  databaseUrl?: string;
  /** Logto auth endpoint (issuer base), e.g. https://auth.robyrew.com */
  logtoEndpoint: string;
  /** Logto Application (Traditional Web) id — the confidential client for this app. */
  logtoAppId: string;
  /** Logto Application secret. Server-side only; never sent to the browser. */
  logtoAppSecret: string;
  /** Public origin used to build OIDC redirect URIs (behind Traefik, TLS is terminated upstream). */
  appBaseUrl: string;
  /** First-run owner: the user who first signs in with this email is granted the 'owner' role (once). */
  adminEmail?: string;
  /** S3-compatible object storage for blobs (MinIO on the VPS / Backblaze B2). */
  s3: S3Env;
  /** Per-user storage quota in bytes (attachments + avatars). */
  blobQuotaBytes: number;
}

export interface S3Env {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** True only when credentials are present — otherwise the blob routes answer 503. */
  configured: boolean;
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8787);
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:4321';
  // The bundled MinIO's root credentials are the fallback, so the stack needs ONE credential pair
  // rather than two that must be kept in sync by hand (getting that wrong fails every upload with
  // an opaque SignatureDoesNotMatch). Explicit S3_* always wins — that's the external-S3 path.
  const accessKey = process.env.S3_ACCESS_KEY || process.env.MINIO_ROOT_USER || '';
  const secretKey = process.env.S3_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
  const env: Env = {
    port,
    corsOrigin,
    logtoEndpoint: (process.env.LOGTO_ENDPOINT ?? 'https://auth.robyrew.com').replace(/\/+$/, ''),
    logtoAppId: process.env.LOGTO_APP_ID ?? '',
    logtoAppSecret: process.env.LOGTO_APP_SECRET ?? '',
    appBaseUrl: (process.env.APP_BASE_URL ?? corsOrigin).replace(/\/+$/, ''),
    s3: {
      endpoint: (process.env.S3_ENDPOINT ?? 'http://minio:9000').replace(/\/+$/, ''),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'chatforge',
      accessKey,
      secretKey,
      configured: !!(accessKey && secretKey),
    },
    blobQuotaBytes: positiveInt(process.env.BLOB_QUOTA_BYTES, 512 * 1024 * 1024),
  };
  if (process.env.DATABASE_URL) env.databaseUrl = process.env.DATABASE_URL;
  if (process.env.ADMIN_EMAIL) env.adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  return env;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}
