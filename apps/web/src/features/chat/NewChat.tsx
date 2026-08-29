import { useState, type ReactNode } from 'react';
import { chatClient } from '../../lib/chatClient';

const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500';

export function NewChat({ onCreated }: { onCreated: (conversationId: string) => void }): ReactNode {
  const [mode, setMode] = useState<'dm' | 'group'>('dm');
  const [handle, setHandle] = useState('');
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (fn: () => Promise<string | null>, reset: () => void): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const id = await fn();
      if (id) {
        onCreated(id);
        reset();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startDm = (): Promise<void> => run(() => chatClient.newChat(handle), () => setHandle(''));
  // One per line or comma-separated — whichever the user reaches for.
  const memberList = (): string[] => members.split(/[\n,]/).map((m) => m.trim()).filter(Boolean);
  const startGroup = (): Promise<void> =>
    run(
      () => chatClient.newGroup(title, memberList()),
      () => {
        setTitle('');
        setMembers('');
      },
    );

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex gap-1" role="tablist" aria-label="New conversation type">
        {(['dm', 'group'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(undefined);
            }}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${mode === m ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            {m === 'dm' ? 'Direct' : 'Group'}
          </button>
        ))}
      </div>

      {mode === 'dm' ? (
        <>
          <input
            className={field}
            type="text"
            placeholder="email or @username"
            value={handle}
            disabled={busy}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handle.trim() && void startDm()}
          />
          <button
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
            disabled={busy || !handle.trim()}
            onClick={() => void startDm()}
          >
            {busy ? 'Starting…' : 'Start chat'}
          </button>
        </>
      ) : (
        <>
          <input className={field} type="text" placeholder="Group name" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            className={`${field} min-h-[60px] resize-y`}
            placeholder={'Members — one per line\nemail or @username'}
            value={members}
            disabled={busy}
            onChange={(e) => setMembers(e.target.value)}
          />
          <button
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
            disabled={busy || !title.trim() || memberList().length === 0}
            onClick={() => void startGroup()}
          >
            {busy ? 'Creating…' : `Create group${memberList().length ? ` (${memberList().length})` : ''}`}
          </button>
          <p className="text-[11px] text-zinc-600">
            Everyone must have opened Chat at least once, so their encryption keys exist.
          </p>
        </>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
