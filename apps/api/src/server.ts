import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { SID_COOKIE } from './auth/logto';
import { createChatGateway } from './chat/gateway';
import { DrizzleChatRepo } from './chat/repo';
import { bootstrap } from './db/bootstrap';
import { loadEnv } from './env';

const env = loadEnv();
const app = createApp();

// Safety net: log unexpected async errors instead of letting them crash the process (which would
// drop every live WebSocket). The chat gateway also guards its own handlers.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('uncaughtException:', err);
});

// Seed built-in roles + the env-defined owner (first run only). Runs after `drizzle-kit migrate`.
void bootstrap();

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`chatforge-api listening on http://localhost:${info.port}`);
});

createChatGateway({
  server: server as unknown as Server,
  repo: new DrizzleChatRepo(),
  authenticate: async (req) => {
    // Same-origin WebSocket → the browser sends the `cf_sid` session cookie on the upgrade request.
    // Resolve it to verified Logto claims, then to the app user id. No token ever lives in client JS.
    const cookie = req.headers.cookie ?? '';
    const sid = cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${SID_COOKIE}=`))
      ?.slice(SID_COOKIE.length + 1);
    if (!sid) return null;
    try {
      const { sessionClaims, appUserIdForSub } = await import('./auth/logto');
      const claims = await sessionClaims(decodeURIComponent(sid));
      return claims ? await appUserIdForSub(claims.sub) : null;
    } catch {
      return null;
    }
  },
});
