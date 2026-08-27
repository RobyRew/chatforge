import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { loadEnv } from './env';
import { resolveUser, securityHeaders, type Vars } from './middleware';
import { accountModule } from './modules/account';
import { adminModule } from './modules/admin';
import { authModule } from './modules/auth';
import { blobsModule } from './modules/blobs';
import { chatModule } from './modules/chat';
import { conversionsModule } from './modules/conversions';
import { convertModule } from './modules/convert';
import { vaultModule } from './modules/vault';

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

  // Authentication is delegated to Logto (hosted sign-in UI) via the Traditional Web flow: these
  // endpoints drive the OIDC redirect dance and own the opaque `cf_sid` session cookie — tokens
  // stay server-side. See modules/auth.ts + auth/logto.ts.
  app.route('/api/auth', authModule);

  // Container healthcheck (Docker HEALTHCHECK hits :8787/health directly; not exposed via /api).
  app.openapi(healthRoute, (c) => c.json({ ok: true, service: 'chatforge-api', ts: Date.now() }));

  // All app API routes live under /api/* so the web SPA + API can share one origin
  // (Traefik path-routes /api + /ws to the API; the web nginx proxies the same in compose).
  app.route('/api/me', accountModule); // session user, password, profile, passkeys
  app.route('/api/convert', convertModule);
  app.route('/api/conversions', conversionsModule);
  app.route('/api/vault', vaultModule); // saved imported chats (E2E ciphertext only)
  app.route('/api/blobs', blobsModule); // encrypted chat attachments + avatars (object storage)
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
