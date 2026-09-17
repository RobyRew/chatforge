# ChatForge API (Hono). Build context = repo root (needs workspace packages).
#
# Two stages on purpose. The previous single-stage image ran the TypeScript
# source through tsx and migrated with drizzle-kit at runtime, so it shipped the
# whole dev toolchain — including esbuild's Go binary, whose bundled standard
# library carried 22 HIGH/CRITICAL CVEs in the 2026-09-16 image scan. The build
# stage now bundles the API into two self-contained files and the runtime stage
# carries no node_modules at all: nothing to scan, nothing to exploit.
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install --global npm@11.19.1 --ignore-scripts --no-audit --no-fund
COPY package.json package-lock.json tsconfig.base.json .npmrc ./
COPY packages ./packages
COPY apps ./apps
# --include=dev so esbuild installs even if the build host defaults NODE_ENV=production.
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
 && npm run build --workspace @chatforge/api

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk upgrade --no-cache \
 # npm is not used at runtime; dropping it also drops its own dependency tree from the scan.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
# The migrator resolves the SQL files relative to dist/ (see src/migrate.ts).
COPY --from=build --chown=node:node /app/apps/api/drizzle ./drizzle
USER node
# Production only at *runtime*: disables the API's dev-only bearer-token fallback so prod
# requires a real Logto session cookie.
ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8787/health || exit 1
# Apply pending Drizzle migrations (needs DATABASE_URL), then start the server.
CMD ["sh", "-c", "node dist/migrate.mjs && exec node dist/server.mjs"]
