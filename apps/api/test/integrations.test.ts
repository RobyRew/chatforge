import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryAdminRepo } from '../src/admin/memoryRepo';
import { setAdminRepo } from '../src/admin/repo';
import { createApp } from '../src/app';

// The OAuth state HMAC and the token sealing both key off LOGTO_APP_SECRET.
const SECRET = 'test-logto-app-secret-value';
const OWNER = 'owner-token';

let signState: (userId: string) => string;
let verifyState: (state: string) => string | null;
let sealToken: (s: string) => string;
let openToken: (s: string) => string;

beforeAll(async () => {
  process.env['LOGTO_APP_SECRET'] = SECRET;
  setAdminRepo(new MemoryAdminRepo());
  ({ signState, verifyState } = await import('../src/integrations/spotify'));
  ({ sealToken, openToken } = await import('../src/integrations/tokenCrypto'));
});

afterAll(() => {
  delete process.env['LOGTO_APP_SECRET'];
  delete process.env['SPOTIFY_CLIENT_ID'];
  delete process.env['SPOTIFY_CLIENT_SECRET'];
});

describe('integration tokens at rest', () => {
  it('round-trips and does not store the plaintext', () => {
    const sealed = sealToken('BQC-super-secret-refresh-token');
    expect(sealed).not.toContain('super-secret');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(openToken(sealed)).toBe('BQC-super-secret-refresh-token');
  });

  it('produces a different ciphertext each time (fresh IV)', () => {
    expect(sealToken('same')).not.toBe(sealToken('same'));
  });

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const sealed = sealToken('token');
    const [v, iv, tag, ct] = sealed.split(':') as [string, string, string, string];
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => openToken([v, iv, tag, flipped.toString('base64url')].join(':'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => openToken('not-a-token')).toThrow(/malformed/);
  });

  it('cannot be opened with a different app secret', () => {
    const sealed = sealToken('token');
    process.env['LOGTO_APP_SECRET'] = 'a-completely-different-secret';
    expect(() => openToken(sealed)).toThrow();
    process.env['LOGTO_APP_SECRET'] = SECRET;
  });
});

describe('spotify OAuth state', () => {
  it('round-trips the user it was issued for', () => {
    expect(verifyState(signState('u_owner'))).toBe('u_owner');
  });

  it('rejects a forged state (wrong signature)', () => {
    const [payload] = signState('u_owner').split('.');
    expect(verifyState(`${payload}.deadbeef`)).toBeNull();
  });

  it('rejects a state whose payload was swapped for another user', () => {
    const mac = signState('u_owner').split('.')[1]!;
    const forged = Buffer.from('u_victim.' + (Date.now() + 60000), 'utf8').toString('base64url');
    expect(verifyState(`${forged}.${mac}`)).toBeNull();
  });

  it('rejects a state signed with a different app secret', () => {
    const state = signState('u_owner');
    process.env['LOGTO_APP_SECRET'] = 'another-secret';
    expect(verifyState(state)).toBeNull();
    process.env['LOGTO_APP_SECRET'] = SECRET;
  });

  it('rejects garbage', () => {
    expect(verifyState('')).toBeNull();
    expect(verifyState('a.b.c')).toBeNull();
  });
});

describe('integrations routes', () => {
  const app = createApp();
  const req = async (path: string, method = 'GET', token?: string): Promise<Response> =>
    app.request(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'manual' });

  it('reports the integration as unavailable when not configured', async () => {
    const res = await req('/api/integrations', 'GET', OWNER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spotify: { available: false, connected: false } });
  });

  it('refuses to start a flow that cannot complete', async () => {
    expect((await req('/api/integrations/spotify/connect', 'GET', OWNER)).status).toBe(503);
  });

  it('requires a session to connect', async () => {
    expect((await req('/api/integrations/spotify/connect')).status).toBe(401);
  });

  it('redirects a callback with an invalid state instead of trusting it', async () => {
    process.env['SPOTIFY_CLIENT_ID'] = 'id';
    process.env['SPOTIFY_CLIENT_SECRET'] = 'secret';
    const res = await req('/api/integrations/spotify/callback?code=abc&state=forged');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('spotify=invalid');
  });
});
