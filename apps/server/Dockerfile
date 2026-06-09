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

# --- Install all dependencies (including dev for tsx) ---
RUN corepack enable && pnpm install --frozen-lockfile

# --- Copy source code ---
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

# --- Ensure data directory exists for SQLite ---
RUN mkdir -p /app/data

EXPOSE 3000 3001

# Run with tsx to handle ESM imports and TypeScript source directly
CMD ["pnpm", "exec", "tsx", "apps/server/src/index.ts"]
