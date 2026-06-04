import type { ChatWorkerRequest, ChatWorkerResponse, DecryptResult } from './chatProtocol';

/** Main-thread proxy for the MLS chat worker (request/response correlation by id). */
let worker: Worker | null = null;
const pending = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/chat.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ChatWorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
  }
  return worker;
}

function call<T>(req: ChatWorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(req.id, { resolve: resolve as (r: unknown) => void, reject });
    getWorker().postMessage(req);
  });
}
const rid = (): string => crypto.randomUUID();

export const chatWorker = {
  init: (userId: string): Promise<unknown> => call({ id: rid(), type: 'init', userId }),
  generateKeyPackages: (count: number): Promise<{ published: string[] }> => call({ id: rid(), type: 'generateKeyPackages', count }),
  startDm: (conversationId: string, peerKeyPackage: string): Promise<{ welcome: string }> =>
    call({ id: rid(), type: 'startDm', conversationId, peerKeyPackage }),
  join: (conversationId: string, welcome: string): Promise<{ joined: boolean }> =>
    call({ id: rid(), type: 'join', conversationId, welcome }),
  hasGroup: (conversationId: string): Promise<{ has: boolean }> => call({ id: rid(), type: 'hasGroup', conversationId }),
  encrypt: (conversationId: string, payload: string): Promise<{ ciphertext: string }> =>
    call({ id: rid(), type: 'encrypt', conversationId, payload }),
  decrypt: (conversationId: string, ciphertext: string): Promise<DecryptResult> =>
    call({ id: rid(), type: 'decrypt', conversationId, ciphertext }),
};
