import type { ConversionRecord } from '@chatforge/types';
import { Hono } from 'hono';
import { requirePermission, type Vars } from '../middleware';
import { stores } from '../stores';

/** Conversion history — metadata only. The artifact itself is an E2E-encrypted blob (blobRef). */
export const conversionsModule = new Hono<Vars>();

conversionsModule.get('/', requirePermission('conversions:read'), (c) => {
  const user = c.get('user')!;
  return c.json({ conversions: stores.conversions.get(user.id) ?? [] });
});

conversionsModule.post('/', requirePermission('conversions:write'), async (c) => {
  const user = c.get('user')!;
  const record = (await c.req.json().catch(() => null)) as ConversionRecord | null;
  if (!record?.id) return c.json({ error: 'conversion record with id required' }, 400);
  const list = stores.conversions.get(user.id) ?? [];
  list.unshift(record);
  stores.conversions.set(user.id, list);
  stores.log('conversion:save', user.id, record.id);
  return c.json({ ok: true, id: record.id });
});
