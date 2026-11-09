import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import type { Conversation } from '@chatforge/types';
import { useMe } from '../../lib/useMe';
import { resolveSaveMode, saveConversationToVault } from '../../lib/vault';
import type { VaultMode } from '../../lib/vaultCrypto';
import { Icon } from '../../ui/Icon';

/**
 * Save the conversation open in the converter to the user's encrypted Vault. Only shown when signed in.
 * `getConversation` is read on click (applying the edits to a large export is not free); `revision`
 * changes whenever the converter opens or edits a conversation, which clears a previous "saved".
 */
export function SaveToVault({
  getConversation,
  revision,
}: {
  getConversation: () => Conversation | undefined;
  revision: number;
}): ReactNode {
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

  useEffect(() => {
    setState('idle');
    setError(undefined);
  }, [revision]);

  if (!me) return null;

  const save = async (): Promise<void> => {
    const conversation = getConversation();
    if (!conversation) return;
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
    <div className="cf-vault">
      <p className="cf-vault__title">
        <Icon name="lock" size={15} />
        ChatForge Vault
      </p>
      {locked ? (
        <p className="cf-vault__locked">
          Your vault passphrase is locked. <Link to="/settings">Unlock it in Settings</Link> to save across devices.
        </p>
      ) : (
        <button type="button" className={`rw-btn rw-btn--block${state === 'saved' ? ' cf-btn-ok' : ''}`} onClick={() => void save()} disabled={state === 'saving'}>
          <Icon name={state === 'saved' ? 'checkCircle' : 'lock'} size={16} />
          {state === 'saving' ? 'Encrypting…' : state === 'saved' ? 'Saved to Vault' : 'Save to Vault'}
        </button>
      )}
      <p className="cf-vault__hint">
        {mode === 'passphrase' ? 'Encrypted with your vault passphrase, so it opens on your other devices.' : 'Encrypted on this device; the server can’t read it.'} Find it in Chat →
        Vault.
      </p>
      {error && (
        <p className="cf-vault__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
