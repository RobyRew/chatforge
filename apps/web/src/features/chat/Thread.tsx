import type { ConversationSummary } from '@chatforge/types';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chatClient, type ChatState, type UiMessage } from '../../lib/chatClient';
import type { ReplyRef } from '../../lib/chatPayload';
import { Composer } from './Composer';
import { ContextMenu, useLongPress } from './ContextMenu';

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function Thread({ conversation, state, myId }: { conversation: ConversationSummary; state: ChatState; myId: string }): ReactNode {
  const messages = state.messages[conversation.id] ?? [];
  const peer = conversation.peers[0];
  const presence = peer ? state.presence[peer.id] : undefined;
  const typing = !!state.typing[conversation.id];
  const peerRead = state.peerRead[conversation.id] ?? 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastReadSent = useRef(0);
  const [menu, setMenu] = useState<{ seq: number; x: number; y: number } | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);

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

  const menuMsg = menu ? messages.find((m) => m.seq === menu.seq) : undefined;

  return (
    <div className="flex h-[72vh] flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
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
          <Bubble key={m.id} m={m} read={m.seq !== null && peerRead >= m.seq} myId={myId} conversationId={conversation.id} onMenu={(seq, x, y) => setMenu({ seq, x, y })} />
        ))}
        {typing && <p className="text-xs italic text-zinc-500">{peer?.email ?? 'Peer'} is typing…</p>}
        <div ref={bottomRef} />
      </div>

      <Composer conversationId={conversation.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />

      {menu && menuMsg && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          header={
            <div className="flex gap-1 border-b border-zinc-800 px-2 py-1.5">
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  className="rounded px-1 text-lg hover:bg-zinc-800"
                  onClick={() => {
                    void chatClient.sendReaction(conversation.id, menu.seq, e);
                    setMenu(null);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          }
          items={[
            { label: 'Reply', onClick: () => setReplyTo({ seq: menu.seq, text: menuMsg.text, senderId: menuMsg.senderId }) },
            { label: 'Copy text', onClick: () => void navigator.clipboard?.writeText(menuMsg.text) },
          ]}
        />
      )}
    </div>
  );
}

function Bubble({ m, read, myId, conversationId, onMenu }: { m: UiMessage; read: boolean; myId: string; conversationId: string; onMenu: (seq: number, x: number, y: number) => void }): ReactNode {
  const press = useLongPress((x, y) => {
    if (m.seq !== null) onMenu(m.seq, x, y);
  });
  return (
    <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
      <div className="flex max-w-[75%] flex-col gap-1">
        <div {...press} className={`rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-100'} ${m.pending ? 'opacity-60' : ''}`}>
          {m.replyTo && <div className="mb-1 border-l-2 border-white/40 pl-2 text-xs opacity-80">↩ {m.replyTo.text.slice(0, 80)}</div>}
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          <p className={`mt-0.5 text-[10px] ${m.mine ? 'text-sky-200' : 'text-zinc-500'}`}>
            {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {m.mine && (m.pending ? ' · …' : read ? ' · ✓✓' : ' · ✓')}
          </p>
        </div>
        {m.reactions && m.reactions.length > 0 && (
          <div className={`flex flex-wrap gap-1 ${m.mine ? 'justify-end' : ''}`}>
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => m.seq !== null && void chatClient.sendReaction(conversationId, m.seq, r.emoji)}
                className={`rounded-full px-1.5 py-0.5 text-xs ${r.by.includes(myId) ? 'bg-sky-600/40 text-white' : 'bg-zinc-800 text-zinc-300'}`}
              >
                {r.emoji} {r.by.length}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
