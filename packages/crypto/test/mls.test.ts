import { describe, expect, it } from 'vitest';
import { createMlsProvider } from '../src/mls';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('MLS provider (ts-mls, 1:1 DM)', () => {
  it('forms a 2-member group and exchanges encrypted messages both ways', async () => {
    const mls = await createMlsProvider();
    expect(mls.ciphersuite).toBe('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519');

    // Each device generates a KeyPackage. In the app the public half is published, the private sealed.
    const alice = await mls.generateKeyPackage(enc('alice'));
    const bob = await mls.generateKeyPackage(enc('bob'));

    // Alice starts the DM using Bob's published public KeyPackage.
    const invite = await mls.startDm(enc('conversation-1'), alice, bob.publicPackage);
    let aliceState = invite.groupState;

    // Bob joins from the relayed Welcome using only his own sealed KeyPackage (tree rides in the Welcome).
    let bobState = await mls.joinGroup(invite.welcome, bob);

    // Alice → Bob.
    const out = await mls.encrypt(aliceState, enc('hello bob'));
    aliceState = out.groupState;
    // The relayed ciphertext is opaque — the server (and anyone on the wire) cannot read it.
    expect(dec(out.ciphertext).includes('hello bob')).toBe(false);

    const inbound = await mls.decrypt(bobState, out.ciphertext);
    expect(inbound.type).toBe('application');
    if (inbound.type !== 'application') throw new Error('expected an application message');
    bobState = inbound.groupState;
    expect(dec(inbound.plaintext)).toBe('hello bob');

    // Bob → Alice (proves the ratchet advances bidirectionally).
    const reply = await mls.encrypt(bobState, enc('hi alice 👋'));
    bobState = reply.groupState;
    const inboundA = await mls.decrypt(aliceState, reply.ciphertext);
    if (inboundA.type !== 'application') throw new Error('expected an application message');
    expect(dec(inboundA.plaintext)).toBe('hi alice 👋');
  });

  it('persists + restores group state across a "reload" (state crosses the seam as bytes)', async () => {
    const mls = await createMlsProvider();
    const alice = await mls.generateKeyPackage(enc('alice'));
    const bob = await mls.generateKeyPackage(enc('bob'));
    const invite = await mls.startDm(enc('conversation-2'), alice, bob.publicPackage);
    const bobState = await mls.joinGroup(invite.welcome, bob);

    // A brand-new provider instance (the provider is stateless) operates purely on the persisted bytes —
    // exactly what happens after a page reload that re-seals/restores group state from IndexedDB.
    const reloaded = await createMlsProvider();
    const out = await reloaded.encrypt(invite.groupState, enc('after reload'));
    const got = await reloaded.decrypt(bobState, out.ciphertext);
    if (got.type !== 'application') throw new Error('expected an application message');
    expect(dec(got.plaintext)).toBe('after reload');
  });

  it('rejects a foreign ciphertext (wrong group cannot decrypt)', async () => {
    const mls = await createMlsProvider();
    const alice = await mls.generateKeyPackage(enc('alice'));
    const bob = await mls.generateKeyPackage(enc('bob'));
    const mallory = await mls.generateKeyPackage(enc('mallory'));
    const eve = await mls.generateKeyPackage(enc('eve'));

    const dm1 = await mls.startDm(enc('c-a'), alice, bob.publicPackage);
    const dm2 = await mls.startDm(enc('c-b'), mallory, eve.publicPackage);
    const bobState = await mls.joinGroup(dm1.welcome, bob);

    const out = await mls.encrypt(dm2.groupState, enc('not for bob'));
    await expect(mls.decrypt(bobState, out.ciphertext)).rejects.toThrow();
  });
});
