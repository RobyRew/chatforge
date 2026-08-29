import type { ConversationSummary } from '@chatforge/types';
import { useState, type ReactNode } from 'react';
import { chatClient, type ChatState } from '../../lib/chatClient';
import { peerLabel } from '../../lib/displayPref';
import { Avatar } from './Avatar';

/**
 * Group roster: who is in, plus add/remove for the owner and leave for everyone else.
 *
 * Adding or removing is not just a database row — each action relays an MLS commit that rotates the
 * group secrets. Removal in particular is what actually revokes access; the UI stays disabled until
 * it completes so the two can't drift apart.
 */
export function GroupPanel({ conversation, state, myId, onClose }: { conversation: ConversationSummary; state: ChatState; myId: string; onClose: () => void }): ReactNode {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const isOwner = conversation.createdBy === myId;

  const act = async (fn: () => Promise<void>): Promise<void> => {
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Group members" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">{conversation.title || 'Group'}</h2>
          <button className="ml-auto text-zinc-500 hover:text-white" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">{conversation.peers.length + 1} members{isOwner ? ' · you own this group' : ''}</p>

        <ul className="mt-4 flex flex-col gap-1">
          <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-300">
            <Avatar label="me" size={26} />
            <span className="flex-1">You</span>
            {isOwner && <span className="text-[11px] text-zinc-500">owner</span>}
          </li>
          {conversation.peers.map((p) => {
            const peer = { ...p, ...state.profiles[p.id] };
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-300">
                <Avatar image={peer.image} label={peerLabel(peer)} size={26} />
                <span className="min-w-0 flex-1 truncate">{peerLabel(peer)}</span>
                {isOwner && (
                  <button
                    className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 transition hover:border-rose-600 hover:text-rose-300 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void act(() => chatClient.removeGroupMember(conversation.id, p.id))}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {isOwner ? (
          <div className="mt-4 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500"
              placeholder="email or @username"
              value={handle}
              disabled={busy}
              onChange={(e) => setHandle(e.target.value)}
            />
            <button
              className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
              disabled={busy || !handle.trim()}
              onClick={() =>
                void act(async () => {
                  await chatClient.addGroupMember(conversation.id, handle);
                  setHandle('');
                })
              }
            >
              Add
            </button>
          </div>
        ) : (
          <button
            className="mt-4 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-rose-600 hover:text-rose-300 disabled:opacity-40"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await chatClient.leaveGroup(conversation.id);
                onClose();
              })
            }
          >
            Leave group
          </button>
        )}

        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <p className="mt-3 text-[11px] text-zinc-600">
          Adding or removing someone re-keys the group. A removed member cannot read anything sent afterwards,
          but they keep whatever they already received — that is how forward secrecy works, not a gap.
        </p>
      </div>
    </div>
  );
}
