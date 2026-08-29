import { Hono } from 'hono';
import { getChatRepo } from '../chat/repo';
import { requirePermission, type Vars } from '../middleware';

/** REST surface for chat: create/list DMs + paginated history. Realtime is the WS gateway. */
export const chatModule = new Hono<Vars>();

/** Resolve a peer by userId, email, or @username (in that order). */
async function resolvePeerId(body: { userId?: string; email?: string; username?: string }): Promise<string | undefined> {
  if (body.userId) return body.userId;
  const repo = getChatRepo();
  if (body.email) return repo.findUserIdByEmail(body.email.trim().toLowerCase());
  if (body.username) return repo.findUserIdByUsername(body.username.trim().toLowerCase().replace(/^@/, ''));
  return undefined;
}

chatModule.post('/conversations', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; email?: string; username?: string };
  const peerId = await resolvePeerId(body);
  if (!peerId) return c.json({ error: 'userId, email or username required' }, 400);
  if (peerId === me.id) return c.json({ error: 'cannot start a conversation with yourself' }, 400);
  const dm = await getChatRepo().createDm(me.id, peerId);
  return c.json({ conversationId: dm.id, created: dm.created });
});

// ── Groups (P6) ──────────────────────────────────────────────────────────────
// Membership is server-authoritative (who may read what), but the *cryptographic* membership is
// MLS's: adding someone means the client relays a Welcome to them and a commit to everyone else.
// Both must happen — see docs/architecture.md.

const MAX_GROUP_MEMBERS = 50;

/** Create a group. The creator is its owner and the only one who may add or remove members. */
chatModule.post('/groups', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; members?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
  if (!title) return c.json({ error: 'title required' }, 400);
  if (!Array.isArray(body.members) || body.members.length === 0) return c.json({ error: 'at least one member required' }, 400);
  if (body.members.length > MAX_GROUP_MEMBERS) return c.json({ error: `at most ${MAX_GROUP_MEMBERS} members` }, 400);

  const ids: string[] = [];
  for (const entry of body.members) {
    if (typeof entry !== 'string' || !entry.trim()) return c.json({ error: 'invalid member handle' }, 400);
    const id = await resolveHandle(entry);
    if (!id) return c.json({ error: `no such user: ${entry}` }, 404);
    if (id !== me.id && !ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return c.json({ error: 'a group needs someone other than you' }, 400);

  const { id } = await getChatRepo().createGroup(me.id, title, ids);
  return c.json({ conversationId: id, memberIds: ids }, 201);
});

/** Add a member. Owner-only — enforced in the repo, not just here. */
chatModule.post('/conversations/:id/members', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const conversationId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { handle?: unknown };
  if (typeof body.handle !== 'string' || !body.handle.trim()) return c.json({ error: 'handle required' }, 400);
  const userId = await resolveHandle(body.handle);
  if (!userId) return c.json({ error: 'no such user' }, 404);
  if (!(await getChatRepo().addGroupMember(conversationId, me.id, userId))) {
    return c.json({ error: 'cannot add that member (not the group owner, or already a member)' }, 403);
  }
  await notifyConversationChanged(conversationId);
  return c.json({ userId }, 201);
});

/** Remove a member (owner) or leave (yourself). The owner cannot leave their own group. */
chatModule.delete('/conversations/:id/members/:userId', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const conversationId = c.req.param('id');
  const target = c.req.param('userId');
  // Capture the roster *before* the removal so the leaver's own client is told too.
  const before = await getChatRepo().memberIds(conversationId);
  if (!(await getChatRepo().removeGroupMember(conversationId, me.id, target))) {
    return c.json({ error: 'cannot remove that member' }, 403);
  }
  await notifyConversationChanged(conversationId, before);
  return c.json({ ok: true });
});

/** Tell every (current or just-removed) member to refetch this conversation's metadata. */
async function notifyConversationChanged(conversationId: string, extra: string[] = []): Promise<void> {
  const { broadcastTo } = await import('../chat/broadcast');
  const members = new Set([...(await getChatRepo().memberIds(conversationId)), ...extra]);
  for (const m of members) broadcastTo(m, { t: 'conversation', conversationId });
}

