# syntax=docker/dockerfile:1.7
# Velocity - single image for the `app` (and optional `worker`) service.
# Multi-stage: deps -> build -> prune -> runtime. Debian (glibc) base so the
# prebuilt sharp / @node-rs/argon2 binaries match.

ARG NODE_VERSION=22
ARG PNPM_VERSION=11.23.0

# ---------------------------------------------------------------- deps
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# Manifests only, so this layer is cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/events/package.json packages/events/package.json
COPY packages/graphql/package.json packages/graphql/package.json
COPY packages/importers/package.json packages/importers/package.json
COPY packages/mcp-tools/package.json packages/mcp-tools/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/services/package.json packages/services/package.json
COPY packages/tokens/package.json packages/tokens/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile \
 && pnpm install --offline --frozen-lockfile

# --------------------------------------------------------------- build
FROM deps AS server-build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm turbo run build --filter=@velocity/server

FROM server-build AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm turbo run build --filter=@velocity/web

# --------------------------------------------------------------- prune
# Production-only node_modules for the server. Workspace packages are bundled
# into dist/main.js by esbuild, so only real npm dependencies are needed.
FROM server-build AS prune
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @velocity/server deploy --prod --legacy /out

# ------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS server-runtime

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="Velocity" \
      org.opencontainers.image.description="Open-source, self-hostable issue tracker" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/saadiqhorton/velocity" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

# tini (PID 1) + pg_dump 16 from the PGDG repo (Debian bookworm ships 15).
# VELOCITY_BACKUP_BEFORE_MIGRATE=1 needs a pg_dump that matches the server.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg tini; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-16; \
    apt-get purge -y --auto-remove curl gnupg; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version

# Non-root user (uid/gid 10001) and writable data dir.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data/uploads /data/exports /data/backups \
 && chown -R 10001:10001 /data

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web-dist \
    UPLOAD_DIR=/data/uploads \
    EXPORT_DIR=/data/exports \
    BACKUP_DIR=/data/backups

WORKDIR /app
COPY --from=prune /out/package.json ./package.json
COPY --from=prune /out/node_modules ./node_modules
COPY --from=server-build /repo/apps/server/dist ./dist

USER 10001:10001
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# The default release target always includes the real web build. The server-runtime
# target permits independent API/backup verification while frontend work continues.
FROM server-runtime AS runtime
COPY --from=build /repo/apps/web/dist ./web-dist
