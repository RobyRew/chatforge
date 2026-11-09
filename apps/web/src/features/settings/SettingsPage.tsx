import { useState, type ReactNode } from 'react';
import { signIn } from '../../lib/authClient';
import { useMe } from '../../lib/useMe';
import { Loading, Notice, PageHead } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { SETTINGS_SECTIONS } from './registry';

/**
 * Settings hub. Sections come from the registry, so adding one is a single entry there — the nav,
 * the heading and the routing all follow. Wide screens list the sections beside the cards; narrow ones
 * show them as a scrolling row of pills.
 */
export function SettingsPage(): ReactNode {
  const { me, loading, refresh } = useMe();
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0]!.id);

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
          icon="sliders"
          title="Sign in to manage your settings"
          actions={
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => signIn()}>
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId) ?? SETTINGS_SECTIONS[0]!;

  return (
    <div className="cf-page">
      <PageHead eyebrow="Settings" icon="sliders" title={active.label} lead={active.description} />

      <div className="cf-settings">
        <nav aria-label="Settings sections" className="cf-settings__nav">
          {SETTINGS_SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setActiveId(s.id)} aria-current={s.id === active.id ? 'page' : undefined} className="cf-settings__link">
              <span className="cf-tile cf-tile--sm" aria-hidden="true">
                <Icon name={s.icon} size={15} />
              </span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="cf-settings__cards">
          {active.Cards.map((Card, i) => (
            <Card key={`${active.id}-${i}`} me={me} onSaved={refresh} />
          ))}
        </div>
      </div>
    </div>
  );
}
