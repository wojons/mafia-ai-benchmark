#!/usr/bin/env bash
#
# league-cron.sh — league schedule cron entry point (MAF-INIT-002A).
#
# Plays one scheduled MIXED-MODEL league run against the mafia-ai-benchmark
# server, gated by a client-side daily spend cap, then exports every
# completed game into the per-run JSONL corpus (data/runs/, gitignored).
#
# Usage:
#   league-cron.sh --dry-run   validate the config, print the resolved plan,
#                              exit 0 — NO network request is made.
#   league-cron.sh             real mode: daily-cap gate -> POST /api/v1/league
#                              -> poll to terminal status -> export games.
#
# Wire shapes are mirrored from the server source (read them before editing):
#   apps/server/src/routes/league.ts           request/response envelopes
#   apps/server/src/services/league-runner.ts  TERMINAL_LEAGUE_STATUSES =
#       { COMPLETED, FAILED, CANCELLED, BUDGET_CAPPED }
#
# Cron-safe: no interactive input; every step is logged with timestamps to
# $LEAGUE_LOG (in addition to stdout) so output redirection cannot lose it.
#
# Exit codes:
#   0  dry-run ok | daily cap skip | run COMPLETED / BUDGET_CAPPED
#   1  config invalid | state file corrupt | POST failed | poll timeout |
#      league ended FAILED / CANCELLED
#   2  usage error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ============================== knobs ==============================
LEAGUE_SERVER_URL="${LEAGUE_SERVER_URL:-http://localhost:3004}"
LEAGUE_CONFIG="${LEAGUE_CONFIG:-$REPO_ROOT/scripts/league-schedule.json}"
LEAGUE_STATE_DIR="${LEAGUE_STATE_DIR:-$HOME/.local/state/mafia-league}"
mkdir -p "$LEAGUE_STATE_DIR"
LEAGUE_LOG="${LEAGUE_LOG:-$LEAGUE_STATE_DIR/league-$(date +%F).log}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "usage: $0 [--dry-run]" >&2
      exit 2
      ;;
  esac
done

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LEAGUE_LOG"
}

die() {
  log "ERROR: $*"
  exit 1
}

# ========================= config validation ========================
[ -f "$LEAGUE_CONFIG" ] || die "config not found: $LEAGUE_CONFIG"
jq -e . "$LEAGUE_CONFIG" >/dev/null 2>&1 \
  || die "config is not valid JSON: $LEAGUE_CONFIG"

CONFIG_ERRORS=""
config_check() { # $1 = jq filter, $2 = human label
  if ! jq -e "$1" "$LEAGUE_CONFIG" >/dev/null 2>&1; then
    CONFIG_ERRORS="${CONFIG_ERRORS}  - $2\n"
  fi
}

# Mirrors league-runner.ts validateConfig + the dry-run contract.
config_check '.models | type == "array" and length >= 2 and length == (unique | length)' \
  'models must be an array of >= 2 DISTINCT model specs'
config_check '.numPlayers | type == "number" and . > 0' \
  'numPlayers must be a positive number'
config_check '.numPlayers >= 5 and .numPlayers <= 50' \
  'numPlayers must be 5..50 (server validateConfig bounds)'
config_check '(.models | length) <= (if .numPlayers >= 6 then 5 else 4 end)' \
  'models count exceeds the seat groups a numPlayers game spawns (league-runner.ts seatGroupsFor)'
config_check '.gamesPerRun | type == "number" and . > 0' \
  'gamesPerRun must be a positive number'
config_check '.budgetUsdPerRun | type == "number" and . > 0' \
  'budgetUsdPerRun must be a positive number'
config_check '.dailyCapUsd | type == "number" and . > 0' \
  'dailyCapUsd must be a positive number'
config_check '.pollIntervalS | type == "number" and . > 0' \
  'pollIntervalS must be a positive number'
config_check '.pollTimeoutS | type == "number" and . > 0' \
  'pollTimeoutS must be a positive number'

if [ -n "$CONFIG_ERRORS" ]; then
  log "ERROR: invalid league config ($LEAGUE_CONFIG):"
  printf '%b' "$CONFIG_ERRORS" | tee -a "$LEAGUE_LOG"
  exit 1
fi

