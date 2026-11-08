import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { defineChatConverter, type ChatConverterElement } from '@robyrew/chat-converter/ui';
import '@robyrew/chat-converter/ui/styles.css';
import { SaveToVault } from './SaveToVault';

defineChatConverter();

/** Events after which the element's current conversation may have changed. */
const CONVERSATION_EVENTS = ['cc-imported', 'cc-opened', 'cc-change'] as const;

/**
 * The converter is the shared `<chat-converter-app>` element from @robyrew/chat-converter (ADR-0031), the
 * same one chat-converter.robyrew.com serves: drop a folder, zip or files, browse multi-conversation
 * exports, edit, preview and convert in a Web Worker. ChatForge adds one action to its convert panel,
 * Save to Vault.
 *
 * The element is created here rather than rendered as JSX: it moves `slot="actions"` children into its
 * own DOM when it connects, which React must not manage. The action container is a plain node React
 * renders into through a portal.
 */
export function Converter(): ReactNode {
  const mount = useRef<HTMLDivElement>(null);
  const app = useRef<ChatConverterElement | null>(null);
  const [actions] = useState(() => {
    const node = document.createElement('div');
    node.slot = 'actions';
    return node;
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const el = document.createElement('chat-converter-app') as ChatConverterElement;
    el.append(actions);
    const changed = (): void => setRevision((n) => n + 1);
    for (const name of CONVERSATION_EVENTS) el.addEventListener(name, changed);
    host.append(el);
    app.current = el;
    return () => {
      for (const name of CONVERSATION_EVENTS) el.removeEventListener(name, changed);
      el.remove();
      app.current = null;
    };
  }, [actions]);

  return (
    <>
      <div ref={mount} />
      {createPortal(<SaveToVault getConversation={() => app.current?.getConversation()} revision={revision} />, actions)}
    </>
  );
}
