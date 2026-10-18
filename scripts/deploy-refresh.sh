#!/usr/bin/env bash
# deploy-refresh (DF-MAFIA-AI-BENCHMARK-38): rebuild + recreate the docker
# compose stack when the running build predates the current git HEAD.
#
# Mechanism: compares `git rev-parse HEAD` against a stamp file
# (.deploy-stamp, gitignored) that records the sha of the last successful
# rebuild. Drift (or a missing stamp) -> `docker compose build server web` +
# `docker compose up -d server web`, then the stamp is updated.
#
# Exit codes:
#   0  no drift (no-op) or rebuild succeeded
#   1  rebuild failed (stamp is NOT updated — the next run retries)
#
# Idempotent: safe to run repeatedly; a fresh stamp short-circuits before
# docker is touched.
#
# Environment overrides (used by tests / ops):
#   DEPLOY_REFRESH_STAMP   stamp file path (default: <repo>/.deploy-stamp)
#   DEPLOY_REFRESH_DRY_RUN 1 = print the planned actions, execute nothing
#
# See docs/DEPLOY-REFRESH.md for wiring (systemd timer / post-merge hook).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STAMP_FILE="${DEPLOY_REFRESH_STAMP:-$REPO_ROOT/.deploy-stamp}"
DRY_RUN="${DEPLOY_REFRESH_DRY_RUN:-0}"

HEAD_SHA="$(git rev-parse HEAD)" || {
  echo "deploy-refresh: cannot resolve git HEAD (not a repo?)" >&2
  exit 1
}

stamp=""
if [[ -f "$STAMP_FILE" ]]; then
  stamp="$(head -n 1 "$STAMP_FILE" 2>/dev/null | tr -d '[:space:]' || true)"
fi

if [[ "$stamp" == "$HEAD_SHA" ]]; then
  echo "deploy-refresh: stamp matches HEAD ($HEAD_SHA) — no rebuild needed"
  exit 0
fi

if [[ -z "$stamp" ]]; then
  echo "deploy-refresh: no valid stamp in $STAMP_FILE — treating as drifted"
else
  echo "deploy-refresh: drift detected — stamp ${stamp:0:12} != HEAD ${HEAD_SHA:0:12}"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "deploy-refresh: [dry-run] would run: docker compose build server web && docker compose up -d server web"
  exit 0
fi

echo "deploy-refresh: rebuilding server + web from HEAD $HEAD_SHA ..."
docker compose build server web
docker compose up -d server web

printf '%s\n' "$HEAD_SHA" > "$STAMP_FILE"
echo "deploy-refresh: rebuild complete — stamp updated to $HEAD_SHA"
exit 0
