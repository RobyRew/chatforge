import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Me } from './api';
import { useSession } from './authClient';

/**
 * Current user + **server-computed** effective permissions (from /api/me). `null` when signed out.
 * Re-fetches whenever the better-auth session changes (login/logout), so permission-gated UI such
 * as the navbar Admin link updates live. The server is always the real gate — this only drives UX.
 */
export function useMe(): { me: Me | null; loading: boolean; refresh: () => Promise<void>; can: (perm: string) => boolean } {
  const { data, isPending } = useSession();
  const sessionId = data?.user?.id ?? null;
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMe(await api.me());
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setMe(null); // 401 (signed out) or other
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPending) return; // wait for better-auth to resolve the session cookie first
    void refresh();
  }, [sessionId, isPending, refresh]);

  return { me, loading: loading || isPending, refresh, can: (perm: string) => !!me?.permissions.includes(perm) };
}
