export interface Env {
  port: number;
  corsOrigin: string;
  databaseUrl?: string;
  /** better-auth signing secret (set BETTER_AUTH_SECRET in prod). */
  authSecret: string;
  /** Public base URL of the API (where better-auth is mounted). */
  baseURL: string;
  /** Passkey/WebAuthn relying-party id (domain, no scheme). `localhost` in dev. */
  rpID: string;
  /** Passkey/WebAuthn origin (scheme + host[:port], no trailing slash) — the web app's URL. */
  passkeyOrigin: string;
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8787);
  const env: Env = {
    port,
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4321',
    authSecret: process.env.BETTER_AUTH_SECRET ?? 'dev-insecure-secret-change-in-production',
    baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`,
    rpID: process.env.PASSKEY_RPID ?? 'localhost',
    passkeyOrigin: process.env.PASSKEY_ORIGIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:4321',
  };
  if (process.env.DATABASE_URL) env.databaseUrl = process.env.DATABASE_URL;
  return env;
}
