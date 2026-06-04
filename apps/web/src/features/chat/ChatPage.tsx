import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { AuthPanel } from '../auth/AuthPanel';
import { ConversationList } from './ConversationList';
import { NewChat } from './NewChat';
import { Thread } from './Thread';
import { useChat } from './useChat';
import { VaultSection } from './VaultSection';
import { VaultView } from './VaultView';

export function ChatPage(): ReactNode {
  const { me, loading } = useMe();

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!me) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold">Chat</h1>
        <p className="text-sm text-zinc-400">Sign in to start an end-to-end encrypted conversation.</p>
        <AuthPanel />
      </div>
    );
  }
  return <ChatApp me={me} />;
}

function ChatApp({ me }: { me: Me }): ReactNode {
  const state = useChat(me);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const active = state.conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && !activeVaultId && state.conversations[0]) setActiveId(state.conversations[0].id);
  }, [state.conversations, activeId, activeVaultId]);

  const openConversation = (id: string): void => {
    setActiveVaultId(null);
    setActiveId(id);
  };
  const openVault = (id: string): void => {
    setActiveId(null);
    setActiveVaultId(id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Chat</h1>
        {!state.ready && <span className="text-xs text-zinc-500">connecting…</span>}
      </div>
      {state.error && <p className="rounded-lg border border-rose-800/60 bg-rose-950/30 p-2 text-xs text-rose-300">{state.error}</p>}
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-3">
          <NewChat onCreated={openConversation} />
          <ConversationList state={state} activeId={activeId} onSelect={openConversation} />
          <VaultSection activeId={activeVaultId} onOpen={openVault} />
        </aside>
        <section>
          {activeVaultId ? (
            <VaultView id={activeVaultId} conversations={state.conversations} onChanged={() => undefined} />
          ) : active ? (
            <Thread conversation={active} state={state} myId={me.id} />
          ) : (
            <div className="grid h-[72vh] place-items-center rounded-xl border border-zinc-800 bg-zinc-900/40 text-sm text-zinc-500">
              Select or start a conversation.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
