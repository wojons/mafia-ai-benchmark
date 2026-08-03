# Production Dockerfile for Mafia AI Benchmark Web UI
# Multi-stage: build with Node, serve with Nginx

# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace config and package manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

# Install dependencies (using --ignore-scripts to avoid pnpm v11+ build approval)
RUN corepack enable && pnpm install --no-frozen-lockfile --ignore-scripts

# Rebuild native modules (esbuild needed for vite)
RUN corepack enable && pnpm rebuild

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Build shared package (needed for ESM exports)
RUN corepack enable && pnpm --filter=@mafia/shared build

# Build the Vite app (use vite build directly to avoid tsc type errors in dev code)
# API/WS base URLs come from build args — default to nginx-proxy-relative paths
# so the bundle works behind the web container's nginx (host :3000 is owned by
# the DuckBrain HTTP daemon, not the mafia server).
ARG VITE_API_URL=/api/v1
ARG VITE_WS_URL=/ws
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN corepack enable && cd /app/apps/web && pnpm exec vite build

# --- Production stage ---
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
