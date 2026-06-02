import { useState } from 'react';
import { authClient, signIn, signOut, signUp, useSession } from '../../lib/authClient';

const field = 'rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100';
const btn = 'rounded-xl px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40';

type Result = { error?: { message?: string } | null } | null | undefined;

export function AuthPanel() {
  const { data, isPending } = useSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const r = (await fn()) as Result;
      if (r && r.error) setError(r.error.message ?? 'Something went wrong');
      else if (ok) setNotice(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (isPending) return <p className="text-sm text-zinc-400">Loading…</p>;

  if (data) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="text-sm text-zinc-300">
          Signed in as <span className="font-medium text-zinc-100">{data.user.email}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className={`${btn} bg-sky-600 hover:bg-sky-500`}
            disabled={busy}
            onClick={() => void run(() => authClient.passkey.addPasskey(), 'Passkey registered.')}
          >
            Add a passkey
          </button>
          <button
            className={`${btn} bg-zinc-700 hover:bg-zinc-600`}
            disabled={busy}
            onClick={() => void run(() => signOut())}
          >
            Sign out
          </button>
        </div>
        {notice && <p className="text-sm text-emerald-300">{notice}</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex gap-3 text-sm">
        <button onClick={() => setMode('signin')} className={mode === 'signin' ? 'text-sky-400' : 'text-zinc-400'}>
          Sign in
        </button>
        <span className="text-zinc-600">·</span>
        <button onClick={() => setMode('signup')} className={mode === 'signup' ? 'text-sky-400' : 'text-zinc-400'}>
          Create account
        </button>
      </div>

      {mode === 'signup' && (
        <input className={field} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      )}
      <input className={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        className={field}
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        className={`${btn} bg-emerald-600 hover:bg-emerald-500`}
        disabled={busy || !email || !password}
        onClick={() =>
          void run(() =>
            mode === 'signin'
              ? signIn.email({ email, password })
              : signUp.email({ email, password, name: name || email }),
          )
        }
      >
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-zinc-800" />
        or
        <span className="h-px flex-1 bg-zinc-800" />
      </div>
      <button
        className={`${btn} bg-sky-600 hover:bg-sky-500`}
        disabled={busy}
        onClick={() => void run(() => signIn.passkey())}
      >
        Sign in with a passkey
      </button>

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
}
