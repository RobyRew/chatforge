import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMe } from '../../lib/useMe';
import { ADMIN_SECTIONS } from './registry';
import { ui } from './ui';

function Notice({ children }: { children: ReactNode }): ReactNode {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-300">{children}</div>;
}

export function AdminPage(): ReactNode {
  const { me, loading } = useMe();
  const [active, setActive] = useState(0);

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!me)
    return (
      <Notice>
        Please{' '}
        <Link to="/account" className="text-sky-400">
          sign in
        </Link>{' '}
        to access the admin console.
      </Notice>
    );

  const sections = ADMIN_SECTIONS.filter((s) => me.permissions.includes(s.permission));
  if (!sections.length) return <Notice>Your account doesn’t have access to the admin console.</Notice>;

  const current = sections[Math.min(active, sections.length - 1)]!;
  const Active = current.Component;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Admin console</h1>
        <p className="text-sm text-zinc-400">
          {me.email} · role <span className="font-mono text-zinc-300">{me.role}</span>
        </p>
      </div>
      <nav className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
        {sections.map((s, i) => (
          <button key={s.id} onClick={() => setActive(i)} className={`${ui.btn} ${current.id === s.id ? ui.primary : ui.ghost}`}>
            {s.label}
          </button>
        ))}
      </nav>
      <Active me={me} />
    </div>
  );
}
