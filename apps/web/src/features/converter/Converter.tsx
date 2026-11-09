import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { defineChatConverter, type ChatConverterElement } from '@robyrew/chat-converter/ui';
import '@robyrew/chat-converter/ui/styles.css';
import { Icon } from '../../ui/Icon';
import { SaveToVault } from './SaveToVault';

defineChatConverter();

/** Events after which the element's current conversation may have changed. */
const CONVERSATION_EVENTS = ['cc-imported', 'cc-opened', 'cc-change'] as const;

/**
 * The converter is the shared `<chat-converter-app>` element from @robyrew/chat-converter (ADR-0031), the
 * same one chat-converter.robyrew.com serves: drop a folder, zip or files, browse multi-conversation
 * exports, edit, preview and convert in a Web Worker. ChatForge adds one action to its export pane,
 * Save to Vault.
 *
 * The page follows chat-converter's site: a hero over the element's start screen, and once an export is open
 * (`data-view` other than `start`) the hero goes and the element's frame fills the screen under the header.
 * The element reads the house colour tokens the page defines, so it matches the rest of ChatForge.
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
    node.className = 'cf-vault-slot';
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
    <div className="cf-convert">
      <section className="cf-hero">
        <p className="cf-hero__eyebrow">
          <Icon name="lock" size={14} /> Private · runs in your browser
        </p>
        <h1>
          Move your chats <span className="cf-hero__grad">between apps</span>
        </h1>
        <p className="cf-hero__lead">
          Open a Telegram, WhatsApp, Instagram, Facebook, Snapchat, VSCO or Hinge export, edit it, and convert it on
          this device. Signed in, you can keep an end-to-end encrypted copy in your Vault.
        </p>
      </section>
      <div ref={mount} className="cf-app-host" />
      {createPortal(<SaveToVault getConversation={() => app.current?.getConversation()} revision={revision} />, actions)}
    </div>
  );
}
