import { useState, type ReactNode } from 'react';
import { chatClient } from '../../lib/chatClient';

const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500';

export function NewChat({ onCreated }: { onCreated: (conversationId: string) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const id = await chatClient.newChat(email);
      if (id) {
        onCreated(id);
        setEmail('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <label className="text-xs font-medium text-zinc-400">New conversation</label>
      <input
        className={field}
        type="text"
        placeholder="email or @username"
        value={email}
        disabled={busy}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && email.trim() && void start()}
      />
      <button
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        disabled={busy || !email.trim()}
        onClick={() => void start()}
      >
        {busy ? 'Starting…' : 'Start chat'}
      </button>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
