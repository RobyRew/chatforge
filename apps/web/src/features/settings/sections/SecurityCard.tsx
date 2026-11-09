import type { ReactNode } from 'react';
import { ACCOUNT_URL } from '../../../lib/authClient';
import { Icon } from '../../../ui/Icon';
import { Card } from '../../../ui/kit';

export function SecurityCard(): ReactNode {
  // Password, passkeys, social logins and 2FA are all owned by Logto's hosted account UI.
  return (
    <Card
      icon="key"
      title="Sign-in and security"
      description="Your password, passkeys, connected social logins and two-factor authentication are managed in your account."
      actions={
        <a className="rw-btn" href={ACCOUNT_URL} target="_blank" rel="noreferrer">
          Manage
          <Icon name="external" size={15} />
        </a>
      }
    />
  );
}
