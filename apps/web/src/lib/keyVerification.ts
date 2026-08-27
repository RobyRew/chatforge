/**
 * Key verification (safety numbers).
 *
 * The server relays the MLS KeyPackages that bootstrap a conversation, so in principle it could
 * hand you *its* key instead of your peer's and sit in the middle. It cannot fake a matching
 * safety number, because that is derived from both parties' real signature keys. Comparing the
 * number out-of-band — read it aloud, send a photo — is what closes that gap.
 *
 * Two states matter:
 *  - **unverified** — normal; you just haven't compared it yet.
 *  - **changed** — you verified a number before and it is different now. Either your peer
 *    reinstalled/added a device (common and harmless) or someone is intercepting (rare and not).
 *    We surface it loudly and let the user re-verify; we never silently accept the new key.
 *
 * Verification state is local to this device and never sent to the server — a server-stored
 * "verified" flag would be worthless, since the server is exactly who you're checking.
 */
import { chatWorker } from './chatWorkerClient';
import { getVerification, putVerification } from './chatDb';

export type VerificationStatus = 'unavailable' | 'unverified' | 'verified' | 'changed';

export interface VerificationState {
  status: VerificationStatus;
  /** The number as computed right now from live group state (null if the group isn't set up yet). */
  current: string | null;
  /** What the user previously confirmed, if anything. */
  confirmed?: string;
  verifiedAt?: number;
}

export async function loadVerification(conversationId: string, peerId: string): Promise<VerificationState> {
  let current: string | null = null;
  try {
    current = (await chatWorker.safetyNumber(conversationId, peerId)).number;
  } catch {
    current = null; // no group state on this device yet
  }
  const stored = await getVerification(conversationId).catch(() => undefined);
  if (!current) return { status: 'unavailable', current: null, ...(stored ? { confirmed: stored.safetyNumber, verifiedAt: stored.verifiedAt } : {}) };
  if (!stored) return { status: 'unverified', current };
  return {
    status: stored.safetyNumber === current ? 'verified' : 'changed',
    current,
    confirmed: stored.safetyNumber,
    verifiedAt: stored.verifiedAt,
  };
}

/** Record that the user compared this exact number and it matched. */
export async function confirmVerification(conversationId: string, safetyNumber: string): Promise<void> {
  await putVerification(conversationId, { safetyNumber, verifiedAt: Date.now() });
}
