import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// libsodium-wrappers-sumo ships a broken ESM build: its `./libsodium-sumo.mjs` import points
// to a file that actually lives in the separate `libsodium-sumo` package. The CJS build is
// correct, so resolve to it and let Vite inline it. (Apps that use crypto need the same alias.)
const sodiumCjs = fileURLToPath(
  new URL('../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: { 'libsodium-wrappers-sumo': sodiumCjs },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: ['libsodium-wrappers-sumo', 'libsodium-sumo'] } },
  },
});
