#!/bin/bash
# Cron/timer wrapper for deploy-refresh (DF-MAFIA-AI-BENCHMARK-38).
#
# Entry point for scheduled invocations:
#   - systemd user timer mafia-deploy-refresh.timer (installed on this host,
#     hourly backstop — see docs/DEPLOY-REFRESH.md)
#   - any external scheduler / cron that wants a stable working directory
#
# Exit 0 = success (no-op on fresh stamp counts as success).
# Non-zero = rebuild failed (stamp left untouched; next run retries).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Docker Compose needs the compose file's directory; keep stdout line-based so
# cron logs and systemd journal entries stay greppable.
exec bash scripts/deploy-refresh.sh
