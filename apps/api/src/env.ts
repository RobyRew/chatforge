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
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8787);
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:4321';
  const env: Env = {
    port,
    corsOrigin,
    logtoEndpoint: (process.env.LOGTO_ENDPOINT ?? 'https://auth.robyrew.com').replace(/\/+$/, ''),
    logtoAppId: process.env.LOGTO_APP_ID ?? '',
    logtoAppSecret: process.env.LOGTO_APP_SECRET ?? '',
    appBaseUrl: (process.env.APP_BASE_URL ?? corsOrigin).replace(/\/+$/, ''),
  };
  if (process.env.DATABASE_URL) env.databaseUrl = process.env.DATABASE_URL;
  if (process.env.ADMIN_EMAIL) env.adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  return env;
}
