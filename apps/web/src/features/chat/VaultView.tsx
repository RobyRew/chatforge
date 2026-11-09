import { Link } from '@tanstack/react-router';
import type { Conversation, ConversationSummary } from '@chatforge/types';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { envelopeMode, isVaultUnlocked, vaultDecrypt } from '../../lib/vaultCrypto';
import { Banner, Loading } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { hueOf } from './Avatar';
import { RichText } from './RichText';

/** Read-only view of a decrypted saved chat, with the ability to link it to a live DM. */
export function VaultView({ id, conversations, onChanged, onBack }: { id: string; conversations: ConversationSummary[]; onChanged: () => void; onBack: () => void }): ReactNode {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<string>();
  const [locked, setLocked] = useState(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConv(null);
    setError(undefined);
    setLocked(false);
    void (async () => {
      let ciphertext: string | undefined;
      try {
        const item = await api.vault.get(id);
        setLinkedId(item.linkedConversationId);
        ciphertext = item.ciphertext;
        setConv(await vaultDecrypt<Conversation>(item.ciphertext));
      } catch {
        if (ciphertext && envelopeMode(ciphertext) === 'passphrase' && !isVaultUnlocked()) setLocked(true);
        else if (ciphertext && envelopeMode(ciphertext) === 'passphrase') setError('Wrong vault passphrase, or this item is corrupted.');
        else setError('This was saved on a different device. Open it there, or set up a vault passphrase for cross-device access.');
      }
    })();
  }, [id]);

  const link = async (conversationId: string | null): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.vault.link(id, conversationId);
      setLinkedId(r.linkedConversationId);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const nameFor = (senderId?: string): string => conv?.participants.find((p) => p.id === senderId)?.displayName ?? 'Unknown';

  return (
    <div className="cf-thread">
      <header className="cf-topbar">
        <button type="button" className="cf-back" onClick={onBack} aria-label="Back to the list">
          <Icon name="chevronLeft" size={20} />
          <span>Vault</span>
        </button>
        <span className="cf-topbar__avatar">
          <span className="cf-tile cf-tile--vault cf-tile--md" aria-hidden="true">
            <Icon name="lock" size={18} />
          </span>
        </span>
        <div className="cf-topbar__titles">
          <p className="cf-topbar__title">{conv?.title ?? 'Saved chat'}</p>
          <p className="cf-topbar__sub">
            {conv ? (
              <>
                <span>{conv.messages.length} messages</span>
                <span>from {conv.originPlatform}</span>
                <span>read-only</span>
              </>
            ) : (
              <span>Vault · read-only</span>
            )}
          </p>
        </div>
        <div className="cf-topbar__actions">
          <label className="cf-linkpick">
            <Icon name="message" size={15} />
            <select className="rw-field" aria-label="Linked conversation" value={linkedId ?? ''} disabled={busy} onChange={(e) => void link(e.target.value || null)}>
              <option value="">Not linked</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  Linked → {c.peers[0]?.email ?? c.id}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="cf-thread__body">
        <div className="cf-thread__inner">
          {locked && (
            <Banner tone="warn" icon="lock">
              This chat is encrypted with your vault passphrase. <Link to="/settings">Unlock it in Settings</Link> to read it.
            </Banner>
          )}
          {error && <Banner tone="error">{error}</Banner>}
          {!conv && !error && !locked && <Loading label="Decrypting…" />}
          {conv?.messages.map((m, i) => {
            const who = nameFor(m.senderId);
            const prev = conv.messages[i - 1];
            const cont = !!prev && prev.senderId === m.senderId && m.ts - prev.ts < 5 * 60_000;
            return (
              <div key={m.id} className={`cf-msg cf-msg--in${cont ? ' is-cont' : ''}`}>
                <div className="cf-msg__line">
                  <div className="cf-bubble">
                    {!cont && (
                      <p className="cf-bubble__who" style={{ '--who-hue': hueOf(who) } as CSSProperties}>
                        {who}
                      </p>
                    )}
                    <p className="cf-bubble__text">
                      <RichText value={m.content} />
                    </p>
                    <span className="cf-bubble__time">{new Date(m.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
