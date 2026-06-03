import { useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { ui } from '../admin/ui';

export function ChangePasswordPage(): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">Change password</h1>
      {done ? (
        <p className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4 text-sm text-emerald-200">Your password has been changed.</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <input className={ui.field} type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className={ui.field} type="password" placeholder="New password (min 8)" value={next} onChange={(e) => setNext(e.target.value)} />
          <input className={ui.field} type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button
            className={`${ui.btn} ${ui.primary}`}
            disabled={busy || !current || next.length < 8 || next !== confirm}
            onClick={() => void submit()}
          >
            Change password
          </button>
          {next && confirm && next !== confirm && <p className="text-sm text-rose-300">Passwords don’t match.</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
