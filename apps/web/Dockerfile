# Production Dockerfile for Mafia AI Benchmark Web UI
# Multi-stage: build with Node, serve with Nginx

# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace config and package manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Build the Vite app
RUN pnpm run build --filter=@mafia/web

# --- Production stage ---
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
