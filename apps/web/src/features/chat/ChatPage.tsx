import { useSession } from '../../lib/authClient';
import { AuthPanel } from '../auth/AuthPanel';

export function ChatPage() {
  const { data, isPending } = useSession();

  if (isPending) return <p className="text-sm text-zinc-400">Loading…</p>;

  if (!data) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold">Chat</h1>
        <p className="text-sm text-zinc-400">Sign in to start an end-to-end encrypted conversation.</p>
        <AuthPanel />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h1 className="text-xl font-semibold">Chat</h1>
      <p className="text-sm text-zinc-300">
        Signed in as <span className="font-medium text-zinc-100">{data.user.email}</span>.
      </p>
      <p className="text-sm text-zinc-400">
        🔒 Real-time, end-to-end encrypted (MLS) messaging is being built (transport → MLS → UI). The
        account &amp; passkey foundation is live now.
      </p>
    </div>
  );
}
