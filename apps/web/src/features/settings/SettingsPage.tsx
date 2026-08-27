import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMe } from '../../lib/useMe';
import { SETTINGS_SECTIONS } from './registry';

/**
 * Settings hub. Sections come from the registry, so adding one is a single entry there — the nav,
 * the heading and the routing all follow. On a narrow screen the nav collapses to a scrollable row.
 */
export function SettingsPage(): ReactNode {
  const { me, loading, refresh } = useMe();
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0]!.id);

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!me) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-300">
        Please{' '}
        <Link to="/account" className="text-sky-400">
          sign in
        </Link>{' '}
        to manage your settings.
      </div>
    );
  }

  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId) ?? SETTINGS_SECTIONS[0]!;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:w-48 md:shrink-0 md:flex-col md:overflow-visible">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              aria-current={s.id === active.id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition md:w-full ${
                s.id === active.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              <span aria-hidden>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <p className="text-xs text-zinc-500">{active.description}</p>
          {active.Cards.map((Card, i) => (
            <Card key={i} me={me} onSaved={refresh} />
          ))}
        </div>
      </div>
    </div>
  );
}
