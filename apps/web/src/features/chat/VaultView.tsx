import type { Conversation, ConversationSummary } from '@chatforge/types';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { openVaultConversation } from '../../lib/vault';
import { RichText } from '../converter/RichText';

/** Read-only view of a decrypted saved chat, with the ability to link it to a live DM. */
export function VaultView({ id, conversations, onChanged }: { id: string; conversations: ConversationSummary[]; onChanged: () => void }): ReactNode {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<string>();
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConv(null);
    setError(undefined);
    void (async () => {
      try {
        const [decrypted, item] = await Promise.all([openVaultConversation(id), api.vault.get(id)]);
        setConv(decrypted);
        setLinkedId(item.linkedConversationId);
      } catch {
        setError('Could not open this saved chat — it may have been saved on a different device (cross-device unlock comes with the passphrase option).');
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
    <div className="flex h-[72vh] flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">📁 {conv?.title ?? 'Saved chat'}</p>
          <p className="text-xs text-zinc-500">{conv ? `${conv.messages.length} messages · from ${conv.originPlatform} · read-only` : 'Vault · read-only'}</p>
        </div>
        <div className="ml-auto">
          <select
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
            value={linkedId ?? ''}
            disabled={busy}
            onChange={(e) => void link(e.target.value || null)}
          >
            <option value="">Not linked</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                Linked → {c.peers[0]?.email ?? c.id}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!conv && !error && <p className="text-sm text-zinc-500">Decrypting…</p>}
        {conv?.messages.map((m) => (
          <div key={m.id} className="text-sm">
            <span className="text-xs font-medium text-sky-300">{nameFor(m.senderId)}</span>{' '}
            <span className="text-[10px] text-zinc-600">{new Date(m.ts).toLocaleString()}</span>
            <p className="whitespace-pre-wrap break-words text-zinc-200">
              <RichText value={m.content} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
