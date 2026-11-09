import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type VaultItem } from '../../lib/api';
import { signIn } from '../../lib/authClient';
import { useContacts } from '../../lib/contacts';
import { useMe } from '../../lib/useMe';
import { Banner, IconButton, Loading, Notice, Segmented } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ContactsSection } from './ContactsSection';
import { ConversationList } from './ConversationList';
import { NewChat } from './NewChat';
import { Thread } from './Thread';
import { useChat } from './useChat';
import { VaultSection } from './VaultSection';
import { VaultView } from './VaultView';

type Tab = 'chats' | 'contacts' | 'vault';

export function ChatPage(): ReactNode {
  const { me, loading } = useMe();

  if (loading) {
    return (
      <div className="cf-page">
        <Loading />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="cf-page cf-page--narrow">
        <Notice
          icon="message"
          title="End-to-end encrypted chat"
          actions={
            <button type="button" className="rw-btn rw-btn--primary rw-btn--lg" onClick={() => signIn()}>
              Sign in or create an account
            </button>
          }
        >
          Messages, files and group chats are encrypted on your device with MLS before they reach the server, which
          only ever stores ciphertext.
        </Notice>
      </div>
    );
  }
  return <ChatApp me={me} />;
}

/**
 * The chat app frame, laid out like chat-converter's: a list pane (Chats · Contacts · Vault) beside the open
 * conversation. Container queries on `.cf-chat-host` decide the layout from the frame's own width: below 760 px
 * one pane at a time (`data-focus`), with a back button in the conversation.
 */
function ChatApp({ me }: { me: Me }): ReactNode {
  const state = useChat(me);
  const { contacts } = useContacts();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chats');
  const [focus, setFocus] = useState<'list' | 'thread'>('list');
  const [creating, setCreating] = useState(false);
  const [vaultItems, setVaultItems] = useState<VaultItem[] | null>(null);
  const active = state.conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    void api.vault
      .list()
      .then(setVaultItems)
      .catch(() => setVaultItems([]));
  }, []);

  useEffect(() => {
    if (!activeId && !activeVaultId && state.conversations[0]) setActiveId(state.conversations[0].id);
  }, [state.conversations, activeId, activeVaultId]);

  const openConversation = (id: string): void => {
    setActiveVaultId(null);
    setActiveId(id);
    setTab('chats');
    setFocus('thread');
  };
  const openVault = (id: string): void => {
    setActiveId(null);
    setActiveVaultId(id);
    setFocus('thread');
  };
  const back = (): void => setFocus('list');

  return (
    <div className="cf-chat-host">
      <div className="cf-chat" data-focus={focus}>
        <aside className="cf-pane cf-pane--list" aria-label="Conversations">
          <header className="cf-pane__head">
            <div className="cf-pane__titles">
              <h1 className="cf-pane__title">Chat</h1>
              <p className="cf-pane__sub">
                <span className={`cf-live${state.ready && !state.error ? ' is-on' : ''}`} aria-hidden="true" />
                {state.ready ? 'End-to-end encrypted' : 'Connecting…'}
              </p>
            </div>
            <IconButton icon="pencil" label="New conversation" onClick={() => setCreating(true)} />
          </header>
          <div className="cf-pane__tabs">
            <Segmented<Tab>
              role="tab"
              label="Lists"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'chats', label: 'Chats', count: state.conversations.length },
                { value: 'contacts', label: 'Contacts', count: contacts.length },
                { value: 'vault', label: 'Vault', count: vaultItems?.length },
              ]}
            />
          </div>
          {state.error && (
            <div className="cf-pane__note">
              <Banner tone="error">{state.error}</Banner>
            </div>
          )}
          <div className="cf-pane__scroll">
            {tab === 'chats' && <ConversationList state={state} activeId={activeId} onSelect={openConversation} onNew={() => setCreating(true)} />}
            {tab === 'contacts' && <ContactsSection state={state} onOpen={openConversation} />}
            {tab === 'vault' && <VaultSection items={vaultItems} activeId={activeVaultId} onOpen={openVault} />}
          </div>
        </aside>

        <section className="cf-pane cf-pane--thread" aria-label="Conversation">
          {activeVaultId ? (
            <VaultView id={activeVaultId} conversations={state.conversations} onChanged={() => undefined} onBack={back} />
          ) : active ? (
            <Thread conversation={active} state={state} myId={me.id} onBack={back} />
          ) : (
            <div className="cf-empty">
              <span className="cf-tile cf-tile--lg" aria-hidden="true">
                <Icon name="message" size={22} />
              </span>
              <p className="cf-empty__title">No conversation open</p>
              <p className="cf-empty__text">Choose one from the list, or start a new one.</p>
              <button type="button" className="rw-btn rw-btn--primary" onClick={() => setCreating(true)}>
                <Icon name="pencil" size={16} />
                New conversation
              </button>
            </div>
          )}
        </section>
      </div>

      {creating && (
        <NewChat
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            openConversation(id);
          }}
        />
      )}
    </div>
  );
}
