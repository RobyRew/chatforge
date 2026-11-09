import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { themeBootstrap } from '@robyrew/web-config/theme-bootstrap';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * The house theme stamp (@robyrew/web-config/theme-bootstrap) has to run before the first paint, so the page and
 * <chat-converter-app> start in the stored or system theme. The package's README inlines it in <head>; ChatForge's
 * CSP (`script-src 'self'`, infra/security-headers.conf) refuses inline scripts, so the same string is served as a
 * file instead: written into the build under a content-hashed name (nginx caches assets as immutable), answered
 * from memory by the dev server, and loaded by a blocking <script src> at the top of <head>.
 */
function themeBootstrapScript(): Plugin {
  const hash = createHash('sha256').update(themeBootstrap).digest('hex').slice(0, 10);
  const fileName = `assets/theme-bootstrap-${hash}.js`;
  return {
    name: 'chatforge:theme-bootstrap',
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(themeBootstrap);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: themeBootstrap });
    },
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: `/${fileName}` }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  plugins: [themeBootstrapScript(), react(), tailwindcss()],
  resolve: {
    // Resolve workspace packages to their TS source (no build step needed in dev).
    // More-specific subpaths must come first.
    alias: [
      // MLS provider for the chat worker (libsodium-free subpath — no sodium alias needed).
      { find: '@chatforge/crypto/mls', replacement: r('../../packages/crypto/src/mls.ts') },
      { find: '@chatforge/types', replacement: r('../../packages/types/src/index.ts') },
    ],
  },
  // @robyrew/chat-converter ships TypeScript source and starts its worker with
  // `new Worker(new URL('../worker/worker.ts', import.meta.url))`. Pre-bundling would move the module
  // and break that relative URL, so it is served as-is (its dependencies are all ESM).
  optimizeDeps: { exclude: ['@robyrew/chat-converter'] },
  worker: { format: 'es' },
  server: {
    port: 4321,
    host: true,
    // Proxy /api (+ /ws) → API server so the session cookie + WebSocket are same-origin in dev (http).
    proxy: {
      '/api': { target: process.env.VITE_API_URL ?? 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: process.env.VITE_API_URL ?? 'http://localhost:8787', ws: true, changeOrigin: true },
    },
  },
});
