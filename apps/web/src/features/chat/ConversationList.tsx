import type { ReactNode } from 'react';
import type { ChatState } from '../../lib/chatClient';
import { peerLabel } from '../../lib/displayPref';
import { Avatar } from './Avatar';

export function ConversationList({
  state,
  activeId,
  onSelect,
}: {
  state: ChatState;
  activeId: string | null;
  onSelect: (id: string) => void;
}): ReactNode {
  if (!state.conversations.length) {
    return <p className="px-1 py-3 text-xs text-zinc-500">No conversations yet. Start one above.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {state.conversations.map((c) => {
        const base = c.peers[0];
        const peer = base ? { ...base, ...state.profiles[base.id] } : undefined;
        const pres = base ? state.presence[base.id] : undefined;
        const dot = pres?.state === 'away' ? 'bg-amber-400' : pres?.online ? 'bg-emerald-400' : 'bg-zinc-600';
        const active = c.id === activeId;
        const status = peer?.statusEmoji || peer?.statusText ? `${peer?.statusEmoji ?? ''} ${peer?.statusText ?? ''}`.trim() : null;
        return (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${active ? 'bg-sky-600/20 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
            >
              <span className="relative">
                <Avatar image={peer?.image} label={peer ? peerLabel(peer) : '?'} size={30} />
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 ${dot}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{peer ? peerLabel(peer) : 'Unknown'}</span>
                {status && <span className="block truncate text-xs text-zinc-500">{status}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
