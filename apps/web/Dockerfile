FROM node:22.23.2-bookworm-slim AS builder

ARG NPM_REGISTRY=https://registry.npmjs.org
ARG NEXT_PUBLIC_API_ORIGIN=http://localhost:4000

ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN

RUN --mount=type=cache,id=repovista-npm,target=/root/.npm,sharing=locked \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 2000 \
  && npm config set fetch-retry-maxtimeout 20000 \
  && npm install --global pnpm@10.30.3

WORKDIR /workspace

COPY . .

RUN --mount=type=cache,id=repovista-pnpm,target=/pnpm/store,sharing=locked \
  pnpm install --frozen-lockfile --filter . --filter @repovista/web...
RUN pnpm --recursive --filter @repovista/web^... --if-present run build:runtime
RUN pnpm --filter @repovista/web build

FROM node:22.23.2-bookworm-slim AS runner

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static

WORKDIR /app/apps/web

USER node

EXPOSE 3000

CMD ["node", "server.js"]
