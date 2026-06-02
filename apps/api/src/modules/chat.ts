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

chatModule.post('/conversations', requirePermission('chat:use'), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; email?: string };
  const peerId = body.userId ?? (body.email ? await userIdByEmail(body.email) : undefined);
  if (!peerId) return c.json({ error: 'userId or email required' }, 400);
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
