import type { ConversationSummary } from '@chatforge/types';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { attachmentUrl, formatBytes, isRenderableImage, type AttachmentRef } from '../../lib/attachments';
import { chatClient, type ChatState, type UiMessage } from '../../lib/chatClient';
import type { ReplyRef } from '../../lib/chatPayload';
import { contactLabel, contactsStore, handleFor, useContacts } from '../../lib/contacts';
import { conversationLabel, peerLabel } from '../../lib/displayPref';
import { loadVerification, type VerificationStatus } from '../../lib/keyVerification';
import { IconButton } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import type { MenuEntry } from '../../ui/Sheet';
import { Avatar, GroupMark, hueOf, PresenceDot, presenceKind } from './Avatar';
import { Composer } from './Composer';
import { ContextMenu, useLongPress } from './ContextMenu';
import { GroupPanel } from './GroupPanel';
import { VerifyKeys } from './VerifyKeys';

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
/** Consecutive messages from one sender within this window share a bubble group, as in chat-converter's preview. */
const GROUP_WINDOW_MS = 5 * 60_000;

type Row = { type: 'day'; key: string; label: string } | { type: 'msg'; key: string; m: UiMessage; cont: boolean };

function dayLabel(d: Date): string {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Day separators plus a `cont` flag for messages that continue the previous one's group. */
function toRows(messages: UiMessage[]): Row[] {
  const rows: Row[] = [];
  let day = '';
  let prev: UiMessage | undefined;
  for (const m of messages) {
    const d = new Date(m.ts);
    if (d.toDateString() !== day) {
      day = d.toDateString();
      rows.push({ type: 'day', key: `day-${day}`, label: dayLabel(d) });
      prev = undefined;
    }
    const cont = !!prev && prev.senderId === m.senderId && m.ts - prev.ts < GROUP_WINDOW_MS && !prev.deleted && !m.deleted;
    rows.push({ type: 'msg', key: m.id, m, cont });
    prev = m;
  }
  return rows;
}

export function Thread({ conversation, state, myId, onBack }: { conversation: ConversationSummary; state: ChatState; myId: string; onBack: () => void }): ReactNode {
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
  const [showGroup, setShowGroup] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const isGroup = conversation.kind === 'group';
  const { contacts } = useContacts();
  const saved = !!peer && contacts.some((c) => c.id === peer.id);
  const rows = useMemo(() => toRows(messages), [messages]);

  /** Who sent a message, for the name over incoming bubbles in a group. */
  const senderLabel = (senderId: string): string => {
    const p = conversation.peers.find((x) => x.id === senderId);
    if (!p) return 'Former member';
    return contactLabel({ ...p, ...state.profiles[p.id] }, contacts);
  };

  const toggleContact = async (): Promise<void> => {
    if (!peer) return;
    setSavingContact(true);
    try {
      if (saved) {
        if (window.confirm(`Remove ${contactLabel(peer, contacts)} from your contacts? This chat stays.`)) await contactsStore.remove(peer.id);
      } else {
        await contactsStore.save(handleFor(peer));
      }
    } catch {
      /* the contacts section shows load errors; a failed toggle just leaves the star as it was */
    } finally {
      setSavingContact(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, typing]);

  useEffect(() => {
    lastReadSent.current = 0;
    setReplyTo(null);
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
    // Safety numbers are pairwise; a group has no single "the other person" to compare against.
    if (!base || isGroup) return;
    let cancelled = false;
    void loadVerification(conversation.id, base.id).then((v) => !cancelled && setVerifyStatus(v.status));
    return () => {
      cancelled = true;
    };
  }, [conversation.id, base, isGroup, messages.length]);

  const menuMsg = menu ? messages.find((m) => m.seq === menu.seq) : undefined;
  const title = !isGroup && peer ? contactLabel(peer, contacts) : conversationLabel({ ...conversation, peers: peer ? [peer] : conversation.peers });
  const kind = presenceKind(presence);
  const subtitle = isGroup
    ? `${conversation.peers.length + 1} members`
    : kind === 'away'
      ? 'Away'
      : kind === 'online'
        ? 'Online'
        : presence?.lastSeenAt
          ? `Last seen ${new Date(presence.lastSeenAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
          : 'Offline';
  const status = !isGroup && (peer?.statusEmoji || peer?.statusText) ? `${peer?.statusEmoji ?? ''} ${peer?.statusText ?? ''}`.trim() : null;

  const menuEntries: MenuEntry[] =
    menu && menuMsg
      ? [
          ...(menuMsg.deleted
            ? []
            : ([
                {
                  label: 'Reply',
                  icon: 'reply',
                  onSelect: () => setReplyTo({ seq: menu.seq, text: menuMsg.text || (menuMsg.attachment ? `📎 ${menuMsg.attachment.name}` : ''), senderId: menuMsg.senderId }),
                },
                menuMsg.text ? { label: 'Copy text', icon: 'copy', onSelect: () => void navigator.clipboard?.writeText(menuMsg.text) } : null,
                menuMsg.attachment ? { label: 'Save file', icon: 'download', onSelect: () => void saveAttachment(menuMsg.attachment!) } : null,
                'separator',
                // Only my own messages can be unsent — the server enforces this too.
                menuMsg.mine ? { label: 'Delete for everyone', icon: 'trash', danger: true, onSelect: () => chatClient.deleteMessage(conversation.id, menu.seq) } : null,
              ] satisfies MenuEntry[])),
          { label: 'Remove for me', icon: 'minusCircle', hint: 'Only on this device', onSelect: () => void chatClient.hideMessage(conversation.id, menu.seq) },
        ]
      : [];

  return (
    <div
      className="cf-thread"
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
      <header className="cf-topbar">
        <button type="button" className="cf-back" onClick={onBack} aria-label="Back to conversations">
          <Icon name="chevronLeft" size={20} />
          <span>Chats</span>
        </button>
        <span className="cf-topbar__avatar">
          {isGroup ? (
            <GroupMark size={38} />
          ) : (
            <>
              <Avatar image={peer?.image} label={peer ? peerLabel(peer) : '?'} size={38} />
              <PresenceDot kind={kind} />
            </>
          )}
        </span>
        <div className="cf-topbar__titles">
          <p className="cf-topbar__title">{title}</p>
          <p className="cf-topbar__sub">
            <span className={kind === 'online' && !isGroup ? 'is-online' : undefined}>{subtitle}</span>
            {status && <span>{status}</span>}
          </p>
        </div>
        <div className="cf-topbar__actions">
          {isGroup ? (
            <button type="button" className="cf-chipbtn" onClick={() => setShowGroup(true)}>
              <Icon name="users" size={16} />
              <span>Members</span>
            </button>
          ) : (
            <>
              <IconButton
                icon="star"
                filled={saved}
                tone={saved ? 'accent' : undefined}
                disabled={savingContact || !peer}
                label={saved ? 'Saved to your contacts — remove' : 'Save to your contacts (they are not notified)'}
                onClick={() => void toggleContact()}
              />
              <button
                type="button"
                className={`cf-chipbtn is-${verifyStatus}`}
                onClick={() => setVerifying(true)}
                title="Compare safety numbers to confirm nobody is intercepting this chat"
              >
                <Icon name={verifyStatus === 'changed' ? 'alert' : 'shield'} size={16} />
                <span>{verifyStatus === 'verified' ? 'Verified' : verifyStatus === 'changed' ? 'Key changed' : 'Verify'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="cf-thread__body">
        <div className="cf-thread__inner">
          {messages.length === 0 && (
            <div className="cf-thread__hello">
              <Icon name="lock" size={18} />
              <p>Messages here are end-to-end encrypted. Say hi.</p>
            </div>
          )}
          {rows.map((row) =>
            row.type === 'day' ? (
              <div key={row.key} className="cf-day">
                <span>{row.label}</span>
              </div>
            ) : (
              <Bubble
                key={row.key}
                m={row.m}
                cont={row.cont}
                who={isGroup && !row.m.mine && !row.cont ? senderLabel(row.m.senderId) : undefined}
                read={row.m.seq !== null && peerRead >= row.m.seq}
                myId={myId}
                conversationId={conversation.id}
                onMenu={(seq, x, y) => setMenu({ seq, x, y })}
              />
            ),
          )}
          {typing && (
            <div className="cf-typing">
              <span className="cf-typing__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {isGroup ? 'Someone is typing…' : `${peer ? contactLabel(peer, contacts) : 'They'} is typing…`}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <Composer conversationId={conversation.id} replyTo={replyTo} replyName={replyTo ? (replyTo.senderId === myId ? 'yourself' : senderLabel(replyTo.senderId)) : undefined} onClearReply={() => setReplyTo(null)} />

      {dragging && (
        <div className="cf-dropveil">
          <div className="cf-dropveil__card">
            <Icon name="upload" size={26} />
            <p>Drop to send</p>
            <small>Encrypted before it leaves your browser</small>
          </div>
        </div>
      )}

      {showGroup && <GroupPanel conversation={conversation} state={state} myId={myId} onClose={() => setShowGroup(false)} />}

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
          label="Message actions"
          onClose={() => setMenu(null)}
          header={
            menuMsg.deleted ? undefined : (
              <div className="cf-quick" role="group" aria-label="React">
                {QUICK_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="cf-quick__btn"
                    aria-label={`React with ${e}`}
                    onClick={() => {
                      void chatClient.sendReaction(conversation.id, menu.seq, e);
                      setMenu(null);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )
          }
          entries={menuEntries}
        />
      )}
    </div>
  );
}

function Bubble({
  m,
  cont,
  who,
  read,
  myId,
  conversationId,
  onMenu,
}: {
  m: UiMessage;
  cont: boolean;
  who?: string;
  read: boolean;
  myId: string;
  conversationId: string;
  onMenu: (seq: number, x: number, y: number) => void;
}): ReactNode {
  const press = useLongPress((x, y) => {
    if (m.seq !== null) onMenu(m.seq, x, y);
  });
  const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`cf-msg ${m.mine ? 'cf-msg--out' : 'cf-msg--in'}${cont ? ' is-cont' : ''}${m.pending ? ' is-pending' : ''}${m.failed ? ' is-failed' : ''}`}>
      <div className="cf-msg__line">
        <div {...press} className={`cf-bubble${m.deleted ? ' is-deleted' : ''}`}>
          {who && (
            <p className="cf-bubble__who" style={{ '--who-hue': hueOf(who) } as CSSProperties}>
              {who}
            </p>
          )}
          {m.replyTo && (
            <div className="cf-bubble__reply">
              <Icon name="reply" size={13} />
              <span>{m.replyTo.text.slice(0, 80)}</span>
            </div>
          )}
          {m.uploading && (
            <p className="cf-bubble__note">
              <span className="cf-spinner" aria-hidden="true" /> Encrypting and uploading…
            </p>
          )}
          {m.deleted ? (
            <p className="cf-bubble__deleted">
              <Icon name="minusCircle" size={14} />
              This message was deleted
            </p>
          ) : (
            <>
              {m.attachment && <Attachment att={m.attachment} />}
              {m.text && <p className="cf-bubble__text">{m.text}</p>}
            </>
          )}
          <span className="cf-bubble__time">
            {time}
            {m.mine &&
              (m.failed ? (
                <span className="cf-ticks is-failed" aria-label="Not sent">
                  <Icon name="alert" size={13} />
                </span>
              ) : (
                <span className={`cf-ticks${read ? ' is-read' : ''}`} aria-label={m.pending ? 'Sending' : read ? 'Read' : 'Delivered'}>
                  <Icon name={m.pending ? 'clock' : read ? 'checks' : 'check'} size={13} />
                </span>
              ))}
          </span>
        </div>
        {m.seq !== null && (
          <button
            type="button"
            className="cf-msg__more"
            aria-label="Message actions"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(m.seq!, m.mine ? r.left - 220 : r.left, r.bottom + 4);
            }}
          >
            <Icon name="more" size={16} />
          </button>
        )}
      </div>
      {m.failed && (
        <div className="cf-msg__failed" role="status">
          <span>Not sent</span>
          <button type="button" onClick={() => void chatClient.retrySend(conversationId, m.id)}>
            Retry
          </button>
          <button type="button" onClick={() => void chatClient.discardUnsent(conversationId, m.id)}>
            Delete
          </button>
        </div>
      )}
      {!m.deleted && m.reactions && m.reactions.length > 0 && (
        <div className="cf-reactions">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => m.seq !== null && void chatClient.sendReaction(conversationId, m.seq, r.emoji)}
              className={`cf-reaction${r.by.includes(myId) ? ' is-mine' : ''}`}
              aria-pressed={r.by.includes(myId)}
            >
              {r.emoji} <span>{r.by.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * An attachment inside a bubble. Images decrypt and render inline; anything else stays a chip until
 * you ask for it, so a big file isn't downloaded just by scrolling past it.
 */
function Attachment({ att }: { att: AttachmentRef }): ReactNode {
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

  if (error) {
    return (
      <p className="cf-bubble__note is-error">
        <Icon name="alert" size={14} /> {error}
      </p>
    );
  }

  if (isImage) {
    if (!url) {
      return <div className="cf-bubble__imgwait">{loading && <span className="cf-spinner" aria-label="Decrypting" />}</div>;
    }
    return (
      <a href={url} target="_blank" rel="noreferrer noopener" className="cf-bubble__imglink">
        <img src={url} alt={att.name} className="cf-bubble__img" />
      </a>
    );
  }

  return (
    <div className="cf-att">
      <span className="cf-att__icon" aria-hidden="true">
        <Icon name="file" size={17} />
      </span>
      <span className="cf-att__text">
        <span className="cf-att__name">{att.name}</span>
        <span className="cf-att__size">{formatBytes(att.size)}</span>
      </span>
      <button
        type="button"
        className="cf-iconbtn"
        aria-label={`Save ${att.name}`}
        title="Decrypt and save"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError(null);
          void saveAttachment(att)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
        }}
      >
        {loading ? <span className="cf-spinner" aria-hidden="true" /> : <Icon name="download" size={17} />}
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
