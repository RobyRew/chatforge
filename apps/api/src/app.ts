import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { loadEnv } from './env';
import { resolveUser, securityHeaders, type Vars } from './middleware';
import { adminModule } from './modules/admin';
import { authModule } from './modules/auth';
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

  // Typed + documented route (the pattern all routes migrate to → OpenAPI → native codegen).
  app.openapi(healthRoute, (c) => c.json({ ok: true, service: 'chatforge-api', ts: Date.now() }));

  app.route('/auth', authModule);
  app.route('/convert', convertModule);
  app.route('/conversions', conversionsModule);
  app.route('/admin', adminModule);
  app.route('/chat', chatModule);

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'ChatForge API',
      version: '0.0.0',
      description: 'Privacy-first chat converter API. Admin = RBAC over accounts/features; never content.',
    },
  });

  return app;
}
