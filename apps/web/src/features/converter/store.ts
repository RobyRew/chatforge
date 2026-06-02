import { create } from 'zustand';
import type { ExportArtifact } from '@chatforge/core';
import type { Edits } from '@chatforge/core/transforms';
import type { Conversation, ExportFormatId, FidelityReport, PlatformId } from '@chatforge/types';

export type SourceChoice = 'auto' | PlatformId;
export type Phase = 'idle' | 'importing' | 'editing' | 'exporting' | 'error';

interface ConverterState {
  file: File | null;
  source: SourceChoice;
  target: ExportFormatId;
  phase: Phase;
  error?: string;
  detected?: string;
  imported?: Conversation;
  importWarnings: string[];
  edits: Edits;
  artifact?: ExportArtifact;
  report?: FidelityReport;

  setFile: (f: File | null) => void;
  setSource: (s: SourceChoice) => void;
  setTarget: (t: ExportFormatId) => void;

  beginImport: () => void;
  importDone: (conversation: Conversation, detected: string, warnings: string[]) => void;
  beginExport: () => void;
  exportDone: (artifact: ExportArtifact, report: FidelityReport) => void;
  failWith: (error: string) => void;

  setTitle: (title: string) => void;
  setKind: (kind: Conversation['kind']) => void;
  setRename: (id: string, name: string) => void;
  setDateRange: (from: number | undefined, to: number | undefined) => void;
  toggleRemove: (id: string) => void;
  resetEdits: () => void;

  reset: () => void;
}

// Any edit invalidates a previously produced export artifact/report.
const staleExport = { artifact: undefined, report: undefined };

export const useConverter = create<ConverterState>((set) => ({
  file: null,
  source: 'auto',
  target: 'telegram-json',
  phase: 'idle',
  importWarnings: [],
  edits: {},

  setFile: (file) => set({ file, phase: 'idle', error: undefined, imported: undefined, edits: {}, ...staleExport }),
  setSource: (source) => set({ source }),
  setTarget: (target) => set({ target, ...staleExport }),

  beginImport: () => set({ phase: 'importing', error: undefined }),
  importDone: (imported, detected, importWarnings) =>
    set({ phase: 'editing', imported, detected, importWarnings, edits: {}, ...staleExport }),
  beginExport: () => set({ phase: 'exporting', error: undefined }),
  exportDone: (artifact, report) => set({ phase: 'editing', artifact, report }),
  failWith: (error) => set({ phase: 'error', error }),

  setTitle: (title) => set((s) => ({ edits: { ...s.edits, title }, ...staleExport })),
  setKind: (kind) => set((s) => ({ edits: { ...s.edits, kind }, ...staleExport })),
  setRename: (id, name) => set((s) => ({ edits: { ...s.edits, renames: { ...s.edits.renames, [id]: name } }, ...staleExport })),
  setDateRange: (dateFrom, dateTo) => set((s) => ({ edits: { ...s.edits, dateFrom, dateTo }, ...staleExport })),
  toggleRemove: (id) =>
    set((s) => {
      const next = new Set(s.edits.removedIds ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { edits: { ...s.edits, removedIds: [...next] }, ...staleExport };
    }),
  resetEdits: () => set({ edits: {}, ...staleExport }),

  reset: () =>
    set({
      file: null,
      phase: 'idle',
      error: undefined,
      detected: undefined,
      imported: undefined,
      importWarnings: [],
      edits: {},
      ...staleExport,
    }),
}));
