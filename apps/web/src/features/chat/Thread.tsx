import type { ConversationSummary } from '@chatforge/types';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { attachmentUrl, formatBytes, isRenderableImage, type AttachmentRef } from '../../lib/attachments';
import { chatClient, type ChatState, type UiMessage } from '../../lib/chatClient';
import type { ReplyRef } from '../../lib/chatPayload';
import { peerLabel } from '../../lib/displayPref';
import { loadVerification, type VerificationStatus } from '../../lib/keyVerification';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { ContextMenu, useLongPress } from './ContextMenu';
import { VerifyKeys } from './VerifyKeys';

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function Thread({ conversation, state, myId }: { conversation: ConversationSummary; state: ChatState; myId: string }): ReactNode {
  const messages = state.messages[conversation.id] ?? [];
  const base = conversation.peers[0];
  const peer = base ? { ...base, ...state.profiles[base.id] } : undefined;
  const presence = base ? state.presence[base.id] : undefined;
  const typing = !!state.typing[conversation.id];
  const peerRead = state.peerRead[conversation.id] ?? 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastReadSent = useRef(0);
  const dragDepth = useRef(0);
  const [menu, setMenu] = useState<{ seq: number; x: number; y: number } | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [dragging, setDragging] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerificationStatus>('unverified');

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

  // Surface a changed key in the header without the user having to open the panel — a silent
  // key swap is exactly what this feature exists to catch.
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    void loadVerification(conversation.id, base.id).then((v) => !cancelled && setVerifyStatus(v.status));
    return () => {
      cancelled = true;
    };
  }, [conversation.id, base, messages.length]);

  const menuMsg = menu ? messages.find((m) => m.seq === menu.seq) : undefined;

  return (
    <div
      className="relative flex h-[72vh] flex-col rounded-xl border border-zinc-800 bg-zinc-900/40"
      // Depth-counted so moving over child elements doesn't flicker the overlay off.
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        for (const file of Array.from(e.dataTransfer.files).slice(0, 10)) {
          void chatClient.sendAttachment(conversation.id, file, '', replyTo ?? undefined);
        }
        setReplyTo(null);
      }}
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-zinc-800 px-4 py-3">
        <Avatar image={peer?.image} label={peer ? peerLabel(peer) : '?'} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{peer ? peerLabel(peer) : 'Unknown'}</p>
          <p className="truncate text-xs text-zinc-500">
            {presence?.state === 'away' ? 'away' : presence?.online ? 'online' : presence?.lastSeenAt ? `last seen ${new Date(presence.lastSeenAt).toLocaleString()}` : 'offline'}
            {(peer?.statusEmoji || peer?.statusText) && ` · ${peer?.statusEmoji ?? ''} ${peer?.statusText ?? ''}`.trimEnd()}
          </p>
        </div>
        <button
          className={`ml-auto whitespace-nowrap rounded-full border px-2 py-1 text-xs transition ${
            verifyStatus === 'verified'
              ? 'border-emerald-700/60 text-emerald-400 hover:border-emerald-500'
              : verifyStatus === 'changed'
                ? 'border-amber-600 text-amber-300 hover:border-amber-400'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
          }`}
          onClick={() => setVerifying(true)}
          title="Compare safety numbers to confirm nobody is intercepting this chat"
        >
          {verifyStatus === 'verified' ? '✓ verified' : verifyStatus === 'changed' ? '⚠ key changed' : '🔒 verify keys'}
        </button>
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

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-sky-500 bg-zinc-950/80">
          <p className="text-sm text-sky-300">Drop to send — encrypted before it leaves your browser</p>
        </div>
      )}

      {verifying && base && (
        <VerifyKeys
          conversationId={conversation.id}
          peerId={base.id}
          peerLabel={peer ? peerLabel(peer) : 'them'}
          onClose={() => {
            setVerifying(false);
            void loadVerification(conversation.id, base.id).then((v) => setVerifyStatus(v.status));
          }}
        />
      )}

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
            ...(menuMsg.deleted
              ? []
              : [
                  { label: 'Reply', onClick: () => setReplyTo({ seq: menu.seq, text: menuMsg.text || (menuMsg.attachment ? `📎 ${menuMsg.attachment.name}` : ''), senderId: menuMsg.senderId }) },
                  ...(menuMsg.text ? [{ label: 'Copy text', onClick: () => void navigator.clipboard?.writeText(menuMsg.text) }] : []),
                  ...(menuMsg.attachment ? [{ label: 'Save file', onClick: () => void saveAttachment(menuMsg.attachment!) }] : []),
                  // Only my own messages can be unsent — the server enforces this too.
                  ...(menuMsg.mine ? [{ label: 'Delete for everyone', onClick: () => chatClient.deleteMessage(conversation.id, menu.seq) }] : []),
                ]),
            { label: 'Remove for me', onClick: () => void chatClient.hideMessage(conversation.id, menu.seq) },
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
          {m.uploading && <p className="py-1 text-xs opacity-80">🔐 Encrypting &amp; uploading…</p>}
          {m.deleted ? (
            <p className="italic opacity-70">🚫 This message was deleted</p>
          ) : (
            <>
              {m.attachment && <Attachment att={m.attachment} mine={m.mine} />}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
            </>
          )}
          <p className={`mt-0.5 text-[10px] ${m.mine ? 'text-sky-200' : 'text-zinc-500'}`}>
            {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {m.mine && (m.pending ? ' · …' : read ? ' · ✓✓' : ' · ✓')}
          </p>
        </div>
        {!m.deleted && m.reactions && m.reactions.length > 0 && (
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

/**
 * An attachment inside a bubble. Images decrypt and render inline; anything else stays a chip until
 * you ask for it, so a big file isn't downloaded just by scrolling past it.
 */
function Attachment({ att, mine }: { att: AttachmentRef; mine: boolean }): ReactNode {
  const isImage = isRenderableImage(att.mime);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    setLoading(true);
    attachmentUrl(att)
      .then((u) => !cancelled && setUrl(u))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [att, isImage]);

  if (error) return <p className={`py-1 text-xs ${mine ? 'text-sky-100' : 'text-rose-400'}`}>⚠ {error}</p>;

  if (isImage) {
    if (!url) return <p className="py-1 text-xs opacity-80">{loading ? '🔓 Decrypting…' : ''}</p>;
    return (
      <a href={url} target="_blank" rel="noreferrer noopener" className="block">
        <img src={url} alt={att.name} className="max-h-72 w-auto rounded-lg" />
      </a>
    );
  }

  return (
    <div className={`my-1 flex items-center gap-2 rounded-lg px-2 py-1.5 ${mine ? 'bg-sky-700/60' : 'bg-zinc-900/70'}`}>
      <span className="text-lg">📎</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{att.name}</span>
        <span className="block text-[10px] opacity-70">{formatBytes(att.size)}</span>
      </span>
      <button
        className="shrink-0 rounded border border-white/20 px-2 py-0.5 text-[11px] transition hover:bg-white/10 disabled:opacity-50"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError(null);
          void saveAttachment(att)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
        }}
      >
        {loading ? '…' : 'Save'}
      </button>
    </div>
  );
}

/** Decrypt an attachment and hand it to the browser as a download. */
async function saveAttachment(att: AttachmentRef): Promise<void> {
  const url = await attachmentUrl(att);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
