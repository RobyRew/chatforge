import type { ContactDTO } from '@chatforge/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdminRepo } from '../src/admin/memoryRepo';
import { setAdminRepo } from '../src/admin/repo';
import { createApp } from '../src/app';
import { MemoryChatRepo } from '../src/chat/memoryRepo';
import { setChatRepo } from '../src/chat/repo';
import { stores } from '../src/stores';

// u_owner / u_user are seeded; u_contact3 is a third person to save.
const OWNER = 'owner-token';
const USER = 'user-token';
stores.users.set('u_contact3', { id: 'u_contact3', email: 'contact3@chatforge.local', role: 'user', status: 'active', createdAt: Date.now() });

const app = createApp();
let chat: MemoryChatRepo;

beforeEach(() => {
  setAdminRepo(new MemoryAdminRepo());
  chat = new MemoryChatRepo();
  setChatRepo(chat);
});

const req = async (path: string, method: string, body?: unknown, token?: string): Promise<Response> =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const list = async (token: string): Promise<ContactDTO[]> =>
  ((await (await req('/api/chat/contacts', 'GET', undefined, token)).json()) as { contacts: ContactDTO[] }).contacts;

describe('contacts', () => {
  it('saves by @username or email and lists the contact', async () => {
    const byUsername = await req('/api/chat/contacts', 'POST', { handle: '@contact3' }, OWNER);
    expect(byUsername.status).toBe(201);
    expect(((await byUsername.json()) as { contact: ContactDTO }).contact).toMatchObject({ id: 'u_contact3', nickname: null });

    expect((await req('/api/chat/contacts', 'POST', { handle: 'User@ChatForge.local' }, OWNER)).status).toBe(201);
    expect((await list(OWNER)).map((c) => c.id)).toEqual(['u_contact3', 'u_user']);
  });

  it('sets, keeps and clears a nickname', async () => {
    await req('/api/chat/contacts', 'POST', { handle: '@contact3', nickname: '  Gabi  ' }, OWNER);
    expect((await list(OWNER))[0]).toMatchObject({ nickname: 'Gabi' });

    // Saving again without a nickname is a no-op on the label, not a reset.
    const again = await req('/api/chat/contacts', 'POST', { handle: '@contact3' }, OWNER);
    expect(again.status).toBe(200);
    expect((await list(OWNER))[0]).toMatchObject({ nickname: 'Gabi' });

    await req('/api/chat/contacts', 'POST', { handle: '@contact3', nickname: '' }, OWNER);
    expect((await list(OWNER))[0]).toMatchObject({ nickname: null });
  });

  it('caps the nickname length and rejects a non-string nickname', async () => {
    await req('/api/chat/contacts', 'POST', { handle: '@contact3', nickname: 'x'.repeat(200) }, OWNER);
    expect((await list(OWNER))[0]!.nickname).toHaveLength(64);
    expect((await req('/api/chat/contacts', 'POST', { handle: '@contact3', nickname: 42 }, OWNER)).status).toBe(400);
  });

  it('refuses yourself, unknown handles and a missing handle', async () => {
    expect((await req('/api/chat/contacts', 'POST', { handle: 'owner@chatforge.local' }, OWNER)).status).toBe(400);
    expect((await req('/api/chat/contacts', 'POST', { handle: '@nobody' }, OWNER)).status).toBe(404);
    expect((await req('/api/chat/contacts', 'POST', {}, OWNER)).status).toBe(400);
    expect(await list(OWNER)).toEqual([]);
  });

  it('removes a contact, and 404s on one that was never saved', async () => {
    await req('/api/chat/contacts', 'POST', { handle: '@contact3' }, OWNER);
    expect((await req('/api/chat/contacts/u_contact3', 'DELETE', undefined, OWNER)).status).toBe(200);
    expect(await list(OWNER)).toEqual([]);
    expect((await req('/api/chat/contacts/u_contact3', 'DELETE', undefined, OWNER)).status).toBe(404);
  });

  it('is one-sided and private to its owner', async () => {
    await req('/api/chat/contacts', 'POST', { handle: 'user@chatforge.local', nickname: 'my secret label' }, OWNER);
    // The saved person sees nothing — neither in their own list nor anywhere else.
    expect(await list(USER)).toEqual([]);
    // And they cannot remove an entry from someone else's list.
    expect((await req('/api/chat/contacts/u_user', 'DELETE', undefined, USER)).status).toBe(404);
    expect((await list(OWNER)).map((c) => c.id)).toEqual(['u_user']);
  });

  it('requires a session', async () => {
    expect((await req('/api/chat/contacts', 'GET')).status).toBe(401);
    expect((await req('/api/chat/contacts', 'POST', { handle: '@contact3' })).status).toBe(401);
  });
});
