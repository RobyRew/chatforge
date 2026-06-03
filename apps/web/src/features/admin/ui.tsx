import { useState, type ReactNode } from 'react';

export const ui = {
  field: 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500',
  btn: 'rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
  primary: 'bg-sky-600 text-white hover:bg-sky-500',
  ghost: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
  danger: 'bg-rose-700 text-white hover:bg-rose-600',
  pill: 'inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300',
};

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h3 className="text-sm font-semibold text-zinc-200">{title}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorText({ children }: { children?: ReactNode }): ReactNode {
  return children ? <p className="mt-2 text-sm text-rose-300">{children}</p> : null;
}

/** Async-action helper: tracks busy + error, runs `fn`, then an optional `onDone` (e.g. reload). */
export function useAction(): { busy: boolean; error?: string; run: (fn: () => Promise<unknown>, onDone?: () => void) => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<unknown>, onDone?: () => void): void => {
    setBusy(true);
    setError(undefined);
    void fn()
      .then(() => onDone?.())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}
