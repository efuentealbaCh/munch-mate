# syntax=docker/dockerfile:1
# Shared image for the NestJS apps. Build from the repo root:
#   docker build -f infra/docker/nest.Dockerfile --build-arg APP=api .
ARG NODE_IMAGE=node:24.21.0-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.9.1
WORKDIR /repo

FROM base AS build
ARG APP
# Fetch dependencies from the lockfile alone, so this layer is cached until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@app/${APP}..."
RUN pnpm --filter "@app/${APP}..." build
# Production-only node_modules plus dist/, with workspace packages copied in (no symlinks).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "@app/${APP}" deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
