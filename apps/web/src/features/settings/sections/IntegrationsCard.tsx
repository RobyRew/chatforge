import { useEffect, useState, type ReactNode } from 'react';
import { api, type Integrations } from '../../../lib/api';
import { ui } from '../../admin/ui';

/** Result of the OAuth round trip, passed back as ?spotify=… on the redirect to /settings. */
const OUTCOMES: Record<string, { tone: 'ok' | 'warn'; message: string }> = {
  connected: { tone: 'ok', message: 'Spotify connected — your status will follow what you play.' },
  denied: { tone: 'warn', message: 'You declined the Spotify permission, so nothing was connected.' },
  invalid: { tone: 'warn', message: 'That sign-in link expired or was invalid. Try connecting again.' },
  failed: { tone: 'warn', message: 'Spotify rejected the connection. Try again.' },
  unavailable: { tone: 'warn', message: 'The Spotify integration is not configured on this server.' },
};

export function IntegrationsCard(): ReactNode {
  const [state, setState] = useState<Integrations | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'ok' | 'warn'; message: string }>();

  useEffect(() => {
    const param = new URLSearchParams(location.search).get('spotify');
    if (param && OUTCOMES[param]) {
      setOutcome(OUTCOMES[param]);
      // Drop the query param so a refresh doesn't re-show the banner.
      history.replaceState(null, '', location.pathname);
    }
    void api.integrations().then(setState).catch(() => setState(null));
  }, []);

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.disconnectSpotify();
      setState(await api.integrations());
      setOutcome({ tone: 'ok', message: 'Spotify disconnected.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">Connected services</h3>
        <p className="text-xs text-zinc-500">Let an app you use set your chat status automatically.</p>
      </div>

      {outcome && (
        <p className={`rounded-lg border p-2 text-xs ${outcome.tone === 'ok' ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300' : 'border-amber-600/60 bg-amber-950/30 text-amber-200'}`}>
          {outcome.message}
        </p>
      )}

      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 p-3">
        <span className="text-2xl">🎵</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">Spotify</p>
          <p className="text-xs text-zinc-500">
            {state === null
              ? 'Checking…'
              : !state.spotify.available
                ? 'Not configured on this server.'
                : state.spotify.connected
                  ? 'Connected — your status shows what you’re listening to.'
                  : 'Show what you’re listening to as your status.'}
          </p>
        </div>
        {state?.spotify.available &&
          (state.spotify.connected ? (
            <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : (
            // A top-level navigation, not a fetch — the OAuth redirect has to leave the SPA.
            <a className={`${ui.btn} ${ui.primary}`} href="/api/integrations/spotify/connect">
              Connect
            </a>
          ))}
      </div>

      <p className="text-[11px] text-zinc-600">
        Read-only: ChatForge asks Spotify only for the track currently playing — it cannot control playback or see
        your library. The connection lives on the server and is never exposed to your browser. Status updates only
        while you have ChatForge open, and a status you type yourself is never overwritten.
      </p>
    </section>
  );
}
