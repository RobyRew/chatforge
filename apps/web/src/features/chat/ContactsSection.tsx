import type { ContactDTO } from '@chatforge/types';
import { useState, type ReactNode } from 'react';
import type { ChatState } from '../../lib/chatClient';
import { chatClient } from '../../lib/chatClient';
import { contactsStore, handleFor, useContacts } from '../../lib/contacts';
import { peerLabel } from '../../lib/displayPref';
import { Avatar } from './Avatar';

const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500';

/**
 * Sidebar list of saved contacts. Saving is one-sided — the other person is not told — and the
 * nickname is only ever shown to you.
 */
export function ContactsSection({ state, onOpen }: { state: ChatState; onOpen: (conversationId: string) => void }): ReactNode {
  const { contacts, loaded, error: loadError } = useContacts();
  const [adding, setAdding] = useState(false);
  const [handle, setHandle] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = (): Promise<void> =>
    run(async () => {
      await contactsStore.save(handle.trim());
      setHandle('');
      setAdding(false);
    });

  const open = (c: ContactDTO): Promise<void> =>
    run(async () => {
      const id = await chatClient.newChat(handleFor(c));
      if (id) onOpen(id);
    });

  const rename = (c: ContactDTO): Promise<void> =>
    run(async () => {
      await contactsStore.save(handleFor(c), nickname.trim() || null);
      setRenaming(null);
    });

  const remove = (c: ContactDTO): Promise<void> =>
    run(async () => {
      if (!window.confirm(`Remove ${c.nickname || peerLabel(c)} from your contacts? Your chat with them stays.`)) return;
      await contactsStore.remove(c.id);
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 pt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contacts</p>
        <button
          className="rounded px-1.5 text-xs text-zinc-400 transition hover:text-zinc-100"
          onClick={() => {
            setAdding((v) => !v);
            setError(undefined);
          }}
          aria-expanded={adding}
        >
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {adding && (
        <div className="flex gap-1.5 px-1">
          <input
            className={field}
            type="text"
            placeholder="email or @username"
            value={handle}
            disabled={busy}
            autoFocus
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handle.trim() && void add()}
          />
          <button
            className="rounded-lg bg-sky-600 px-2.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
            disabled={busy || !handle.trim()}
            onClick={() => void add()}
          >
            Save
          </button>
        </div>
      )}

      {loaded && !contacts.length && !adding && (
        <p className="px-1 py-1 text-xs text-zinc-500">No contacts yet. Save someone with ☆ in a chat, or + Add.</p>
      )}

      <ul className="flex flex-col gap-1">
        {contacts.map((c) => {
          const pres = state.presence[c.id];
          const dot = pres?.state === 'away' ? 'bg-amber-400' : pres?.online ? 'bg-emerald-400' : 'bg-zinc-600';
          const label = c.nickname || peerLabel(c);
          return (
            <li key={c.id} className="group">
              {renaming === c.id ? (
                <div className="flex gap-1.5 px-1 py-1">
                  <input
                    className={field}
                    type="text"
                    placeholder={peerLabel(c)}
                    value={nickname}
                    maxLength={64}
                    disabled={busy}
                    autoFocus
                    onChange={(e) => setNickname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(c);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                  <button className="rounded-lg px-2 text-xs text-zinc-300 hover:text-white" disabled={busy} onClick={() => void rename(c)}>
                    Save
                  </button>
                </div>
              ) : (
                <div className="flex items-center rounded-lg transition hover:bg-zinc-800">
                  <button className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm text-zinc-300" disabled={busy} onClick={() => void open(c)} title="Open chat">
                    <span className="relative">
                      <Avatar image={c.image} label={label} size={28} />
                      <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 ${dot}`} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{label}</span>
                      {c.nickname && <span className="block truncate text-xs text-zinc-500">{peerLabel(c)}</span>}
                    </span>
                  </button>
                  <span className="flex shrink-0 gap-0.5 pr-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      className="rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-100"
                      title="Rename"
                      aria-label={`Rename ${label}`}
                      onClick={() => {
                        setNickname(c.nickname ?? '');
                        setRenaming(c.id);
                      }}
                    >
                      ✎
                    </button>
                    <button className="rounded px-1.5 py-1 text-xs text-zinc-400 hover:text-rose-300" title="Remove" aria-label={`Remove ${label}`} onClick={() => void remove(c)}>
                      ✕
                    </button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {(error || loadError) && <p className="px-1 text-xs text-rose-300">{error ?? loadError}</p>}
    </div>
  );
}
