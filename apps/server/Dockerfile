# Production Dockerfile for Mafia AI Benchmark Server
# Uses tsx runner to avoid dist path / ESM-CJS module issues
FROM node:22-alpine

# Install build dependencies for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# --- Copy workspace config and package manifests for install ---
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

# --- Install without build scripts (avoids pnpm v11+ build approval) ---
RUN corepack enable && pnpm install --no-frozen-lockfile --ignore-scripts

# --- Rebuild native modules (better-sqlite3 + esbuild for tsx) ---
RUN corepack enable && pnpm rebuild && \
  BSQLITE_DIR=$(ls -d /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 2>/dev/null | head -1) && \
  if [ -n "$BSQLITE_DIR" ]; then \
    cd "$BSQLITE_DIR" && npm run install; \
  fi

# --- Copy source code ---
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
# --- Copy legacy game engine (required by bridge) ---
COPY game-engine.js ./
COPY src/ src/

# --- Build shared package (needed for ESM exports like ./fsm) ---
RUN corepack enable && pnpm --filter=@mafia/shared build

# --- Ensure data directory exists for SQLite ---
RUN mkdir -p /app/data

EXPOSE 3000 3001

# Run with tsx (binary is in apps/server/node_modules/.bin/ in workspace)
CMD ["./apps/server/node_modules/.bin/tsx", "apps/server/src/index.ts"]
