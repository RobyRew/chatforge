import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import type { Conversation } from '@chatforge/types';
import { useMe } from '../../lib/useMe';
import { resolveSaveMode, saveConversationToVault } from '../../lib/vault';
import type { VaultMode } from '../../lib/vaultCrypto';

/** Save the (edited) conversation to the user's encrypted Vault. Only shown when signed in. */
export function SaveToVault({ conversation }: { conversation: Conversation }): ReactNode {
  const { me } = useMe();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<VaultMode>('device');
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!me) return;
    void resolveSaveMode()
      .then((r) => {
        setMode(r.mode);
        setLocked(r.locked);
      })
      .catch(() => undefined);
  }, [me]);

  if (!me) return null;

  const save = async (): Promise<void> => {
    setState('saving');
    setError(undefined);
    try {
      await saveConversationToVault(conversation, mode);
      setState('saved');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {locked ? (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-2.5 text-xs text-amber-200">
          🔒 Your vault passphrase is locked.{' '}
          <Link to="/settings" className="underline">
            Unlock in Settings
          </Link>{' '}
          to save across devices.
        </div>
      ) : (
        <button
          onClick={() => void save()}
          disabled={state === 'saving'}
          className="rounded-xl border border-zinc-700 px-4 py-2.5 font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          {state === 'saving' ? 'Encrypting…' : state === 'saved' ? '✓ Saved to Vault' : '🔒 Save to Vault'}
        </button>
      )}
      <p className="text-[11px] text-zinc-500">
        {mode === 'passphrase' ? 'Encrypted with your vault passphrase (syncs across devices).' : 'Encrypted on this device; the server can’t read it.'} Find it in Chat → Vault.
      </p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
