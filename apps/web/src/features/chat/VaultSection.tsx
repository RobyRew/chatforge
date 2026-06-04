import { useEffect, useState, type ReactNode } from 'react';
import { api, type VaultItem } from '../../lib/api';

/** Sidebar list of the user's saved (imported) chats in the Vault. */
export function VaultSection({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }): ReactNode {
  const [items, setItems] = useState<VaultItem[]>([]);

  useEffect(() => {
    void api.vault
      .list()
      .then(setItems)
      .catch(() => {});
  }, []);

  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Vault</p>
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.id}>
            <button
              onClick={() => onOpen(it.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${activeId === it.id ? 'bg-amber-600/20 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
            >
              <span>📁</span>
              <span className="truncate">{it.label || 'Saved chat'}</span>
              <span className="ml-auto text-[10px] text-zinc-500">{it.messageCount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
