FROM node:22.23.2-bookworm-slim AS builder

ARG NPM_REGISTRY=https://registry.npmjs.org

ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN --mount=type=cache,id=repovista-npm,target=/root/.npm,sharing=locked \
  npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 2000 \
  && npm config set fetch-retry-maxtimeout 20000 \
  && npm install --global pnpm@10.30.3

WORKDIR /workspace

COPY . .

RUN --mount=type=cache,id=repovista-pnpm,target=/pnpm/store,sharing=locked \
  pnpm install --frozen-lockfile --filter . --filter @repovista/api...
RUN pnpm --recursive --filter @repovista/api... --if-present run build:runtime
RUN --mount=type=cache,id=repovista-pnpm,target=/pnpm/store,sharing=locked \
  pnpm --config.inject-workspace-packages=true \
  --filter @repovista/api deploy --prod /opt/repovista-api

FROM node:22.23.2-bookworm-slim AS runner

ENV APP_ENV=production
ENV API_PORT=4000
ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder --chown=node:node /opt/repovista-api ./

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
