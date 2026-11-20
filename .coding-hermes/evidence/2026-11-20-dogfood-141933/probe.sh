#!/usr/bin/env bash
# Perf probe for /api/v1/stats hot path (read-only, runs on a COPY of the dump).
set -u
DB="${1:?usage: probe.sh <copy.db>}"
DEG="(CASE
    WHEN g.status != 'ENDED' THEN NULL
    WHEN COALESCE(json_extract(g.config, '$.degenerate'), 0) = 1 THEN 1
    WHEN (
      SELECT COUNT(*) FROM events e WHERE e.game_id = g.id AND e.type = 'AGENT_SAYS_BROADCASTED'
        AND (COALESCE(json_extract(e.data, '$.says'), '') != '' OR COALESCE(json_extract(e.data, '$.statement'), '') != ''
             OR COALESCE(json_extract(e.data, '$.message'), '') != '')
    ) = 0
    AND (SELECT COUNT(*) FROM events e WHERE e.game_id = g.id AND e.type = 'AGENT_SAYS_BROADCASTED') >= 3
    AND g.duration IS NOT NULL AND g.duration < 120000
    THEN 1 ELSE 0 END)"
MOCK="(CASE WHEN g.status != 'ENDED' THEN NULL WHEN COALESCE(json_extract(g.config, '$.mock'), 0) = 1 THEN 1 ELSE 0 END)"
FILT="AND COALESCE(($DEG), 0) = 0
       AND COALESCE(($MOCK), 0) = 0"

run() { # label sql
  local label="$1"; local sql="$2"
  local out
  out=$( { /usr/bin/time -f '%e' sqlite3 -readonly "$DB" "$sql" ; } 2>&1 )
  local wall; wall=$(echo "$out" | tail -1)
  local val; val=$(echo "$out" | head -1)
  printf '%-28s wall=%-8s result=%s\n' "$label" "$wall" "$val"
}

echo "DB=$DB"
run "total"        "SELECT COUNT(*) FROM games;"
run "active"       "SELECT COUNT(*) FROM games WHERE status = 'IN_PROGRESS';"
run "completed"    "SELECT COUNT(*) FROM games WHERE status = 'ENDED';"
run "failed"       "SELECT COUNT(*) FROM games WHERE status NOT IN ('IN_PROGRESS','ENDED');"
run "avgDuration"  "SELECT AVG(duration) FROM games WHERE status = 'ENDED' AND duration IS NOT NULL;"
run "mafiaWins"    "SELECT COUNT(*) FROM games g WHERE winner = 'MAFIA' $FILT;"
run "townWins"     "SELECT COUNT(*) FROM games g WHERE winner = 'TOWN' $FILT;"
run "degenerate"   "SELECT COUNT(*) FROM games g WHERE g.status='ENDED' AND COALESCE(($DEG),0)=1;"
run "mock"         "SELECT COUNT(*) FROM games g WHERE g.status='ENDED' AND COALESCE(($MOCK),0)=1;"
echo "--- sum check: nine separate prepared statements = one getGameStats() call ---"
