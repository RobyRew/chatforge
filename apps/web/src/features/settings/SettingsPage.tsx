import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type Profile } from '../../lib/api';
import { getDisplayAs, setDisplayAs, type DisplayAs } from '../../lib/displayPref';
import { useMe } from '../../lib/useMe';
import { disableNotifications, enableNotifications, notificationsPref } from '../../lib/notifications';
import { isVaultUnlocked, lockVault, unlockVault, vaultPassphraseEnabled } from '../../lib/vaultCrypto';
import { ui } from '../admin/ui';
import { Avatar } from '../chat/Avatar';

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
      <DisplayPrefCard />
      <NotificationsCard />
      <VaultPassphraseCard />
      <SecurityCard />
    </div>
  );
}

function ProfileCard({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }): ReactNode {
  const [p, setP] = useState<Profile>({ name: me.name ?? '', username: me.username, image: null, bio: null, about: null, statusEmoji: null, statusText: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api
      .getProfile()
      .then((full) => full && setP(full))
      .catch(() => undefined);
  }, []);

  const set = (patch: Partial<Profile>): void => setP((prev) => ({ ...prev, ...patch }));

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      await api.updateProfile({
        name: p.name.trim() || undefined,
        username: p.username?.trim() || undefined,
        image: p.image,
        bio: p.bio,
        about: p.about,
        statusEmoji: p.statusEmoji,
        statusText: p.statusText,
      });
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
      <div className="flex items-center gap-3">
        <Avatar image={p.image} label={p.name || me.email} size={48} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-200">Profile</h3>
          <p className="truncate text-xs text-zinc-500">{me.email}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Display name
          <input className={ui.field} value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Username
          <input className={ui.field} value={p.username ?? ''} onChange={(e) => set({ username: e.target.value.toLowerCase() })} placeholder="a–z, 0–9, _" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Avatar URL
        <input className={ui.field} value={p.image ?? ''} onChange={(e) => set({ image: e.target.value || null })} placeholder="https://… (uploads come in a later phase)" />
      </label>
      <div className="grid gap-2 sm:grid-cols-[88px_1fr]">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Status
          <input className={ui.field} value={p.statusEmoji ?? ''} onChange={(e) => set({ statusEmoji: e.target.value || null })} placeholder="🎵" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          <span className="invisible">x</span>
          <input className={ui.field} value={p.statusText ?? ''} onChange={(e) => set({ statusText: e.target.value || null })} placeholder="What you’re up to" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        Bio
        <input className={ui.field} value={p.bio ?? ''} onChange={(e) => set({ bio: e.target.value || null })} placeholder="A line about you" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">
        About
        <textarea className={`${ui.field} min-h-[60px] resize-y`} value={p.about ?? ''} onChange={(e) => set({ about: e.target.value || null })} placeholder="More about you" />
      </label>
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

function DisplayPrefCard(): ReactNode {
  const [as, setAs] = useState<DisplayAs>(getDisplayAs());
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Show people as</h3>
      <p className="text-xs text-zinc-500">How other people are labelled in your chats (applies as you navigate).</p>
      <div className="flex gap-2">
        {(['name', 'username', 'email'] as DisplayAs[]).map((opt) => (
          <button
            key={opt}
            onClick={() => {
              setDisplayAs(opt);
              setAs(opt);
            }}
            className={`${ui.btn} ${as === opt ? ui.primary : ui.ghost} capitalize`}
          >
            {opt}
          </button>
        ))}
      </div>
    </section>
  );
}

function SecurityCard(): ReactNode {
  // Password, passkeys, social logins and 2FA are all owned by Logto's hosted account UI.
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Security</h3>
      <p className="text-xs text-zinc-500">
        Your password, passkeys, connected social logins and two-factor authentication are managed in your account.
      </p>
      <a className={`${ui.btn} ${ui.primary} self-start`} href="https://auth.robyrew.com" target="_blank" rel="noreferrer">
        Manage account security
      </a>
    </section>
  );
}

function NotificationsCard(): ReactNode {
  const [on, setOn] = useState(notificationsPref());
  const [busy, setBusy] = useState(false);
  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      if (on) {
        disableNotifications();
        setOn(false);
      } else {
        setOn(await enableNotifications());
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">Browser notifications</h3>
        <p className="text-xs text-zinc-500">Get notified of new messages when ChatForge isn’t focused.</p>
      </div>
      <button className={`${ui.btn} ${on ? ui.ghost : ui.primary}`} disabled={busy} onClick={() => void toggle()}>
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </section>
  );
}

function VaultPassphraseCard(): ReactNode {
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
