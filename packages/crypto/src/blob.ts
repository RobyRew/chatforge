import sodium from 'libsodium-wrappers-sumo';

/**
 * Encrypt bytes with a DEK using the XChaCha20-Poly1305 secretstream construction.
 * Output = header ‖ ciphertext. (Single-chunk now; the streaming API lets us chunk huge
 * files later without changing the format.)
 */
export async function encryptBlob(plaintext: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  const ct = sodium.crypto_secretstream_xchacha20poly1305_push(
    state,
    plaintext,
    null,
    sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
  );
  const out = new Uint8Array(header.length + ct.length);
  out.set(header, 0);
  out.set(ct, header.length);
  return out;
}

export async function decryptBlob(data: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  const headerLen = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  const header = data.subarray(0, headerLen);
  const body = data.subarray(headerLen);
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, dek);
  const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, body);
  if (!result) throw new Error('decryptBlob: authentication failed');
  return result.message;
}
