/**
 * Worker protocol for the MLS chat worker. Deliberately uses only plain values (strings, base64,
 * numbers) so the main thread never imports `ts-mls`/crypto types — all key material stays inside
 * the worker (and the worker's IndexedDB). Public artifacts cross as base64.
 */
export type ChatWorkerRequest =
  | { id: string; type: 'init'; userId: string }
  | { id: string; type: 'generateKeyPackages'; count: number }
  | { id: string; type: 'startDm'; conversationId: string; peerKeyPackage: string }
  | { id: string; type: 'join'; conversationId: string; welcome: string }
  | { id: string; type: 'hasGroup'; conversationId: string }
  | { id: string; type: 'encrypt'; conversationId: string; payload: string }
  | { id: string; type: 'decrypt'; conversationId: string; ciphertext: string }
  | { id: string; type: 'safetyNumber'; conversationId: string; peerId: string }
  | { id: string; type: 'createGroup'; conversationId: string }
  | { id: string; type: 'addMember'; conversationId: string; peerKeyPackage: string }
  | { id: string; type: 'removeMember'; conversationId: string; peerId: string };

// The worker treats the payload as an opaque string; the structured `ChatPayload` (replies,
// reactions, attachments) is built/parsed on the main thread (see lib/chatPayload.ts).
export type DecryptResult = { kind: 'application'; plaintext: string } | { kind: 'handshake' };

export type ChatWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };
