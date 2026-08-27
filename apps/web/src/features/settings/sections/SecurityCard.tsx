import type { ReactNode } from 'react';
import { ui } from '../../admin/ui';

export function SecurityCard(): ReactNode {
  // Password, passkeys, social logins and 2FA are all owned by Logto's hosted account UI.
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Security</h3>
      <p className="text-xs text-zinc-500">
        Your password, passkeys, connected social logins and two-factor authentication are managed in your account.
      </p>
      <a className={`${ui.btn} ${ui.primary} self-start`} href="https://auth.robyrew.com" target="_blank" rel="noreferrer">
        Manage account security
      </a>
    </section>
  );
}
