import type { InputFile, WorkerRequest, WorkerResponse } from '@chatforge/core';
import type { Conversation, ExportFormatId, PlatformId } from '@chatforge/types';

/**
 * Runs the engine in a Web Worker (off the main thread). Two actions: import a file into the
 * canonical model, then export a (possibly edited) conversation. Plaintext never leaves the browser.
 */
let worker: Worker | null = null;
const pending = new Map<string, (r: WorkerResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/convert.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data);
      }
    };
  }
  return worker;
}

function send(request: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    pending.set(request.id, resolve);
    getWorker().postMessage(request);
  });
}

export function importChat(file: InputFile, source?: PlatformId): Promise<WorkerResponse> {
  return send({ id: crypto.randomUUID(), action: 'import', file, ...(source ? { source } : {}) });
}

export function exportChat(conversation: Conversation, target: ExportFormatId): Promise<WorkerResponse> {
  return send({ id: crypto.randomUUID(), action: 'export', conversation, target });
}
