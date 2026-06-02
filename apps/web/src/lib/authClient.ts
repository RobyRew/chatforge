import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/react';

/**
 * Same-origin by default ('' → /api/auth), which in dev is proxied to the API (see vite.config)
 * so the session cookie stays same-origin over http. Set VITE_API_URL only for a cross-origin
 * production setup (then configure CORS + SameSite=None;Secure cookies accordingly).
 */
const API_URL = import.meta.env.VITE_API_URL ?? '';

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [passkeyClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
