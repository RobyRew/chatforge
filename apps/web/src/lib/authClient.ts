import { useEffect, useState } from 'react';

/**
 * Logto (Traditional Web) session client. The API owns the session — the browser only ever holds
 * the opaque `cf_sid` cookie; no token touches client JS. "Auth actions" are top-level navigations
 * to the API's /api/auth/* routes, which redirect to Logto's hosted UI (email/password, social,
 * passkeys, MFA). Same-origin in prod (chat.robyrew.com → /api); in dev, Vite proxies /api → the API
 * (see vite.config) so the cookie stays same-origin over http. Set VITE_API_URL for a cross-origin
 * setup (then also configure CORS + SameSite=None;Secure cookies).
 */
const API_URL = import.meta.env.VITE_API_URL ?? '';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: 'active' | 'suspended';
  permissions: string[];
}

/** Begin sign-in: full-page redirect to Logto (via the API), returning to `returnTo` (or here). */
export function signIn(returnTo?: string): void {
  const rt = returnTo ?? window.location.pathname + window.location.search;
  window.location.href = `${API_URL}/api/auth/sign-in?returnTo=${encodeURIComponent(rt)}`;
}

/** Sign out everywhere: ends the Logto SSO session, then returns home. */
export function signOut(): void {
  window.location.href = `${API_URL}/api/auth/sign-out`;
}

/**
 * Drop-in replacement for better-auth's `useSession`: resolves the current user from `/api/me`
 * (cookie-authenticated). `data` is `{ user }` when signed in, else `null`. Because auth actions are
 * full-page redirects, a one-shot fetch on mount is enough — no client-side auth store needed.
 */
export function useSession(): { data: { user: SessionUser } | null; isPending: boolean } {
  const [data, setData] = useState<{ user: SessionUser } | null>(null);
  const [isPending, setPending] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/me`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<{ user: SessionUser }>) : null))
      .then((j) => {
        if (alive) setData(j?.user ? { user: j.user } : null);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { data, isPending };
}
