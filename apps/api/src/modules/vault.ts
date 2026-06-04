import { Hono } from 'hono';
import { requirePermission, type Vars } from '../middleware';

/**
 * Vault: a user's saved imported chats, stored end-to-end encrypted. The server only ever sees the
 * opaque `ciphertext` (a sealed canonical Conversation) + light metadata for listing. Every row is
 * scoped to the owner; a saved chat can be linked to a live DM the user is a member of.
 */
export const vaultModule = new Hono<Vars>();

const MAX_CIPHERTEXT = 12 * 1024 * 1024; // 12 MB of base64

vaultModule.post('/', requirePermission('conversions:write'), async (c) => {
  const me = c.get('user')!;
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: unknown;
    sourcePlatform?: unknown;
    messageCount?: unknown;
    ciphertext?: unknown;
    salt?: unknown;
  };
  if (typeof body.ciphertext !== 'string' || body.ciphertext.length === 0) return c.json({ error: 'ciphertext required' }, 400);
  if (body.ciphertext.length > MAX_CIPHERTEXT) return c.json({ error: 'conversation too large to save' }, 413);

  const { getDb } = await import('../db');
  const { vaultConversations } = await import('../db/schema');
  const rows = await getDb()
    .insert(vaultConversations)
    .values({
      userId: me.id,
      label: typeof body.label === 'string' ? body.label.slice(0, 200) : '',
      sourcePlatform: typeof body.sourcePlatform === 'string' ? body.sourcePlatform.slice(0, 40) : null,
      messageCount: typeof body.messageCount === 'number' && Number.isFinite(body.messageCount) ? Math.max(0, Math.trunc(body.messageCount)) : 0,
      ciphertext: body.ciphertext,
      salt: typeof body.salt === 'string' ? body.salt : null,
    })
    .returning({ id: vaultConversations.id });
  return c.json({ id: rows[0]!.id }, 201);
});

vaultModule.get('/', requirePermission('conversions:read'), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { vaultConversations } = await import('../db/schema');
  const { desc, eq } = await import('drizzle-orm');
  const rows = await getDb()
    .select({
      id: vaultConversations.id,
      label: vaultConversations.label,
      sourcePlatform: vaultConversations.sourcePlatform,
      messageCount: vaultConversations.messageCount,
      linkedConversationId: vaultConversations.linkedConversationId,
      createdAt: vaultConversations.createdAt,
    })
    .from(vaultConversations)
    .where(eq(vaultConversations.userId, me.id))
    .orderBy(desc(vaultConversations.createdAt));
  return c.json({ items: rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })) });
});

vaultModule.get('/:id', requirePermission('conversions:read'), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { vaultConversations } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');
  const rows = await getDb()
    .select()
    .from(vaultConversations)
    .where(and(eq(vaultConversations.id, c.req.param('id')), eq(vaultConversations.userId, me.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({
    item: {
      id: row.id,
      label: row.label,
      sourcePlatform: row.sourcePlatform,
      messageCount: row.messageCount,
      ciphertext: row.ciphertext,
      salt: row.salt,
      linkedConversationId: row.linkedConversationId,
      createdAt: row.createdAt.getTime(),
    },
  });
});

/** Link (or unlink, with conversationId=null) a saved chat to a live DM the user belongs to. */
vaultModule.post('/:id/link', requirePermission('conversions:write'), async (c) => {
  const me = c.get('user')!;
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { conversationId?: unknown };
  let conversationId: string | null = null;
  if (typeof body.conversationId === 'string' && body.conversationId) {
    const { getChatRepo } = await import('../chat/repo');
    if (!(await getChatRepo().isMember(body.conversationId, me.id))) return c.json({ error: 'not a member of that conversation' }, 403);
    conversationId = body.conversationId;
  } else if (body.conversationId !== null && body.conversationId !== undefined) {
    return c.json({ error: 'conversationId must be a string or null' }, 400);
  }
  const { getDb } = await import('../db');
  const { vaultConversations } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');
  const updated = await getDb()
    .update(vaultConversations)
    .set({ linkedConversationId: conversationId })
    .where(and(eq(vaultConversations.id, id), eq(vaultConversations.userId, me.id)))
    .returning({ id: vaultConversations.id });
  if (!updated.length) return c.json({ error: 'not found' }, 404);
  return c.json({ id, linkedConversationId: conversationId });
});

vaultModule.delete('/:id', requirePermission('conversions:write'), async (c) => {
  const me = c.get('user')!;
  const { getDb } = await import('../db');
  const { vaultConversations } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');
  await getDb().delete(vaultConversations).where(and(eq(vaultConversations.id, c.req.param('id')), eq(vaultConversations.userId, me.id)));
  return c.json({ ok: true });
});
