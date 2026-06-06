import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMe } from '../../lib/useMe';
import { ui } from '../admin/ui';

export function DashboardPage(): ReactNode {
  const { me, loading } = useMe();

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!me)
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-300">
        Please{' '}
        <Link to="/account" className="text-sky-400">
          sign in
        </Link>{' '}
        to view your dashboard.
      </div>
    );

  const isAdmin = ['users:read', 'roles:manage', 'flags:write', 'audit:read'].some((p) => me.permissions.includes(p));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-zinc-400">
          {me.email} · role <span className="font-mono text-zinc-300">{me.role}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">Your access</h3>
          <div className="flex flex-wrap gap-1.5">
            {me.permissions.length ? (
              me.permissions.map((p) => (
                <span key={p} className={ui.pill}>
                  {p}
                </span>
              ))
            ) : (
              <span className="text-sm text-zinc-500">No permissions.</span>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">Go to</h3>
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/" className="text-sky-400 hover:text-sky-300">
              → Converter
            </Link>
            <Link to="/chat" className="text-sky-400 hover:text-sky-300">
              → Chat
            </Link>
            <Link to="/account" className="text-sky-400 hover:text-sky-300">
              → Account
            </Link>
            <a href="https://auth.robyrew.com" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
              → Manage account security
            </a>
            {isAdmin && (
              <Link to="/admin" className="font-medium text-amber-300 hover:text-amber-200">
                → Admin console
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
