import { useMemo } from 'react';
import { dateBounds, participantMessageCounts, type Edits } from '@chatforge/core/transforms';
import { conversationKinds, type Conversation } from '@chatforge/types';

function toDateInput(ts: number | undefined): string {
  if (ts === undefined) return '';
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function fromDateInput(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return endOfDay ? Date.UTC(y, m - 1, d, 23, 59, 59, 999) : Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

const field = 'rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100';

interface Props {
  imported: Conversation;
  edits: Edits;
  onTitle: (t: string) => void;
  onKind: (k: Conversation['kind']) => void;
  onRename: (id: string, name: string) => void;
  onDateRange: (from: number | undefined, to: number | undefined) => void;
  onReset: () => void;
}

export function DetailsEditor({ imported, edits, onTitle, onKind, onRename, onDateRange, onReset }: Props) {
  const counts = useMemo(() => participantMessageCounts(imported), [imported]);
  const bounds = useMemo(() => dateBounds(imported), [imported]);
  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Details</h3>
        <button
          onClick={onReset}
          disabled={!hasEdits}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
        >
          Reset
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Title</span>
        <input
          className={field}
          value={edits.title ?? imported.title ?? ''}
          placeholder="Conversation title"
          onChange={(e) => onTitle(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Type</span>
        <select className={field} value={edits.kind ?? imported.kind} onChange={(e) => onKind(e.target.value as Conversation['kind'])}>
          {conversationKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-zinc-400">Participants</span>
        {imported.participants.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <input
              className={`${field} flex-1`}
              value={edits.renames?.[p.id] ?? ''}
              placeholder={p.displayName ?? p.id}
              onChange={(e) => onRename(p.id, e.target.value)}
            />
            <span className="w-14 shrink-0 text-right text-[11px] text-zinc-500">{counts[p.id] ?? 0} msg</span>
          </div>
        ))}
      </div>

      {bounds && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-zinc-400">Date range</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className={`${field} flex-1`}
              min={toDateInput(bounds.min)}
              max={toDateInput(bounds.max)}
              value={toDateInput(edits.dateFrom)}
              onChange={(e) => onDateRange(fromDateInput(e.target.value, false), edits.dateTo)}
            />
            <span className="text-xs text-zinc-500">to</span>
            <input
              type="date"
              className={`${field} flex-1`}
              min={toDateInput(bounds.min)}
              max={toDateInput(bounds.max)}
              value={toDateInput(edits.dateTo)}
              onChange={(e) => onDateRange(edits.dateFrom, fromDateInput(e.target.value, true))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
