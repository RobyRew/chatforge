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
