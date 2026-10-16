#!/usr/bin/env bash
# Deploy-refresh: rebuild + recreate containers if they predate HEAD.
# Idempotent: does nothing if containers are already fresh.
# Exit 0 in all cases (even when no containers exist).
set -euo pipefail
cd "$(dirname "$0")/.."

REBUILD=0

HEAD_TS=$(git log -1 --format='%ct')
NOW_TS=$(date +%s)

for service in server web; do
  container_name="mafia-ai-benchmark-${service}-1"
  # Check if container exists and is running
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container_name"; then
    echo "[$service] container not running — skipping (compose up expected to start it)"
    continue
  fi

  # Container created timestamp (when this container was (re)created)
  created=$(docker inspect --format '{{.Created}}' "$container_name" 2>/dev/null)
  if [ -z "$created" ]; then
    echo "[$service] cannot inspect container — skipping"
    continue
  fi

  # Parse ISO created to epoch seconds
  container_ts=$(date -d "$created" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%S.%NZ' "$created" +%s 2>/dev/null || echo 0)

  # Allow a 60s grace window for container startup during rebuild
  grace=$((NOW_TS - 60))

  if [ "$container_ts" -lt "$HEAD_TS" ] && [ "$container_ts" -lt "$grace" ]; then
    echo "[$service] container ($created) predates HEAD ($HEAD_TS) — rebuild needed"
    REBUILD=1
  else
    echo "[$service] container ($created) >= HEAD ($HEAD_TS) — fresh"
  fi
done

if [ "$REBUILD" -eq 0 ]; then
  echo "All containers fresh — no rebuild needed"
  exit 0
fi

echo "Rebuilding and recreating stale containers..."
docker compose build --quiet server web 2>/dev/null || docker compose build server web
docker compose up -d server web --quiet-pull
echo "Deploy refresh complete — containers rebuilt from HEAD"
exit 0
