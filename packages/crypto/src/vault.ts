import { encryptBlob, decryptBlob } from './blob';
import { deriveMasterKey, generateDEK, unwrapKey, wrapKey } from './keys';

/**
 * What the server is allowed to store. It is pure ciphertext + a wrapped key + a salt —
 * the server can never derive the master key, so it (and any admin) cannot read the content.
 * This is the on-disk shape behind ADR-0001 (zero-knowledge storage).
 */
export interface SealedBlob {
  ciphertext: Uint8Array;
  wrappedKey: Uint8Array;
  salt: Uint8Array;
}

/** Client-side seal: a random DEK encrypts the data; the passphrase-derived master key wraps the DEK. */
export async function seal(plaintext: Uint8Array, passphrase: string): Promise<SealedBlob> {
  const dek = await generateDEK();
  const { key: master, salt } = await deriveMasterKey(passphrase);
  const ciphertext = await encryptBlob(plaintext, dek);
  const wrappedKey = await wrapKey(dek, master);
  return { ciphertext, wrappedKey, salt };
}

/** Client-side open: re-derive the master key from the passphrase + salt, unwrap the DEK, decrypt. */
export async function open(sealed: SealedBlob, passphrase: string): Promise<Uint8Array> {
  const { key: master } = await deriveMasterKey(passphrase, sealed.salt);
  const dek = await unwrapKey(sealed.wrappedKey, master);
  return decryptBlob(sealed.ciphertext, dek);
}