# ============================ load config ===========================
MODELS_JSON="$(jq -c '.models' "$LEAGUE_CONFIG")"
NUM_PLAYERS="$(jq -r '.numPlayers' "$LEAGUE_CONFIG")"
GAMES_PER_RUN="$(jq -r '.gamesPerRun' "$LEAGUE_CONFIG")"
BUDGET_USD="$(jq -r '.budgetUsdPerRun' "$LEAGUE_CONFIG")"
DAILY_CAP_USD="$(jq -r '.dailyCapUsd' "$LEAGUE_CONFIG")"
POLL_INTERVAL_S="$(jq -r '.pollIntervalS' "$LEAGUE_CONFIG")"
POLL_TIMEOUT_S="$(jq -r '.pollTimeoutS' "$LEAGUE_CONFIG")"

# Exact POST body shape apps/server/src/routes/league.ts expects.
POST_BODY="$(jq -cn \
  --argjson models "$MODELS_JSON" \
  --argjson g "$GAMES_PER_RUN" \
  --argjson b "$BUDGET_USD" \
  --argjson np "$NUM_PLAYERS" \
  '{config:{models:$models,games:$g,budgetUsd:$b,numPlayers:$np}}')"

MODE_LABEL="real"
[ "$DRY_RUN" = "1" ] && MODE_LABEL="dry-run"

log "league plan ($MODE_LABEL):"
log "  config:          $LEAGUE_CONFIG"
log "  server:          $LEAGUE_SERVER_URL"
log "  models:          $(jq -r '.models | join(", ")' "$LEAGUE_CONFIG")"
log "  numPlayers:      $NUM_PLAYERS"
log "  gamesPerRun:     $GAMES_PER_RUN"
log "  budgetUsdPerRun: $BUDGET_USD"
log "  dailyCapUsd:     $DAILY_CAP_USD"
log "  pollIntervalS:   $POLL_INTERVAL_S"
log "  pollTimeoutS:    $POLL_TIMEOUT_S"
log "  state dir:       $LEAGUE_STATE_DIR"
log "  log file:        $LEAGUE_LOG"
log "  POST body:       $POST_BODY"

if [ "$DRY_RUN" = "1" ]; then
  log "dry-run: validation only — no request was made"
  exit 0
fi

# ============================ real mode =============================
TMP_BODY="$(mktemp)"
TMP_DETAIL="$(mktemp)"
trap 'rm -f "$TMP_BODY" "$TMP_DETAIL"' EXIT

# ---- (a) daily-cap gate --------------------------------------------
SPEND_FILE="$LEAGUE_STATE_DIR/daily-spend.json"
TODAY="$(date +%F)"
spend_usd=0
spend_date=""
if [ -f "$SPEND_FILE" ]; then
  spend_date="$(jq -r '.date // ""' "$SPEND_FILE" 2>/dev/null || true)"
  spend_usd="$(jq -r '.spendUsd // 0' "$SPEND_FILE" 2>/dev/null || true)"
  if ! [[ "$spend_usd" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    die "corrupt daily-spend state file ($SPEND_FILE): unparsable spendUsd — fix or delete it; refusing to guess the cap state"
  fi
fi
if [ "$spend_date" != "$TODAY" ]; then
  spend_usd=0
fi

over_cap="$(awk -v s="$spend_usd" -v b="$BUDGET_USD" -v c="$DAILY_CAP_USD" \
  'BEGIN { print ((s + b) > c) ? 1 : 0 }')"
if [ "$over_cap" = "1" ]; then
  log "SKIP daily cap: spendUsd=$spend_usd + budgetUsdPerRun=$BUDGET_USD would exceed dailyCapUsd=$DAILY_CAP_USD"
  exit 0
fi
log "daily cap gate passed: spendUsd=$spend_usd + budgetUsdPerRun=$BUDGET_USD <= dailyCapUsd=$DAILY_CAP_USD"

# ---- (b) start the league ------------------------------------------
http_code="$(curl -sS --connect-timeout 10 --max-time 60 \
  -o "$TMP_BODY" -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' --data "$POST_BODY" \
  "$LEAGUE_SERVER_URL/api/v1/league")" || die "POST $LEAGUE_SERVER_URL/api/v1/league failed (curl error)"

case "$http_code" in
  2*) log "POST /api/v1/league -> HTTP $http_code" ;;
  *)
    log "ERROR: POST /api/v1/league returned HTTP $http_code"
    log "response body: $(cat "$TMP_BODY")"
    exit 1
    ;;
