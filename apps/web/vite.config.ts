import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Resolve workspace packages to their TS source (no build step needed in dev).
    // More-specific subpaths must come first.
    alias: [
      { find: '@chatforge/core/worker', replacement: r('../../packages/core/src/worker.ts') },
      { find: '@chatforge/core/transforms', replacement: r('../../packages/core/src/transforms.ts') },
      { find: '@chatforge/core/richtext', replacement: r('../../packages/core/src/richtext.ts') },
      { find: '@chatforge/core', replacement: r('../../packages/core/src/index.ts') },
      // MLS provider for the chat worker (libsodium-free subpath — no sodium alias needed).
      { find: '@chatforge/crypto/mls', replacement: r('../../packages/crypto/src/mls.ts') },
      { find: '@chatforge/types', replacement: r('../../packages/types/src/index.ts') },
    ],
  },
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
