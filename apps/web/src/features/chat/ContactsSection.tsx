import type { ContactDTO } from '@chatforge/types';
import { useState, type ReactNode } from 'react';
import type { ChatState } from '../../lib/chatClient';
import { chatClient } from '../../lib/chatClient';
import { contactsStore, handleFor, useContacts } from '../../lib/contacts';
import { peerLabel } from '../../lib/displayPref';
import { IconButton } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ErrorText } from '../../ui/kit';
import { Avatar, PresenceDot, presenceKind } from './Avatar';

/**
 * The saved contacts tab. Saving is one-sided — the other person is not told — and the nickname is only ever
 * shown to you.
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
    <div className="cf-tabpane">
      <div className="cf-tabpane__head">
        <p className="cf-tabpane__hint">Only you see this list and the names you give people.</p>
        <button
          type="button"
          className="rw-btn rw-btn--sm"
          onClick={() => {
            setAdding((v) => !v);
            setError(undefined);
          }}
          aria-expanded={adding}
        >
          <Icon name={adding ? 'x' : 'userPlus'} size={14} />
          {adding ? 'Cancel' : 'Add'}
        </button>
      </div>

      {adding && (
        <form
          className="cf-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (handle.trim()) void add();
          }}
        >
          <input className="rw-field" type="text" placeholder="email or @username" aria-label="Contact to add" value={handle} disabled={busy} autoFocus onChange={(e) => setHandle(e.target.value)} />
          <button type="submit" className="rw-btn rw-btn--primary" disabled={busy || !handle.trim()}>
            Save
          </button>
        </form>
      )}

      {loaded && !contacts.length && !adding && <p className="cf-list-empty">No contacts yet. Save someone with the star in a chat, or Add them here.</p>}

      <ul className="cf-rows">
        {contacts.map((c) => {
          const label = c.nickname || peerLabel(c);
          return (
            <li key={c.id}>
              {renaming === c.id ? (
                <form
                  className="cf-inline-form cf-inline-form--row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename(c);
                  }}
                >
                  <input
                    className="rw-field"
                    type="text"
                    placeholder={peerLabel(c)}
                    aria-label={`Name for ${peerLabel(c)}`}
                    value={nickname}
                    maxLength={64}
                    disabled={busy}
                    autoFocus
                    onChange={(e) => setNickname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                  <button type="submit" className="rw-btn rw-btn--sm" disabled={busy}>
                    Save
                  </button>
                </form>
              ) : (
                <div className="cf-row cf-row--split">
                  <button type="button" className="cf-row__hit" disabled={busy} onClick={() => void open(c)} title="Open chat">
                    <span className="cf-row__avatar">
                      <Avatar image={c.image} label={label} size={40} />
                      <PresenceDot kind={presenceKind(state.presence[c.id])} />
                    </span>
                    <span className="cf-row__main">
                      <span className="cf-row__top">
                        <span className="cf-row__title">{label}</span>
                      </span>
                      <span className="cf-row__sub">{c.nickname ? peerLabel(c) : c.statusText || 'Saved contact'}</span>
                    </span>
                  </button>
                  <span className="cf-row__tools">
                    <IconButton
                      icon="pencil"
                      label={`Rename ${label}`}
                      onClick={() => {
                        setNickname(c.nickname ?? '');
                        setRenaming(c.id);
                      }}
                    />
                    <IconButton icon="trash" label={`Remove ${label}`} onClick={() => void remove(c)} />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText>{error ?? loadError}</ErrorText>
    </div>
  );
}
