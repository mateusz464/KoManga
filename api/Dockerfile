# Multi-stage build for the KoManga API. The native deps (sharp, better-sqlite3)
# compile against the container's architecture — the Mac Mini host is ARM, so
# the build must target arm64, not the dev machine's arch (CLAUDE.md §13).

FROM node:22-bookworm-slim AS base
WORKDIR /app

# All deps (incl. dev) plus the toolchain better-sqlite3 needs to compile its
# native addon. sharp ships prebuilt binaries, so it needs no toolchain.
FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/ using the dev deps.
FROM deps AS build
COPY . .
RUN npm run build

# Production deps only, with native modules rebuilt for the runtime image.
FROM base AS prod-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Slim runtime: just node, prod deps, and the compiled output.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# curl backs the Compose healthcheck (matches the Suwayomi service).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
