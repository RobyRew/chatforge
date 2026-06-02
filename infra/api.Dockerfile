# ChatForge API (Hono). Build context = repo root (needs workspace packages).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm install --no-audit --no-fund --no-package-lock \
  && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8787/health || exit 1
CMD ["npm", "run", "start", "--workspace", "@chatforge/api"]
