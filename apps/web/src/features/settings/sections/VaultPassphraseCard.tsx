import { useEffect, useState, type ReactNode } from 'react';
import { isVaultUnlocked, lockVault, unlockVault, vaultPassphraseEnabled } from '../../../lib/vaultCrypto';
import { Banner, Loading } from '../../../ui/controls';
import { Icon } from '../../../ui/Icon';
import { Card, ErrorText } from '../../../ui/kit';

export function VaultPassphraseCard(): ReactNode {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(isVaultUnlocked());
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void vaultPassphraseEnabled()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, []);

  const submit = async (): Promise<void> => {
    setError(undefined);
    if (enabled === false && pass !== confirm) {
      setError('Passphrases don’t match.');
      return;
    }
    setBusy(true);
    try {
      await unlockVault(pass);
      setUnlocked(true);
      setEnabled(true);
      setPass('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon="key"
      title="Vault passphrase"
      description="Encrypts saved chats so they open on any of your devices."
      actions={
        unlocked ? (
          <button
            type="button"
            className="rw-btn"
            onClick={() => {
              lockVault();
              setUnlocked(false);
            }}
          >
            <Icon name="lock" size={15} />
            Lock
          </button>
        ) : undefined
      }
    >
      {enabled === null ? (
        <Loading />
      ) : unlocked ? (
        <Banner tone="ok" icon="checkCircle">
          Vault unlocked for this session.
        </Banner>
      ) : (
        <form
          className="cf-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="cf-muted">
            {enabled
              ? 'Enter your vault passphrase to unlock saved chats on this device.'
              : 'Set a passphrase to encrypt saved chats so you can open them on any device. Keep it safe — if you forget it, those chats can’t be recovered.'}
          </p>
          <label className="cf-form__field">
            <span className="rw-label">Passphrase</span>
            <input className="rw-field" type="password" autoComplete={enabled ? 'current-password' : 'new-password'} placeholder="At least 8 characters" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          {!enabled && (
            <label className="cf-form__field">
              <span className="rw-label">Confirm passphrase</span>
              <input className="rw-field" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
          )}
          <div className="cf-actions-row">
            <button type="submit" className="rw-btn rw-btn--primary" disabled={busy || pass.length < 8 || (!enabled && pass !== confirm)}>
              {enabled ? 'Unlock' : 'Set passphrase'}
            </button>
          </div>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
