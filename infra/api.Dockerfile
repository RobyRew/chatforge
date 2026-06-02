# ChatForge API (Hono). Build context = repo root (needs workspace packages).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* tsconfig.base.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm install --no-audit --no-fund --no-package-lock \
  && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8787/health || exit 1
# Apply pending Drizzle migrations (needs DATABASE_URL), then start the server.
CMD ["sh", "-c", "npm run db:migrate --workspace @chatforge/api && npm run start --workspace @chatforge/api"]
