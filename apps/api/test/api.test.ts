import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

const app = createApp();

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token?: string): Promise<Response> {
  return app.request(path, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

describe('api', () => {
  it('reports health', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('serves an OpenAPI document', async () => {
    const res = await get('/openapi.json');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { openapi: string }).openapi).toBe('3.0.0');
  });

  it('rejects unauthenticated server-side conversion', async () => {
    const res = await post('/convert', { fileName: 'x.txt', contentBase64: '', target: 'json' });
    expect(res.status).toBe(401);
  });

  it('runs server-side conversion for an authorized user (hybrid path)', async () => {
    const wa = '[12/03/2025, 10:45:30] Alice: hello there\n';
    const contentBase64 = Buffer.from(wa).toString('base64');
    const res = await post('/convert', { fileName: 'chat.txt', contentBase64, target: 'telegram-json' }, 'user-token');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { detectedPlatform: string; artifactBase64: string };
    expect(data.detectedPlatform).toBe('whatsapp');
    expect(data.artifactBase64.length).toBeGreaterThan(0);
  });

  it('enforces RBAC on the audit log', async () => {
    expect((await get('/admin/audit', 'user-token')).status).toBe(403);
    expect((await get('/admin/audit', 'owner-token')).status).toBe(200);
  });

  it('lets an owner grant a role and an admin toggle a feature flag', async () => {
    const grant = await post('/admin/users/u_user/role', { role: 'moderator' }, 'owner-token');
    expect(grant.status).toBe(200);
    expect(((await grant.json()) as { user: { role: string } }).user.role).toBe('moderator');

    const flag = await post('/admin/flags/chat', { enabled: true }, 'owner-token');
    expect(flag.status).toBe(200);
    expect(((await flag.json()) as { enabled: boolean }).enabled).toBe(true);
  });
});
