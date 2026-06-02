import { describe, expect, it } from 'vitest';
import { open, seal } from '../src/vault';
import { generateRecoveryPhrase, isValidRecoveryPhrase, recoveryPhraseToKey } from '../src/recovery';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('vault (zero-knowledge seal/open)', () => {
  it('round-trips sealed data with the right passphrase', async () => {
    const sealed = await seal(enc('top secret conversation'), 'correct horse battery staple');
    expect(dec(await open(sealed, 'correct horse battery staple'))).toBe('top secret conversation');
  });

  it('fails to open with the wrong passphrase', async () => {
    const sealed = await seal(enc('hello'), 'right-pass');
    await expect(open(sealed, 'wrong-pass')).rejects.toThrow();
  });

  it('stores only ciphertext (admin cannot read it)', async () => {
    const sealed = await seal(enc('private'), 'pw');
    expect(dec(sealed.ciphertext).includes('private')).toBe(false);
  });
});

describe('recovery phrase', () => {
  it('generates a valid 24-word phrase yielding a 32-byte key', () => {
    const phrase = generateRecoveryPhrase();
    expect(phrase.split(' ')).toHaveLength(24);
    expect(isValidRecoveryPhrase(phrase)).toBe(true);
    expect(recoveryPhraseToKey(phrase)).toHaveLength(32);
  });
});
