import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type Passkey } from '../../lib/api';
import { authClient } from '../../lib/authClient';
import { useMe } from '../../lib/useMe';
import { ui } from '../admin/ui';

export function SettingsPage(): ReactNode {
  const { me, loading, refresh } = useMe();

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!me) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-300">
        Please{' '}
        <Link to="/account" className="text-sky-400">
          sign in
        </Link>{' '}
        to manage your settings.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold">Settings</h1>
      <ProfileCard me={me} onSaved={refresh} />
      <PasskeysCard />
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        Password —{' '}
        <Link to="/change-password" className="text-sky-400 hover:text-sky-300">
          change your password
        </Link>
        .
      </section>
    </div>
  );
}

function ProfileCard({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }): ReactNode {
  const [name, setName] = useState(me.name ?? '');
  const [username, setUsername] = useState(me.username ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      await api.updateProfile({ name: name.trim() || undefined, username: username.trim() || undefined });
      setMsg('Saved.');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Profile</h3>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Email (sign-in, can’t change here)
        <input className={`${ui.field} opacity-60`} value={me.email} disabled />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Display name
        <input className={ui.field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Username (unique handle)
        <input className={ui.field} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="3–20 chars: a–z, 0–9, _" />
      </label>
      <p className="text-xs text-zinc-500">People can start a chat with you by email or <span className="font-mono text-zinc-300">@{username || 'username'}</span>.</p>
      <div className="flex items-center gap-3">
        <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => void save()}>
          Save
        </button>
        {msg && <span className="text-sm text-emerald-300">{msg}</span>}
        {error && <span className="text-sm text-rose-300">{error}</span>}
      </div>
    </section>
  );
}

function PasskeysCard(): ReactNode {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async (): Promise<void> => {
    try {
      setPasskeys(await api.listPasskeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => void load(), []);

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const r = (await authClient.passkey.addPasskey()) as { error?: { message?: string } | null } | undefined;
      if (r?.error) throw new Error(r.error.message ?? 'Could not add passkey');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await api.deletePasskey(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Passkeys</h3>
        <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => void add()}>
          Add passkey
        </button>
      </div>
      {passkeys.length === 0 ? (
        <p className="text-sm text-zinc-500">No passkeys yet. Add one for passwordless sign-in.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-800">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="text-zinc-100">{p.name || 'Passkey'}</span>
                <p className="text-xs text-zinc-500">
                  {p.deviceType}
                  {p.backedUp ? ' · synced' : ' · device-bound'}
                  {p.createdAt ? ` · added ${new Date(p.createdAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button className={`${ui.btn} ${ui.danger}`} disabled={busy} onClick={() => void revoke(p.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </section>
  );
}
