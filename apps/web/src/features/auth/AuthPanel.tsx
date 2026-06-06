import { signIn, signOut, useSession } from '../../lib/authClient';

const btn = 'rounded-xl px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40';
// Logto's hosted account UI — where password, passkeys, social logins and 2FA are managed.
const ACCOUNT_URL = 'https://auth.robyrew.com';

export function AuthPanel() {
  const { data, isPending } = useSession();

  if (isPending) return <p className="text-sm text-zinc-400">Loading…</p>;

  if (data) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="text-sm text-zinc-300">
          Signed in as <span className="font-medium text-zinc-100">{data.user.email}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <a className={`${btn} bg-zinc-700 hover:bg-zinc-600`} href={ACCOUNT_URL} target="_blank" rel="noreferrer">
            Manage account
          </a>
          <button className={`${btn} bg-zinc-700 hover:bg-zinc-600`} onClick={() => signOut()}>
            Sign out
          </button>
        </div>
        <p className="text-xs text-zinc-500">Password, passkeys, social logins and 2FA are managed in your account.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-sm text-zinc-300">Sign in to save conversions and use end-to-end encrypted chat.</p>
      <button className={`${btn} bg-emerald-600 hover:bg-emerald-500 self-start`} onClick={() => signIn()}>
        Sign in / Create account
      </button>
      <p className="text-xs text-zinc-500">You'll be taken to our secure sign-in — email, social logins, passkeys and 2FA all supported.</p>
    </div>
  );
}
