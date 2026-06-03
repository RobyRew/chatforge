import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@chatforge/core': r('../../packages/core/src/index.ts'),
      '@chatforge/types': r('../../packages/types/src/index.ts'),
      // CH-3: import the MLS provider only (libsodium-free subpath — no sodium alias needed here).
      '@chatforge/crypto/mls': r('../../packages/crypto/src/mls.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
