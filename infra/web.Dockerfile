# Multi-stage build for the Vite SPA. Build context = repo root (needs workspace packages).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm install --no-audit --no-fund --no-package-lock
RUN npm run build --workspace @chatforge/web

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
