import { useState, type ReactNode } from 'react';
import type { Conversation } from '@chatforge/types';
import { useMe } from '../../lib/useMe';
import { saveConversationToVault } from '../../lib/vault';

/** Save the (edited) conversation to the user's encrypted Vault. Only shown when signed in. */
export function SaveToVault({ conversation }: { conversation: Conversation }): ReactNode {
  const { me } = useMe();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string>();

  if (!me) return null;

  const save = async (): Promise<void> => {
    setState('saving');
    setError(undefined);
    try {
      await saveConversationToVault(conversation);
      setState('saved');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => void save()}
        disabled={state === 'saving'}
        className="rounded-xl border border-zinc-700 px-4 py-2.5 font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:opacity-40"
      >
        {state === 'saving' ? 'Encrypting…' : state === 'saved' ? '✓ Saved to Vault' : '🔒 Save to Vault'}
      </button>
      <p className="text-[11px] text-zinc-500">Encrypted on this device; the server can’t read it. Find it in Chat → Vault.</p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
