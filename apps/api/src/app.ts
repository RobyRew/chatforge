import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { loadEnv } from './env';
import { requireAuth, resolveUser, securityHeaders, type Vars } from './middleware';
import { adminModule } from './modules/admin';
import { chatModule } from './modules/chat';
import { conversionsModule } from './modules/conversions';
import { convertModule } from './modules/convert';

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  responses: {
    200: {
      description: 'Service health',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean(), service: z.string(), ts: z.number() }),
        },
      },
    },
  },
});

export function createApp(): OpenAPIHono<Vars> {
  const env = loadEnv();
  const app = new OpenAPIHono<Vars>();

  app.use('*', securityHeaders);
  app.use('*', cors({ origin: env.corsOrigin, credentials: true }));
  app.use('*', resolveUser);

  // better-auth (email+password + passkeys) owns everything under /api/auth/*.
  // Lazy-imported so the converter API + tests don't load the auth stack unless an auth route is hit.
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    const { auth } = await import('./auth');
    return auth.handler(c.req.raw);
  });

  // Container healthcheck (Docker HEALTHCHECK hits :8787/health directly; not exposed via /api).
  app.openapi(healthRoute, (c) => c.json({ ok: true, service: 'chatforge-api', ts: Date.now() }));

  // The current session user + computed effective permissions — the web reads this to drive its UI.
  app.get('/api/me', requireAuth(), (c) => c.json({ user: c.get('user') }));

  // Self-service password change (also clears the must-change-on-first-login flag on success).
  app.post('/api/me/password', requireAuth(), async (c) => {
    const me = c.get('user')!;
    const body = (await c.req.json().catch(() => ({}))) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
      return c.json({ error: 'currentPassword and newPassword (min 8 chars) are required' }, 400);
    }
    try {
      const { auth } = await import('./auth');
      await auth.api.changePassword({
        body: { currentPassword: body.currentPassword, newPassword: body.newPassword },
        headers: c.req.raw.headers,
      });
      const { getAdminRepo } = await import('./admin/repo');
      await getAdminRepo().setMustChangePassword(me.id, false);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'password change failed' }, 400);
    }
  });

  // All app API routes live under /api/* so the web SPA + API can share one origin
  // (Traefik path-routes /api + /ws to the API; the web nginx proxies the same in compose).
  app.route('/api/convert', convertModule);
  app.route('/api/conversions', conversionsModule);
  app.route('/api/admin', adminModule);
  app.route('/api/chat', chatModule);

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'ChatForge API',
      version: '0.0.0',
      description: 'Privacy-first chat converter API. Admin = RBAC over accounts/features; never content.',
    },
  });

  return app;
}
