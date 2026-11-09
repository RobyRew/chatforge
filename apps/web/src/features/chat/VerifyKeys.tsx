import { useEffect, useState, type ReactNode } from 'react';
import { formatSafetyNumber } from '@chatforge/crypto/safety-number';
import { confirmVerification, loadVerification, type VerificationState } from '../../lib/keyVerification';
import { Banner, Loading } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';

/**
 * Safety-number panel. The number is derived from both parties' MLS signature keys, so comparing it
 * out-of-band proves nobody is sitting in the middle — including the server that relayed the keys.
 */
export function VerifyKeys({ conversationId, peerId, peerLabel, onClose }: { conversationId: string; peerId: string; peerLabel: string; onClose: () => void }): ReactNode {
  const [state, setState] = useState<VerificationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadVerification(conversationId, peerId).then((s) => !cancelled && setState(s));
    return () => {
      cancelled = true;
    };
  }, [conversationId, peerId]);

  const confirm = async (): Promise<void> => {
    if (!state?.current) return;
    setBusy(true);
    await confirmVerification(conversationId, state.current);
    setState(await loadVerification(conversationId, peerId));
    setBusy(false);
  };

  return (
    <Sheet label="Verify encryption keys" title="Verify encryption keys" onClose={onClose}>
      {!state && <Loading label="Computing…" />}

      {state?.status === 'unavailable' && <Banner>No encryption keys for this chat on this device yet. Send or receive a message first, then try again.</Banner>}

      {state?.current && (
        <>
          {state.status === 'changed' && (
            <Banner tone="warn">
              <strong>This code has changed since you verified it.</strong> Usually {peerLabel} reinstalled the app or added a device, but it is
              also what an interception would look like. Compare the new code with them before trusting it again.
            </Banner>
          )}
          {state.status === 'verified' && (
            <Banner tone="ok">Verified{state.verifiedAt ? ` on ${new Date(state.verifiedAt).toLocaleDateString()}` : ''}. This code still matches.</Banner>
          )}

          <p className="cf-sheet__lead">
            Compare this code with {peerLabel} in person, on a call, or over another app you already trust. If you both see the same 60 digits,
            nobody is in the middle.
          </p>

          <pre className="cf-safety">{formatSafetyNumber(state.current)}</pre>

          <div className="cf-actions-row">
            <button type="button" className="rw-btn rw-btn--primary" disabled={busy || state.status === 'verified'} onClick={() => void confirm()}>
              <Icon name="shield" size={16} />
              {state.status === 'changed' ? 'They match — verify again' : 'They match — mark verified'}
            </button>
            <button
              type="button"
              className="rw-btn"
              onClick={() =>
                void navigator.clipboard?.writeText(formatSafetyNumber(state.current!)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                })
              }
            >
              <Icon name={copied ? 'check' : 'copy'} size={16} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <p className="cf-fineprint">
            Verification is stored only on this device — never on the server, since the server is exactly what this check is meant to catch.
          </p>
        </>
      )}
    </Sheet>
  );
}
