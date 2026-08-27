/**
 * Safety numbers — the out-of-band check that there is no man-in-the-middle.
 *
 * Two people compare a 60-digit number (over the phone, in person, via a photo). It is derived
 * *only* from both parties' MLS signature public keys and their user ids, so it is identical on
 * both devices — and it changes if either key is substituted. That is the whole point: the server
 * relays KeyPackages, so a malicious server could hand you *its* key instead of your peer's. It
 * cannot fake a matching safety number, because it doesn't hold your peer's private key.
 *
 * Construction follows the design Signal popularised:
 *  - each side gets its own 30-digit **fingerprint** = iterated SHA-512 over (version ‖ key ‖ id)
 *  - the two fingerprints are concatenated in a **deterministic order** (lexicographic), so both
 *    devices produce the same string without agreeing who is "first"
 *
 * The iteration count is deliberate cost: it makes grinding for a key whose fingerprint collides
 * in the digits a user actually compares far more expensive than a single hash would.
 *
 * Isomorphic — WebCrypto only, so it runs in the browser, a Web Worker and Node alike.
 */

/** Bump if the derivation ever changes; a different version yields a different number by design. */
const VERSION = 1;
const ITERATIONS = 5200;
const DIGITS_PER_SIDE = 30;
const CHUNK_BYTES = 5; // 5 bytes → one 5-digit group

/**
 * Iterated hash binding a signature key to the identity that claims it. Hashing the key *with* the
 * id is what stops an attacker replaying a legitimate key under a different account.
 */
async function fingerprintDigits(signatureKey: Uint8Array, identity: Uint8Array): Promise<string> {
  const version = new Uint8Array([VERSION >> 8, VERSION & 0xff]);
  let digest = concat(version, signatureKey, identity);
  for (let i = 0; i < ITERATIONS; i++) {
    // Re-mixing the key on every round keeps the whole chain bound to it.
    digest = new Uint8Array(await crypto.subtle.digest('SHA-512', concat(digest, signatureKey)));
  }
  let out = '';
  for (let i = 0; out.length < DIGITS_PER_SIDE; i++) {
    out += chunkToDigits(digest.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
  }
  return out.slice(0, DIGITS_PER_SIDE);
}

/** 5 bytes → 5 decimal digits (big-endian, mod 100000). */
function chunkToDigits(chunk: Uint8Array): string {
  let n = 0;
  for (const b of chunk) n = n * 256 + b;
  return String(n % 100000).padStart(5, '0');
}

// Returns an explicitly ArrayBuffer-backed view: TS 5.7's `Uint8Array<ArrayBufferLike>` is not
// assignable to `BufferSource` (it could be SharedArrayBuffer-backed), which WebCrypto requires.
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface SafetyNumberParty {
  identity: Uint8Array;
  signatureKey: Uint8Array;
}

/**
 * The shared 60-digit safety number for two parties. Order-independent: whichever side computes it,
 * the result is the same, because the two fingerprints are sorted before joining.
 */
export async function safetyNumber(a: SafetyNumberParty, b: SafetyNumberParty): Promise<string> {
  const [fa, fb] = await Promise.all([
    fingerprintDigits(a.signatureKey, a.identity),
    fingerprintDigits(b.signatureKey, b.identity),
  ]);
  return fa < fb ? fa + fb : fb + fa;
}

/** Render as 12 groups of 5 for reading aloud. */
export function formatSafetyNumber(n: string): string {
  return (n.match(/.{1,5}/g) ?? []).join(' ');
}
