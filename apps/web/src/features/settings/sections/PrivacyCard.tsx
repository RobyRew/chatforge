import type { ReactNode } from 'react';

const ROWS: Array<{ what: string; how: string; e2e: boolean }> = [
  { what: 'Messages, replies, reactions', how: 'Encrypted end-to-end', e2e: true },
  { what: 'File attachments', how: 'Encrypted end-to-end', e2e: true },
  { what: 'Saved (vault) conversations', how: 'Encrypted end-to-end', e2e: true },
  { what: 'Profile picture, name, bio, status', how: 'Visible to the server', e2e: false },
  { what: 'Who you talk to, and when', how: 'Visible to the server', e2e: false },
];

/** Explains the guarantees — and the limits — in plain language, where people will look for them. */
export function PrivacyCard(): ReactNode {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">Privacy &amp; encryption</h3>
        <p className="text-xs text-zinc-500">What this server can and cannot see.</p>
      </div>

      <dl className="grid gap-2 text-xs sm:grid-cols-[1fr_auto]">
        {ROWS.map(({ what, how, e2e }) => (
          <div key={what} className="flex items-center justify-between gap-3 border-b border-zinc-800/70 pb-1.5 sm:col-span-2">
            <dt className="text-zinc-300">{what}</dt>
            <dd className={e2e ? 'shrink-0 text-emerald-400' : 'shrink-0 text-amber-400'}>{how}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        End-to-end encrypted means the key never leaves your devices — the server stores data it cannot read.
        <strong className="text-zinc-400"> Metadata is not protected:</strong> the server can still see who you
        message and when.
      </p>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        To be sure nobody is intercepting a chat, open it and use <strong className="text-zinc-400">verify keys</strong> in
        the header to compare safety numbers with the other person. Verification is stored only on this device.
      </p>
    </section>
  );
}
