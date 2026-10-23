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

if benchmark_runs_json="$(curl -s --max-time 5 http://localhost:3004/api/v1/benchmark/runs 2>/dev/null)"; then
  if command -v jq >/dev/null 2>&1; then
    active_runs_summary="$(jq -r '
      [.data[]? | select(.status == "RUNNING" or .status == "IN_PROGRESS")]
      | [length, (map((.id // "") | tostring) | join(","))]
      | @tsv
    ' <<<"$benchmark_runs_json")"
  elif command -v python3 >/dev/null 2>&1; then
    active_runs_summary="$(python3 -c '
import json
import sys

payload = json.load(sys.stdin)
active = [
    run for run in (payload.get("data") or [])
    if run.get("status") in {"RUNNING", "IN_PROGRESS"}
]
print("{}\t{}".format(
    len(active),
    ",".join(str(run.get("id", "")) for run in active),
))
' <<<"$benchmark_runs_json")"
  else
    echo "deploy-refresh: cannot parse benchmark runs (neither jq nor python3 is available)" >&2
    exit 1
  fi

  IFS=$'\t' read -r active_runs_count active_run_ids <<<"$active_runs_summary"
  if (( active_runs_count > 0 )); then
    echo "deploy-refresh: skipped — ${active_runs_count} active benchmark run(s) detected (ids: ${active_run_ids})" >&2
    exit 0
  fi
else
  echo "deploy-refresh: benchmark run check unavailable — proceeding with rebuild" >&2
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
