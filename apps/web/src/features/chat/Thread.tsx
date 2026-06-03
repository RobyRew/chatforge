import type { ConversationSummary } from '@chatforge/types';
import { useEffect, useRef, type ReactNode } from 'react';
import { chatClient, type ChatState, type UiMessage } from '../../lib/chatClient';
import { Composer } from './Composer';

export function Thread({ conversation, state }: { conversation: ConversationSummary; state: ChatState }): ReactNode {
  const messages = state.messages[conversation.id] ?? [];
  const peer = conversation.peers[0];
  const presence = peer ? state.presence[peer.id] : undefined;
  const typing = !!state.typing[conversation.id];
  const peerRead = state.peerRead[conversation.id] ?? 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastReadSent = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typing]);

  useEffect(() => {
    lastReadSent.current = 0;
  }, [conversation.id]);

  useEffect(() => {
    let lastSeq = 0;
    for (const m of messages) if (!m.mine && m.seq && m.seq > lastSeq) lastSeq = m.seq;
    if (lastSeq > lastReadSent.current) {
      lastReadSent.current = lastSeq;
      chatClient.markRead(conversation.id, lastSeq);
    }
  }, [messages, conversation.id]);

  return (
    <div className="flex h-[72vh] flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${presence?.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{peer?.email ?? 'Unknown'}</p>
          <p className="text-xs text-zinc-500">
            {presence?.online ? 'online' : presence?.lastSeenAt ? `last seen ${new Date(presence.lastSeenAt).toLocaleString()}` : 'offline'}
          </p>
        </div>
        <span className="ml-auto whitespace-nowrap text-xs text-zinc-600">🔒 end-to-end encrypted</span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-center text-xs text-zinc-500">No messages yet — say hi 👋</p>}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} read={m.seq !== null && peerRead >= m.seq} />
        ))}
        {typing && <p className="text-xs italic text-zinc-500">{peer?.email ?? 'Peer'} is typing…</p>}
        <div ref={bottomRef} />
      </div>

      <Composer conversationId={conversation.id} />
    </div>
  );
}

function Bubble({ m, read }: { m: UiMessage; read: boolean }): ReactNode {
  return (
    <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-100'} ${m.pending ? 'opacity-60' : ''}`}>
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        <p className={`mt-0.5 text-[10px] ${m.mine ? 'text-sky-200' : 'text-zinc-500'}`}>
          {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {m.mine && (m.pending ? ' · …' : read ? ' · ✓✓' : ' · ✓')}
        </p>
      </div>
    </div>
  );
}
