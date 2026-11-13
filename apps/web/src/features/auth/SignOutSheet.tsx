import { useState, type ReactNode } from 'react';
import { signOut } from '../../lib/authClient';
import { chatClient } from '../../lib/chatClient';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';

/**
 * Sign out, optionally deleting this account's chat data from this browser (ADR-0034). Off by default:
 * the MLS group state lives only on this device, so deleting it leaves the account's existing chats
 * unreadable here — what a shared computer needs, and not what someone's own laptop needs.
 */
export function SignOutSheet({ userId, onClose }: { userId: string; onClose: () => void }): ReactNode {
  const [forget, setForget] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async (): Promise<void> => {
    setBusy(true);
    if (forget) await chatClient.forgetDevice(userId).catch(() => false);
    signOut();
  };

  return (
    <Sheet label="Sign out" title="Sign out" width={440} onClose={() => !busy && onClose()}>
      <p className="cf-sheet__lead">
        Your chats&rsquo; encryption keys and message history are kept in this browser, so they&rsquo;re here when you sign back in.
      </p>
      <label className="cf-check">
        <input type="checkbox" checked={forget} disabled={busy} onChange={(e) => setForget(e.target.checked)} />
        <strong>Also remove my chats from this browser</strong>
        <small>
          For a shared computer. Your current chats can&rsquo;t be read in this browser afterwards, and messages that haven&rsquo;t been sent
          yet are dropped. Your unused encryption keys are withdrawn from the server; Chat publishes new ones the next time it opens.
          Your Vault is not changed. Close other ChatForge tabs first.
        </small>
      </label>
      <div className="cf-actions-row">
        <button type="button" className="rw-btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="rw-btn rw-btn--danger" disabled={busy} onClick={() => void go()} data-autofocus>
          <Icon name="logOut" size={16} />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </Sheet>
  );
}
