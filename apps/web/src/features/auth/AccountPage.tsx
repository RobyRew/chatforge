import { AuthPanel } from './AuthPanel';

export function AccountPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">Account</h1>
      <p className="text-sm text-zinc-400">
        Sign in to save conversions and use end-to-end encrypted chat. Passkeys recommended.
      </p>
      <AuthPanel />
    </div>
  );
}
