import type { ReactNode } from 'react';
import { PageHead } from '../../ui/controls';
import { AuthPanel } from './AuthPanel';

export function AccountPage(): ReactNode {
  return (
    <div className="cf-page cf-page--narrow">
      <PageHead eyebrow="Account" icon="contact" title="Your ChatForge account" lead="Sign in to save conversions to your Vault and use end-to-end encrypted chat." />
      <AuthPanel />
    </div>
  );
}
