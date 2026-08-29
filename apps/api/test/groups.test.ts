import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdminRepo } from '../src/admin/memoryRepo';
import { setAdminRepo } from '../src/admin/repo';
import { createApp } from '../src/app';
import { MemoryChatRepo } from '../src/chat/memoryRepo';
import { setChatRepo } from '../src/chat/repo';
import { stores } from '../src/stores';

// u_owner / u_user are seeded; u_third is an outsider.
const OWNER = 'owner-token';
const USER = 'user-token';
const THIRD = 'third-token';
stores.users.set('u_third', { id: 'u_third', email: 'third@chatforge.local', role: 'user', status: 'active', createdAt: Date.now() });
stores.sessions.set(THIRD, 'u_third');

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

/** Groups are created through the repo directly where the test doesn't care about handle lookup. */
const makeGroup = async (): Promise<string> => (await chat.createGroup('u_owner', 'Team', ['u_user'])).id;

describe('groups — creation', () => {
  it('rejects a group with no title or no members', async () => {
    expect((await req('/api/chat/groups', 'POST', { members: ['@someone'] }, OWNER)).status).toBe(400);
    expect((await req('/api/chat/groups', 'POST', { title: 'Team', members: [] }, OWNER)).status).toBe(400);
  });

  it('404s on a member handle that does not resolve, rather than creating a half-empty group', async () => {
    const res = await req('/api/chat/groups', 'POST', { title: 'Team', members: ['@nobody'] }, OWNER);
    expect(res.status).toBe(404);
  });

  it('requires a session', async () => {
    expect((await req('/api/chat/groups', 'POST', { title: 'Team', members: ['@x'] })).status).toBe(401);
  });
});

describe('groups — membership authorization', () => {
  it('makes the creator the owner and lists the group for every member', async () => {
    const id = await makeGroup();
    const mine = await chat.listConversations('u_owner');
    const theirs = await chat.listConversations('u_user');
    expect(mine[0]).toMatchObject({ id, kind: 'group', title: 'Team', createdBy: 'u_owner' });
    expect(theirs[0]).toMatchObject({ id, kind: 'group' });
  });

  it('lets only the owner add members', async () => {
    const id = await makeGroup();
    expect(await chat.addGroupMember(id, 'u_user', 'u_third')).toBe(false); // member, not owner
    expect(await chat.addGroupMember(id, 'u_third', 'u_third')).toBe(false); // outsider
    expect(await chat.addGroupMember(id, 'u_owner', 'u_third')).toBe(true);
    expect(await chat.addGroupMember(id, 'u_owner', 'u_third')).toBe(false); // already a member
    expect(await chat.isMember(id, 'u_third')).toBe(true);
  });

  it('lets the owner remove someone, and anyone remove themselves', async () => {
    const id = await makeGroup();
    await chat.addGroupMember(id, 'u_owner', 'u_third');
    expect(await chat.removeGroupMember(id, 'u_user', 'u_third')).toBe(false); // not the owner
    expect(await chat.removeGroupMember(id, 'u_third', 'u_third')).toBe(true); // leaving
    expect(await chat.removeGroupMember(id, 'u_owner', 'u_user')).toBe(true); // owner removes
    expect(await chat.isMember(id, 'u_user')).toBe(false);
  });

  it('refuses to let the owner leave — that would orphan the group', async () => {
    const id = await makeGroup();
    expect(await chat.removeGroupMember(id, 'u_owner', 'u_owner')).toBe(false);
    expect(await chat.isMember(id, 'u_owner')).toBe(true);
  });

  it('rejects membership changes over HTTP from a non-owner', async () => {
    const id = await makeGroup();
    const add = await req(`/api/chat/conversations/${id}/members`, 'POST', { handle: 'third@chatforge.local' }, USER);
    expect(add.status).toBe(403);
    const remove = await req(`/api/chat/conversations/${id}/members/u_owner`, 'DELETE', undefined, USER);
    expect(remove.status).toBe(403);
  });

  it('stops delivering messages to a removed member', async () => {
    const id = await makeGroup();
    await chat.appendMessage(id, 'u_owner', 'before');
    expect(await chat.memberIds(id)).toContain('u_user');
    await chat.removeGroupMember(id, 'u_owner', 'u_user');
    expect(await chat.memberIds(id)).not.toContain('u_user');
    // The gateway fans out to memberIds, so they receive nothing further.
    expect((await req(`/api/chat/conversations/${id}/messages`, 'GET', undefined, USER)).status).toBe(403);
  });

  it('does not treat a DM as a group — nobody can add members to it', async () => {
    const dm = (await chat.createDm('u_owner', 'u_user')).id;
    expect(await chat.addGroupMember(dm, 'u_owner', 'u_third')).toBe(false);
  });
});
