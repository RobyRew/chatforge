import type { ReactNode } from 'react';
import type { ChatState } from '../../lib/chatClient';

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
        const peer = c.peers[0];
        const online = peer ? state.presence[peer.id]?.online : false;
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-sky-600/20 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              <span className="truncate">{peer?.email ?? 'Unknown'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
