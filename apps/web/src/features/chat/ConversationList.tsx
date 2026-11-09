import type { ReactNode } from 'react';
import type { ChatState, UiMessage } from '../../lib/chatClient';
import { contactLabel, useContacts } from '../../lib/contacts';
import { conversationLabel, peerLabel } from '../../lib/displayPref';
import { Icon } from '../../ui/Icon';
import { Avatar, GroupMark, PresenceDot, presenceKind } from './Avatar';

/** "14:05" today, the weekday within a week, otherwise the date. */
export function shortTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }) });
}

function preview(m: UiMessage): ReactNode {
  if (m.deleted) return <em>Message deleted</em>;
  const who = m.mine ? 'You: ' : '';
  if (m.attachment && !m.text) {
    return (
      <>
        {who}
        <Icon name="paperclip" size={13} className="cf-row__glyph" />
        {m.attachment.name}
      </>
    );
  }
  return `${who}${m.text}`;
}

export function ConversationList({
  state,
  activeId,
  onSelect,
  onNew,
}: {
  state: ChatState;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}): ReactNode {
  const { contacts } = useContacts();
  if (!state.conversations.length) {
    return (
      <div className="cf-list-empty">
        <p>No conversations yet.</p>
        <button type="button" className="rw-btn rw-btn--sm" onClick={onNew}>
          <Icon name="pencil" size={14} />
          Start one
        </button>
      </div>
    );
  }
  return (
    <ul className="cf-rows">
      {state.conversations.map((c) => {
        const isGroup = c.kind === 'group';
        const base = c.peers[0];
        const peer = base ? { ...base, ...state.profiles[base.id] } : undefined;
        const kind = base && !isGroup ? presenceKind(state.presence[base.id]) : 'offline';
        const active = c.id === activeId;
        const label = !isGroup && peer ? contactLabel(peer, contacts) : conversationLabel({ ...c, peers: peer ? [peer] : c.peers });
        const last = (state.messages[c.id] ?? []).at(-1);
        const typing = !!state.typing[c.id];
        // A group's subtitle is its size; a custom status only makes sense for one person.
        const status = isGroup ? `${c.peers.length + 1} members` : peer?.statusEmoji || peer?.statusText ? `${peer?.statusEmoji ?? ''} ${peer?.statusText ?? ''}`.trim() : null;
        return (
          <li key={c.id}>
            <button type="button" onClick={() => onSelect(c.id)} className={`cf-row${active ? ' is-active' : ''}`} aria-current={active ? 'true' : undefined}>
              <span className="cf-row__avatar">
                {isGroup ? (
                  <GroupMark size={40} />
                ) : (
                  <>
                    <Avatar image={peer?.image} label={peer ? peerLabel(peer) : '?'} size={40} />
                    <PresenceDot kind={kind} />
                  </>
                )}
              </span>
              <span className="cf-row__main">
                <span className="cf-row__top">
                  <span className="cf-row__title">{label}</span>
                  {!isGroup && peer?.statusEmoji && (
                    <span className="cf-row__emoji" title={peer.statusText ?? undefined}>
                      {peer.statusEmoji}
                    </span>
                  )}
                  {last && <span className="cf-row__time">{shortTime(last.ts)}</span>}
                </span>
                <span className={`cf-row__sub${typing ? ' is-typing' : ''}`}>{typing ? 'typing…' : last ? preview(last) : (status ?? 'No messages yet')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
