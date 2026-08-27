import { useEffect, useState, type ReactNode } from 'react';
import { isVaultUnlocked, lockVault, unlockVault, vaultPassphraseEnabled } from '../../../lib/vaultCrypto';
import { ui } from '../../admin/ui';

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
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Vault passphrase (cross-device)</h3>
      {enabled === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : unlocked ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-emerald-300">✓ Vault unlocked for this session.</p>
          <button
            className={`${ui.btn} ${ui.ghost}`}
            onClick={() => {
              lockVault();
              setUnlocked(false);
            }}
          >
            Lock
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-500">
            {enabled
              ? 'Enter your vault passphrase to unlock saved chats on this device.'
              : 'Set a passphrase to encrypt saved chats so you can open them on any device. Keep it safe — if you forget it, those chats can’t be recovered.'}
          </p>
          <input className={ui.field} type="password" placeholder="Vault passphrase (min 8)" value={pass} onChange={(e) => setPass(e.target.value)} />
          {!enabled && <input className={ui.field} type="password" placeholder="Confirm passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          <button
            className={`${ui.btn} ${ui.primary} self-start`}
            disabled={busy || pass.length < 8 || (!enabled && pass !== confirm)}
            onClick={() => void submit()}
          >
            {enabled ? 'Unlock' : 'Set passphrase'}
          </button>
        </>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </section>
  );
}
