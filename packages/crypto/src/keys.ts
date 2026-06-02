import sodium from 'libsodium-wrappers-sumo';

/** Await libsodium WASM init before any crypto call. */
export async function ready(): Promise<void> {
  await sodium.ready;
}

export interface MasterKey {
  key: Uint8Array;
  salt: Uint8Array;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Derive a 32-byte master key from a passphrase with Argon2id. Pass an existing `salt` to
 * re-derive (e.g. on unlock); omit it to mint a new one (e.g. on signup).
 */
export async function deriveMasterKey(passphrase: string, salt?: Uint8Array): Promise<MasterKey> {
  await sodium.ready;
  const s = salt ?? sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    passphrase,
    s,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return { key, salt: s };
}

/** A fresh random 32-byte data-encryption key (DEK), one per stored item. */
export async function generateDEK(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_secretstream_xchacha20poly1305_keygen();
}

/** Wrap (encrypt) a DEK under the master key. Output = nonce ‖ ciphertext. */
export async function wrapKey(dek: Uint8Array, masterKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(dek, null, null, nonce, masterKey);
  return concat(nonce, ct);
}

export async function unwrapKey(wrapped: Uint8Array, masterKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  const n = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  const nonce = wrapped.subarray(0, n);
  const ct = wrapped.subarray(n);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, null, nonce, masterKey);
}
