FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --filter anttodo --frozen-lockfile --ignore-scripts
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
COPY supabase/functions/_shared/ai-feature-prompts.ts ./supabase/functions/_shared/ai-feature-prompts.ts
RUN pnpm build:web

FROM nginxinc/nginx-unprivileged:1.29-alpine

USER root
RUN apk add --no-cache jq
COPY deploy/ubuntu/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/ubuntu/render-instance-config.sh /docker-entrypoint.d/05-render-instance-config.sh
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
RUN chmod 0555 /docker-entrypoint.d/05-render-instance-config.sh
USER 101

EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5000/healthz || exit 1
