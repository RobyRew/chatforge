import type { ConversationSummary } from '@chatforge/types';
import { useState, type ReactNode } from 'react';
import { chatClient, type ChatState } from '../../lib/chatClient';
import { peerLabel } from '../../lib/displayPref';
import { Icon } from '../../ui/Icon';
import { ErrorText } from '../../ui/kit';
import { Sheet } from '../../ui/Sheet';
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
    <Sheet label="Group members" title={conversation.title || 'Group'} onClose={onClose}>
      <p className="cf-sheet__lead">
        {conversation.peers.length + 1} members{isOwner ? ' · you own this group' : ''}
      </p>

      <ul className="cf-members">
        <li className="cf-member">
          <Avatar label="me" size={32} />
          <span className="cf-member__name">You</span>
          {isOwner && <span className="rw-badge rw-badge--accent">Owner</span>}
        </li>
        {conversation.peers.map((p) => {
          const peer = { ...p, ...state.profiles[p.id] };
          return (
            <li key={p.id} className="cf-member">
              <Avatar image={peer.image} label={peerLabel(peer)} size={32} />
              <span className="cf-member__name">{peerLabel(peer)}</span>
              {isOwner && (
                <button type="button" className="rw-btn rw-btn--sm rw-btn--danger" disabled={busy} onClick={() => void act(() => chatClient.removeGroupMember(conversation.id, p.id))}>
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner ? (
        <form
          className="cf-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!handle.trim()) return;
            void act(async () => {
              await chatClient.addGroupMember(conversation.id, handle);
              setHandle('');
            });
          }}
        >
          <input className="rw-field" placeholder="Add someone: email or @username" aria-label="Add a member" value={handle} disabled={busy} onChange={(e) => setHandle(e.target.value)} />
          <button type="submit" className="rw-btn rw-btn--primary" disabled={busy || !handle.trim()}>
            <Icon name="userPlus" size={16} />
            Add
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="rw-btn rw-btn--danger cf-self-start"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await chatClient.leaveGroup(conversation.id);
              onClose();
            })
          }
        >
          <Icon name="logOut" size={16} />
          Leave group
        </button>
      )}

      <ErrorText>{error}</ErrorText>
      <p className="cf-fineprint">
        Adding or removing someone re-keys the group. A removed member cannot read anything sent afterwards, but they keep
        whatever they already received — that is how forward secrecy works, not a gap.
      </p>
    </Sheet>
  );
}
