import { useEffect, useState, type ReactNode } from 'react';
import { api, type Integrations } from '../../../lib/api';
import { Banner } from '../../../ui/controls';
import { Icon } from '../../../ui/Icon';
import { Card } from '../../../ui/kit';

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
    <>
      {outcome && <Banner tone={outcome.tone}>{outcome.message}</Banner>}
      <Card title="Connected services" description="Let an app you use set your chat status automatically." flush>
        <div className="cf-service">
          <span className="cf-tile cf-tile--spotify" aria-hidden="true">
            <Icon name="music" size={18} />
          </span>
          <div className="cf-service__text">
            <p className="cf-service__name">Spotify</p>
            <p className="cf-service__desc">
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
              <button type="button" className="rw-btn" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            ) : (
              // A top-level navigation, not a fetch — the OAuth redirect has to leave the SPA.
              <a className="rw-btn rw-btn--primary" href="/api/integrations/spotify/connect">
                Connect
              </a>
            ))}
        </div>
        <div className="cf-card__foot">
          <p>
            Read-only: ChatForge asks Spotify only for the track currently playing — it cannot control playback or see your library. The connection lives on the server
            and is never exposed to your browser. Status updates only while you have ChatForge open, and a status you type yourself is never overwritten.
          </p>
        </div>
      </Card>
    </>
  );
}
