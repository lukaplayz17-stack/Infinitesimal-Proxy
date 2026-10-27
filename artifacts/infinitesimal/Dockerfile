FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/infinitesimal/package.json artifacts/infinitesimal/package.json

RUN pnpm install --filter @workspace/infinitesimal --frozen-lockfile

COPY artifacts/infinitesimal artifacts/infinitesimal

RUN pnpm --filter @workspace/infinitesimal run check

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "artifacts/infinitesimal/server/index.mjs"]
