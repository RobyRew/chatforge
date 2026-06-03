import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Me } from './api';

/** Current user + computed effective permissions (from /api/me). `null` when signed out. */
export function useMe(): { me: Me | null; loading: boolean; refresh: () => Promise<void>; can: (perm: string) => boolean } {
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
    void refresh();
  }, [refresh]);

  return { me, loading, refresh, can: (perm: string) => !!me?.permissions.includes(perm) };
}
