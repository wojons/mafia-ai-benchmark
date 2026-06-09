#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CI=true pnpm run build
PORT=3099 DB_PATH=./data/test-smoke.db node apps/server/dist/apps/server/src/index.js &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT
for i in {1..30}; do curl -sf http://localhost:3099/health >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://localhost:3099/health | grep -q healthy
curl -sf -X POST http://localhost:3099/api/v1/games -H 'Content-Type: application/json' -d '{}' >/dev/null
curl -sf http://localhost:3099/api/v1/games >/dev/null
curl -sf http://localhost:3099/api/v1/models >/dev/null
kill $PID; wait $PID 2>/dev/null; trap - EXIT
echo "✅ E2E smoke test passed"
