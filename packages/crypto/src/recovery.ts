import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/** A 24-word (256-bit) recovery phrase — the offline backup for account/key recovery. */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(phrase, wordlist);
}

/** Convert a recovery phrase to its 32-byte entropy (usable as a recovery master key). */
export function recoveryPhraseToKey(phrase: string): Uint8Array {
  if (!validateMnemonic(phrase, wordlist)) throw new Error('Invalid recovery phrase');
  return mnemonicToEntropy(phrase, wordlist);
}
