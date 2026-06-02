import { useMemo } from 'react';
import { applyEdits } from '@chatforge/core/transforms';
import {
  exportFormatIds,
  FORMAT_META,
  PLATFORM_META,
  platformIds,
  type ExportFormatId,
} from '@chatforge/types';
import { downloadBytes } from '../../lib/download';
import { exportChat, importChat } from '../../lib/workerClient';
import { ChatPreview } from './ChatPreview';
import { DetailsEditor } from './DetailsEditor';
import { Dropzone } from './Dropzone';
import { ReportView } from './ReportView';
import { useConverter, type SourceChoice } from './store';

const field = 'rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100';

export function Converter() {
  const s = useConverter();
  const { imported, edits } = s;

  const effective = useMemo(() => (imported ? applyEdits(imported, edits) : undefined), [imported, edits]);

  const onImport = async (): Promise<void> => {
    if (!s.file) return;
    s.beginImport();
    try {
      const bytes = new Uint8Array(await s.file.arrayBuffer());
      const res = await importChat({ name: s.file.name, bytes }, s.source === 'auto' ? undefined : s.source);
      if (res.ok && res.action === 'import') s.importDone(res.conversation, res.detectedPlatform, res.warnings);
      else if (!res.ok) s.failWith(res.error);
    } catch (e) {
      s.failWith(e instanceof Error ? e.message : String(e));
    }
  };

  const onExport = async (): Promise<void> => {
    if (!effective) return;
    s.beginExport();
    try {
      const res = await exportChat(effective, s.target);
      if (res.ok && res.action === 'export') {
        s.exportDone(res.artifact, res.report);
        const primary = res.artifact.files[0];
        if (primary) downloadBytes(res.artifact.suggestedName || primary.name, primary.bytes, res.artifact.mime);
      } else if (!res.ok) {
        s.failWith(res.error);
      }
    } catch (e) {
      s.failWith(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Step 1: pick a file & source, import ----
  if (!imported) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <Dropzone file={s.file} onFile={s.setFile} />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">From</span>
          <select className={field} value={s.source} onChange={(e) => s.setSource(e.target.value as SourceChoice)}>
            <option value="auto">Auto-detect</option>
            {platformIds.map((p) => (
              <option key={p} value={p} disabled={!PLATFORM_META[p].importable}>
                {PLATFORM_META[p].label}
                {PLATFORM_META[p].importable ? '' : ' (soon)'}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void onImport()}
          disabled={!s.file || s.phase === 'importing'}
          className="rounded-xl bg-sky-500 px-4 py-2.5 font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {s.phase === 'importing' ? 'Reading…' : 'Import & edit'}
        </button>
        {s.phase === 'error' && s.error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{s.error}</div>
        )}
      </div>
    );
  }

  // ---- Step 2: edit details + preview, then convert ----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Imported from <span className="font-medium text-zinc-100">{s.detected}</span>
          {effective && (
            <>
              {' '}
              · {effective.messages.length} messages · {effective.participants.length} participants
            </>
          )}
        </p>
        <button onClick={s.reset} className="text-xs text-zinc-400 hover:text-zinc-200">
          ← Start over
        </button>
      </div>

      {s.importWarnings.length > 0 && (
        <p className="text-xs text-amber-300/70">{s.importWarnings.length} import warning(s).</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-4">
          <DetailsEditor
            imported={imported}
            edits={edits}
            onTitle={s.setTitle}
            onKind={s.setKind}
            onRename={s.setRename}
            onDateRange={s.setDateRange}
            onReset={s.resetEdits}
          />

          <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-400">Convert to</span>
              <select className={field} value={s.target} onChange={(e) => s.setTarget(e.target.value as ExportFormatId)}>
                {exportFormatIds.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_META[f].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void onExport()}
              disabled={s.phase === 'exporting'}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 font-medium text-white transition hover:bg-emerald-400 disabled:opacity-40"
            >
              {s.phase === 'exporting' ? 'Converting…' : 'Convert & download'}
            </button>
            {s.report && <ReportView report={s.report} />}
            {s.phase === 'error' && s.error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{s.error}</div>
            )}
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/40">
          <ChatPreview
            imported={imported}
            edits={edits}
            includedCount={effective?.messages.length ?? 0}
            onToggleRemove={s.toggleRemove}
          />
        </div>
      </div>
    </div>
  );
}
