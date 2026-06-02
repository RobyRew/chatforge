import type { FidelityReport, FidelityStatus } from '@chatforge/types';

const BADGE: Record<FidelityStatus, string> = {
  preserved: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  approximated: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  dropped: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  'not-present': 'bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30',
};

export function ReportView({ report }: { report: FidelityReport }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Fidelity report</h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        {report.stats.messages} messages · {report.stats.participants} participants ·{' '}
        {report.stats.attachments} attachments
      </p>
      {report.entries.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-300">Nothing lost — everything maps cleanly to this format.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {report.entries.map((e) => (
            <li key={e.capability} className={`rounded-full px-2.5 py-1 text-xs ${BADGE[e.status]}`}>
              {e.capability}: {e.status}
              {e.count ? ` (${e.count})` : ''}
            </li>
          ))}
        </ul>
      )}
      {report.warnings.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-xs text-amber-300/80">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
