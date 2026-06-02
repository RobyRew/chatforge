/**
 * Messaging Layer Security (RFC 9420) interfaces for future real-time E2E group chat.
 * Stubs only in v1 — the live chat transport is scaffolded, not implemented.
 */
export interface MlsGroup {
  id: string;
  epoch: number;
}

export interface MlsProvider {
  createGroup(id: string): Promise<MlsGroup>;
  addMember(group: MlsGroup, keyPackage: Uint8Array): Promise<MlsGroup>;
  encrypt(group: MlsGroup, plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(group: MlsGroup, ciphertext: Uint8Array): Promise<Uint8Array>;
}

function notImplemented(): never {
  throw new Error('MLS provider is scaffolded but not implemented yet');
}

export const mlsStub: MlsProvider = {
  createGroup: () => notImplemented(),
  addMember: () => notImplemented(),
  encrypt: () => notImplemented(),
  decrypt: () => notImplemented(),
};