esac

league_id="$(jq -r '.data.leagueId // empty' "$TMP_BODY")"
[ -n "$league_id" ] || die "POST response carried no data.leagueId: $(cat "$TMP_BODY")"
log "league started: id=$league_id games=$GAMES_PER_RUN models=$MODELS_JSON"

# ---- (c) record the spend upper bound ------------------------------
new_spend="$(awk -v s="$spend_usd" -v b="$BUDGET_USD" 'BEGIN { printf "%.6f", s + b }')"
spend_tmp="$LEAGUE_STATE_DIR/daily-spend.json.tmp.$$"
printf '{"date":"%s","spendUsd":%s}\n' "$TODAY" "$new_spend" > "$spend_tmp"
mv -f "$spend_tmp" "$SPEND_FILE"
log "daily spend recorded: $new_spend of $DAILY_CAP_USD (upper bound; server-side BUDGET_CAPPED gate bounds actual spend)"

# ---- (d) poll to a terminal status ---------------------------------
START_S="$(date +%s)"
DEADLINE=$(( START_S + POLL_TIMEOUT_S ))
STATUS=""
while :; do
  poll_code="$(curl -sS --connect-timeout 10 --max-time 30 \
    -o "$TMP_DETAIL" -w '%{http_code}' \
    "$LEAGUE_SERVER_URL/api/v1/league/$league_id")" || poll_code="000"
  if [[ "$poll_code" == 2* ]]; then
    STATUS="$(jq -r '.data.status.status // ""' "$TMP_DETAIL")"
    log "poll: status=${STATUS:-<unknown>} elapsed=$(( $(date +%s) - START_S ))s"
    case "$STATUS" in
      COMPLETED | FAILED | CANCELLED | BUDGET_CAPPED) break ;;
    esac
  else
    log "WARN: poll GET returned HTTP $poll_code (continuing until deadline)"
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "ERROR: poll timeout after ${POLL_TIMEOUT_S}s — treating league as FAILED"
    exit 1
  fi
  sleep "$POLL_INTERVAL_S"
done
log "league terminal: status=$STATUS"

# Export any terminal status' completed games, then signal outcome:
# COMPLETED / BUDGET_CAPPED are successful endings (BUDGET_CAPPED is the
# league runner's normal stop-when-poor exit); FAILED / CANCELLED are not.
FINAL_RC=0
case "$STATUS" in
  COMPLETED | BUDGET_CAPPED) FINAL_RC=0 ;;
  *) FINAL_RC=1 ;;
esac

# ---- (e) export completed games into data/runs/ --------------------
CLI_DIST="$REPO_ROOT/apps/cli/dist/index.js"
if [ ! -f "$CLI_DIST" ]; then
  log "CLI dist missing ($CLI_DIST) — running pnpm --filter @mafia/cli build"
  (cd "$REPO_ROOT" && pnpm --filter @mafia/cli build) >>"$LEAGUE_LOG" 2>&1 \
    || die "pnpm --filter @mafia/cli build failed"
fi
[ -f "$CLI_DIST" ] || die "CLI dist still missing after build: $CLI_DIST"

# League detail games: only those that finished (completedAt set) without
# an error; the CLI additionally refuses to export a non-ENDED game.
game_ids="$(jq -r '(.data.games // [])[] | select(.completedAt != null and .error == null) | .gameId' "$TMP_DETAIL")"

exported=0
export_failed=0
while IFS= read -r gid; do
  [ -n "$gid" ] || continue
  if (cd "$REPO_ROOT" && node "$CLI_DIST" runs export "$gid" --server "$LEAGUE_SERVER_URL") >>"$LEAGUE_LOG" 2>&1; then
    log "export OK: $gid"
    exported=$((exported + 1))
  else
    log "export FAILED (continuing): $gid"
    export_failed=$((export_failed + 1))
  fi
done <<<"$game_ids"
log "exports: $exported ok, $export_failed failed (appended to data/runs/index.jsonl)"

exit "$FINAL_RC"
