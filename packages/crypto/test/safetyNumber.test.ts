import { describe, expect, it } from 'vitest';
import { createMlsProvider } from '../src/mls';
import { formatSafetyNumber, safetyNumber } from '../src/safetyNumber';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const key = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);

const alice = { identity: utf8('alice'), signatureKey: key(1) };
const bob = { identity: utf8('bob'), signatureKey: key(2) };

describe('safety number', () => {
  it('is 60 digits and formats into 12 groups of 5', async () => {
    const n = await safetyNumber(alice, bob);
    expect(n).toMatch(/^\d{60}$/);
    expect(formatSafetyNumber(n).split(' ')).toHaveLength(12);
  });

  it('is order-independent — both devices compute the same number', async () => {
    expect(await safetyNumber(alice, bob)).toBe(await safetyNumber(bob, alice));
  });

  it('changes when a signature key is substituted (the MITM it exists to catch)', async () => {
    const honest = await safetyNumber(alice, bob);
    const attacker = await safetyNumber(alice, { identity: bob.identity, signatureKey: key(3) });
    expect(attacker).not.toBe(honest);
  });

  it('binds the key to the identity — the same key under another name differs', async () => {
    const asBob = await safetyNumber(alice, bob);
    const asMallory = await safetyNumber(alice, { identity: utf8('mallory'), signatureKey: bob.signatureKey });
    expect(asMallory).not.toBe(asBob);
  });

  it('is stable across calls', async () => {
    expect(await safetyNumber(alice, bob)).toBe(await safetyNumber(alice, bob));
  });
});

describe('safety number over a real MLS group', () => {
  it('both members of a DM derive the same number from their own group state', async () => {
    const mls = await createMlsProvider();
    const aBundle = await mls.generateKeyPackage(utf8('user-a'));
    const bBundle = await mls.generateKeyPackage(utf8('user-b'));

    const { groupState: aState, welcome } = await mls.startDm(utf8('conv-1'), aBundle, bBundle.publicPackage);
    const bState = await mls.joinGroup(welcome, bBundle);

    const aMembers = await mls.groupMembers(aState);
    const bMembers = await mls.groupMembers(bState);
    expect(aMembers).toHaveLength(2);
    expect(bMembers).toHaveLength(2);

    // Each side sorts by identity so "self" and "peer" are picked consistently.
    const byId = (m: { identity: Uint8Array }): string => new TextDecoder().decode(m.identity);
    const sortMembers = <T extends { identity: Uint8Array }>(m: T[]): T[] => [...m].sort((x, y) => byId(x).localeCompare(byId(y)));
    const [a1, b1] = sortMembers(aMembers);
    const [a2, b2] = sortMembers(bMembers);

    // The whole guarantee: A's view of the keys equals B's view of the keys.
    expect(a1!.signatureKey).toEqual(a2!.signatureKey);
    expect(b1!.signatureKey).toEqual(b2!.signatureKey);
    expect(await safetyNumber(a1!, b1!)).toBe(await safetyNumber(a2!, b2!));
  });
});
