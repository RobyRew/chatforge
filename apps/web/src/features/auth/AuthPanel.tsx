import type { ReactNode } from 'react';
import { ACCOUNT_URL, signIn, signOut, useSession } from '../../lib/authClient';
import { Loading } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../chat/Avatar';

export function AuthPanel(): ReactNode {
  const { data, isPending } = useSession();

  if (isPending) return <Loading />;

  if (data) {
    const label = data.user.name?.trim() || data.user.email;
    return (
      <section className="rw-card cf-auth">
        <div className="cf-auth__who">
          <Avatar label={label} size={52} />
          <div>
            <p className="cf-auth__name">{label}</p>
            <p className="cf-auth__email">Signed in as {data.user.email}</p>
          </div>
        </div>
        <div className="cf-actions-row">
          <a className="rw-btn" href={ACCOUNT_URL} target="_blank" rel="noreferrer">
            <Icon name="key" size={16} />
            Manage account
            <Icon name="external" size={14} />
          </a>
          <button type="button" className="rw-btn rw-btn--danger" onClick={() => signOut()}>
            <Icon name="logOut" size={16} />
            Sign out
          </button>
        </div>
        <p className="cf-fineprint">Password, passkeys, social logins and 2FA are managed in your account.</p>
      </section>
    );
  }

  return (
    <section className="rw-card cf-auth">
      <div className="cf-auth__who">
        <span className="cf-brand__mark cf-brand__mark--lg" aria-hidden="true">
          <Icon name="message" size={24} />
        </span>
        <div>
          <p className="cf-auth__name">Sign in to ChatForge</p>
          <p className="cf-auth__email">One account for the converter’s Vault and encrypted chat.</p>
        </div>
      </div>
      <button type="button" className="rw-btn rw-btn--primary rw-btn--lg rw-btn--block" onClick={() => signIn()}>
        Sign in or create an account
      </button>
      <p className="cf-fineprint">You’ll be taken to our secure sign-in — email, social logins, passkeys and 2FA are all supported.</p>
    </section>
  );
}
