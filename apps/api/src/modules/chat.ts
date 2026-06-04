import { Hono } from 'hono';
import { getChatRepo } from '../chat/repo';
import { requirePermission, type Vars } from '../middleware';

/** REST surface for chat: create/list DMs + paginated history. Realtime is the WS gateway. */
export const chatModule = new Hono<Vars>();

async function userIdByEmail(email: string): Promise<string | undefined> {
  const { getDb } = await import('../db');
  const { user } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  return rows[0]?.id;
}

async function userIdByUsername(username: string): Promise<string | undefined> {
  const { getDb } = await import('../db');
  const { user } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await getDb().select({ id: user.id }).from(user).where(eq(user.username, username)).limit(1);
  return rows[0]?.id;
}

/** Resolve a peer by userId, email, or @username (in that order). */
async function resolvePeerId(body: { userId?: string; email?: string; username?: string }): Promise<string | undefined> {
  if (body.userId) return body.userId;
  if (body.email) return userIdByEmail(body.email.trim().toLowerCase());
  if (body.username) return userIdByUsername(body.username.trim().toLowerCase().replace(/^@/, ''));
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
