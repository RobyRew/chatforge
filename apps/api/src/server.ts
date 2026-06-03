import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app';
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
    const cookie = req.headers.cookie;
    if (!cookie || !cookie.includes('better-auth')) return null;
    const { auth } = await import('./auth');
    const headers = new Headers();
    headers.set('cookie', cookie);
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ?? null;
  },
});