/** Resolve `@username`, an email, or a raw user id to a user id. */
async function resolveHandle(raw: string): Promise<string | undefined> {
  const value = raw.trim().replace(/^@/, '').toLowerCase();
  if (value.includes('@')) return resolvePeerId({ email: value });
  return resolvePeerId({ username: value });
}

chatModule.get('/conversations', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  return c.json({ conversations: await getChatRepo().listConversations(me.id) });
});

chatModule.get('/conversations/:id/messages', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const id = c.req.param('id');
  if (!(await getChatRepo().isMember(id, me.id))) return c.json({ error: 'forbidden' }, 403);
  const beforeSeq = c.req.query('beforeSeq');
  const limit = c.req.query('limit');
  const messages = await getChatRepo().listMessages(id, {
    beforeSeq: beforeSeq ? Number(beforeSeq) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return c.json({ messages });
});

// ── CH-3 MLS bootstrap: publish/claim public KeyPackages + relay Welcomes (opaque base64). ──

/** Publish this device's public KeyPackages so peers can claim one to start an E2E DM. */
chatModule.post('/keypackages', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { deviceId?: string; keyPackages?: unknown };
  const deviceId = typeof body.deviceId === 'string' && body.deviceId ? body.deviceId : 'default';
  const packages = Array.isArray(body.keyPackages)
    ? body.keyPackages.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (!packages.length) return c.json({ error: 'keyPackages (non-empty string array) required' }, 400);
  if (packages.length > 100) return c.json({ error: 'too many key packages (max 100)' }, 413);
  if (packages.some((p) => p.length > 32_768)) return c.json({ error: 'key package too large' }, 413);
  await getChatRepo().publishKeyPackages(me.id, deviceId.slice(0, 128), packages);
  return c.json({ published: packages.length });
});

/** How many of *my* published KeyPackages remain unclaimed (so the client knows when to replenish). */
chatModule.get('/keypackages', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  return c.json({ count: await getChatRepo().countKeyPackages(me.id) });
});

/** Claim (and consume) one of a peer's KeyPackages to bootstrap a DM with them. */
chatModule.post('/keypackages/claim', requirePermission('chat:use'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; email?: string; username?: string };
  const peerId = await resolvePeerId(body);
  if (!peerId) return c.json({ error: 'userId, email or username required' }, 400);
  const keyPackage = await getChatRepo().claimKeyPackage(peerId);
  if (!keyPackage) return c.json({ error: 'no key package available for that user' }, 409);
  return c.json({ userId: peerId, keyPackage });
});

/** Relay an MLS Welcome to a conversation peer (both sender + recipient must be members). */
chatModule.post('/welcomes', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { conversationId?: string; recipientId?: string; welcome?: string };
  if (!body.conversationId || !body.recipientId || !body.welcome) {
    return c.json({ error: 'conversationId, recipientId, welcome required' }, 400);
  }
  if (body.welcome.length > 262_144) return c.json({ error: 'welcome too large' }, 413);
  const repo = getChatRepo();
  if (!(await repo.isMember(body.conversationId, me.id))) return c.json({ error: 'forbidden' }, 403);
  if (!(await repo.isMember(body.conversationId, body.recipientId))) return c.json({ error: 'recipient is not a member' }, 400);
  const { id } = await repo.storeWelcome(body.conversationId, body.recipientId, me.id, body.welcome);
  return c.json({ id });
});

/** Fetch the Welcomes waiting for me (each lets me join one conversation). */
chatModule.get('/welcomes', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  return c.json({ welcomes: await getChatRepo().listWelcomes(me.id) });
});

/** Acknowledge a processed Welcome so it isn't returned again. */
chatModule.delete('/welcomes/:id', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  await getChatRepo().deleteWelcome(c.req.param('id'), me.id);
  return c.json({ ok: true });
});
