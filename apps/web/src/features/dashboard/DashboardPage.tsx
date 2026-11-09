import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ACCOUNT_URL, signIn } from '../../lib/authClient';
import { useMe } from '../../lib/useMe';
import { Loading, Notice, PageHead } from '../../ui/controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Card, ui } from '../../ui/kit';

function Tile({ icon, title, text, tone }: { icon: IconName; title: string; text: string; tone?: 'accent' | 'warn' }): ReactNode {
  return (
    <>
      <span className={`cf-tile cf-tile--md${tone ? ` cf-tile--${tone}` : ''}`} aria-hidden="true">
        <Icon name={icon} size={19} />
      </span>
      <span className="cf-goto__text">
        <span className="cf-goto__title">{title}</span>
        <span className="cf-goto__desc">{text}</span>
      </span>
      <Icon name="chevronRight" size={18} className="cf-goto__chev" />
    </>
  );
}

export function DashboardPage(): ReactNode {
  const { me, loading } = useMe();

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
          icon="grid"
          title="Sign in to see your dashboard"
          actions={
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => signIn()}>
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  const isAdmin = ['users:read', 'roles:manage', 'flags:write', 'audit:read'].some((p) => me.permissions.includes(p));

  return (
    <div className="cf-page">
      <PageHead
        eyebrow="Dashboard"
        icon="grid"
        title={me.name ? `Hello, ${me.name}` : 'Dashboard'}
        lead={
          <>
            {me.email} · role <code className="cf-code">{me.role}</code>
          </>
        }
      />

      <div className="cf-goto">
        <Link to="/" className="rw-card rw-card--interactive cf-goto__card">
          <Tile icon="swap" title="Converter" text="Open an export, edit it and convert it on this device." tone="accent" />
        </Link>
        <Link to="/chat" className="rw-card rw-card--interactive cf-goto__card">
          <Tile icon="message" title="Chat" text="End-to-end encrypted conversations and your Vault." tone="accent" />
        </Link>
        <Link to="/settings" className="rw-card rw-card--interactive cf-goto__card">
          <Tile icon="sliders" title="Settings" text="Profile, notifications, privacy and integrations." />
        </Link>
        <a href={ACCOUNT_URL} target="_blank" rel="noreferrer" className="rw-card rw-card--interactive cf-goto__card">
          <Tile icon="key" title="Account security" text="Password, passkeys, social logins and 2FA." />
        </a>
        {isAdmin && (
          <Link to="/admin" className="rw-card rw-card--interactive cf-goto__card">
            <Tile icon="shield" title="Admin console" text="Users, roles, feature flags and the audit log." tone="warn" />
          </Link>
        )}
      </div>

      <Card icon="key" title="Your access" description="Permissions the server grants this account.">
        <div className="cf-perms">
          {me.permissions.length ? (
            me.permissions.map((p) => (
              <span key={p} className={ui.pill}>
                {p}
              </span>
            ))
          ) : (
            <span className="cf-muted">No permissions.</span>
          )}
        </div>
      </Card>
    </div>
  );
}
