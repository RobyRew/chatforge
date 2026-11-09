import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { VaultItem } from '../../lib/api';
import { Loading } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

/** The Vault tab: chats saved from the converter, end-to-end encrypted. `items` is null while loading. */
export function VaultSection({ items, activeId, onOpen }: { items: VaultItem[] | null; activeId: string | null; onOpen: (id: string) => void }): ReactNode {
  if (!items) return <Loading />;
  if (!items.length) {
    return (
      <div className="cf-list-empty">
        <p>Nothing saved yet.</p>
        <p>
          Open an export on <Link to="/">Convert</Link> and choose Save to Vault; it is encrypted before it leaves your browser.
        </p>
      </div>
    );
  }
  return (
    <ul className="cf-rows">
      {items.map((it) => (
        <li key={it.id}>
          <button type="button" onClick={() => onOpen(it.id)} className={`cf-row${activeId === it.id ? ' is-active' : ''}`} aria-current={activeId === it.id ? 'true' : undefined}>
            <span className="cf-row__avatar">
              <span className="cf-tile cf-tile--vault" aria-hidden="true">
                <Icon name="lock" size={18} />
              </span>
            </span>
            <span className="cf-row__main">
              <span className="cf-row__top">
                <span className="cf-row__title">{it.label || 'Saved chat'}</span>
              </span>
              <span className="cf-row__sub">
                {it.messageCount} {it.messageCount === 1 ? 'message' : 'messages'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
