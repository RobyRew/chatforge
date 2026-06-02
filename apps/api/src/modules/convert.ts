import { convert, type ConvertOptions } from '@chatforge/core';
import type { ExportFormatId, PlatformId } from '@chatforge/types';
import { Hono } from 'hono';
import { requirePermission, type Vars } from '../middleware';
import { stores } from '../stores';

/**
 * Opt-in server-side conversion (ADR-0001 hybrid, ADR-0011). Runs the SAME isomorphic core
 * engine in Node. The sandbox is ephemeral: plaintext is decoded in memory, converted, zeroized
 * immediately, never written to disk, and never logged — only metadata enters the audit log.
 */
export const convertModule = new Hono<Vars>();

interface ConvertBody {
  fileName?: string;
  contentBase64?: string;
  target?: ExportFormatId;
  source?: PlatformId;
}

convertModule.post('/', requirePermission('convert:server'), async (c) => {
  const user = c.get('user')!;
  if (!stores.flagEnabled('server-side-conversion', user.id)) {
    return c.json({ error: 'server-side conversion is disabled' }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as ConvertBody | null;
  if (!body?.contentBase64 || !body.target) {
    return c.json({ error: 'contentBase64 and target are required' }, 400);
  }

  const bytes = new Uint8Array(Buffer.from(body.contentBase64, 'base64'));
  const opts: ConvertOptions = { target: body.target };
  if (body.source) opts.source = body.source;

  try {
    const res = await convert({ name: body.fileName ?? 'upload', bytes }, opts);
    const primary = res.artifact.files[0]!;
    stores.log('convert', user.id, `${res.detectedPlatform} -> ${body.target} (${res.conversation.messages.length} msgs)`);
    return c.json({
      detectedPlatform: res.detectedPlatform,
      report: res.report,
      warnings: res.warnings,
      suggestedName: res.artifact.suggestedName,
      mime: res.artifact.mime,
      artifactBase64: Buffer.from(primary.bytes).toString('base64'),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'conversion failed' }, 422);
  } finally {
    bytes.fill(0); // zeroize plaintext immediately
  }
});
