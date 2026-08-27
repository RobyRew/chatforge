import { useEffect, useState, type ReactNode } from 'react';
import { formatSafetyNumber } from '@chatforge/crypto/safety-number';
import { confirmVerification, loadVerification, type VerificationState } from '../../lib/keyVerification';

/**
 * Safety-number panel. The number is derived from both parties' MLS signature keys, so comparing it
 * out-of-band proves nobody is sitting in the middle — including the server that relayed the keys.
 */
export function VerifyKeys({ conversationId, peerId, peerLabel, onClose }: { conversationId: string; peerId: string; peerLabel: string; onClose: () => void }): ReactNode {
  const [state, setState] = useState<VerificationState | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Verify encryption keys" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Verify encryption keys</h2>
          <button className="ml-auto text-zinc-500 hover:text-white" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!state && <p className="mt-4 text-xs text-zinc-500">Computing…</p>}

        {state?.status === 'unavailable' && (
          <p className="mt-4 text-xs text-zinc-400">
            No encryption keys for this chat on this device yet. Send or receive a message first, then try again.
          </p>
        )}

        {state?.current && (
          <>
            {state.status === 'changed' && (
              <div className="mt-4 rounded-lg border border-amber-600/60 bg-amber-950/40 p-3 text-xs text-amber-200">
                <p className="font-medium">⚠ This code has changed since you verified it.</p>
                <p className="mt-1 text-amber-200/80">
                  Usually this just means {peerLabel} reinstalled the app or added a device. But it is also what an
                  interception would look like. Compare the new code with them before trusting it again.
                </p>
              </div>
            )}
            {state.status === 'verified' && (
              <p className="mt-4 rounded-lg border border-emerald-700/60 bg-emerald-950/30 p-2 text-xs text-emerald-300">
                ✓ Verified{state.verifiedAt ? ` on ${new Date(state.verifiedAt).toLocaleDateString()}` : ''} — this code still matches.
              </p>
            )}

            <p className="mt-4 text-xs text-zinc-400">
              Compare this code with {peerLabel} in person, on a call, or over another app you already trust.
              If both of you see the same 60 digits, nobody is in the middle.
            </p>

            <pre className="mt-3 select-all whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 text-center font-mono text-sm leading-7 tracking-widest text-zinc-100">
              {formatSafetyNumber(state.current)}
            </pre>

            <div className="mt-4 flex items-center gap-2">
              <button
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
                disabled={busy || state.status === 'verified'}
                onClick={() => void confirm()}
              >
                {state.status === 'changed' ? 'They match — verify again' : 'They match — mark verified'}
              </button>
              <button className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500" onClick={() => void navigator.clipboard?.writeText(formatSafetyNumber(state.current!))}>
                Copy
              </button>
            </div>

            <p className="mt-3 text-[11px] text-zinc-600">
              Verification is stored only on this device — never on the server, since the server is exactly what
              this check is meant to catch.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
