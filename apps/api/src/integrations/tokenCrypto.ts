import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { loadEnv } from '../env';

/**
 * Encryption for third-party OAuth tokens at rest.
 *
 * The realistic threat is a leaked database dump or backup, not a live server compromise — so the
 * key comes from an env secret the database itself never contains. We reuse `LOGTO_APP_SECRET`
 * (already required, server-side only, high entropy) via HKDF with a distinct `info` label rather
 * than demanding another secret at deploy time. Rotating it invalidates stored tokens, which just
 * means users reconnect the integration.
 */
const INFO = 'chatforge:integration-tokens:v1';

function key(): Buffer {
  const secret = loadEnv().logtoAppSecret;
  if (!secret) throw new Error('LOGTO_APP_SECRET is required to store integration tokens');
  // The salt is constant on purpose: the input is already a high-entropy secret, and a random
  // per-record salt would have to be stored in the same row, adding nothing against a dump.
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(INFO), 32));
}

/** `v1:<iv>:<tag>:<ciphertext>`, all base64url. */
export function sealToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function openToken(sealed: string): string {
  const [version, iv, tag, ct] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('malformed sealed token');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  // Throws if the ciphertext or key is wrong — GCM authenticates, so a tampered row is rejected.
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
