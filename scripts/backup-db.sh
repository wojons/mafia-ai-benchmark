#!/usr/bin/env bash
# backup-db.sh — daily-safe, self-verifying backup of the mafia-ai-benchmark
# product DB (MAF-GAP-075).
#
# WHY THIS EXISTS
#   The product DB (games, token_usage, events, ...) lives ONLY inside the
#   root-owned Docker volume `mafia-ai-benchmark_data`. Until this script there
#   was no backup, no restore path and no evidence artifact: a lost volume means
#   the irreplaceable payload (real provider spend + every paid LLM run) is gone.
#
# WHAT IT DOES
#   1. Takes a CONSISTENT snapshot of the live DB while the server keeps
#      serving, using the SQLite backup API from inside the container
#      (better-sqlite3). This is a page-level consistent copy, not a file copy:
#      it cannot capture a torn WAL.
#   2. Falls back — only if the in-container path is unavailable — to copying
#      the db + -wal + -shm trio out and consolidating it on the host with
#      `sqlite3 .backup`. The fallback is strictly worse (a trio copied from a
#      live WAL DB is a racy read) and the manifest records which path ran.
#   3. Verifies the published dump: PRAGMA integrity_check must print `ok` and
#      the core tables (games, token_usage, events) must be non-empty. On any
#      failure it retries the whole acquisition once, then fails LOUDLY.
#   4. Writes a manifest JSON next to the dump (sha256, bytes, per-table row
#      counts, capture time, source container/volume, live health at capture).
#   5. Prunes old dumps down to the newest N (default 14), touching ONLY files
#      this script itself names (mafia-YYYYMMDD-HHMMSS.db / .json / .part).
#
# DUMPS ARE NEVER PUBLISHED UNVERIFIED
#   The snapshot is written to `<name>.part`, verified, and only then renamed
#   into place. A half-written or corrupted file can therefore never be mistaken
#   for a restorable backup by restore-drill.sh or by an operator.
#
# USAGE
#   scripts/backup-db.sh                 # normal run (cron-safe, one line of stdout)
#   MAFIA_DB_BACKUP_RETAIN=30 scripts/backup-db.sh
#   MAFIA_DB_BACKUP_METHOD=trio scripts/backup-db.sh   # force the fallback arm
#   MAFIA_DB_BACKUP_DIR=/some/dir scripts/backup-db.sh # alternate destination
#   MAFIA_DB_BACKUP_WAIT_S=0 ...                       # no wait for a down container
#
# EXIT CODES
#   0  published and verified dump (manifest written)
#   2  preflight failure (docker/container/sqlite3/jq/destination unavailable)
#   3  acquisition or verification failed on both attempts
#
# RPO: this is a point-in-time snapshot. Under the documented daily cron the
# recovery point objective is 24h (worst case: everything between the last
# successful run and the loss).
set -Eeuo pipefail

SCRIPT_VERSION="backup-db.sh v1.0.0"

CONTAINER="${MAFIA_DB_CONTAINER:-mafia-ai-benchmark-server-1}"
DB_PATH="${MAFIA_DB_PATH:-/app/data/mafia.db}"
VOLUME_PATH="${MAFIA_DB_VOLUME_PATH:-/var/lib/docker/volumes/mafia-ai-benchmark_data/_data}"
DEST_DIR="${MAFIA_DB_BACKUP_DIR:-/mnt/bulk/hermes-backups/mafia-db}"
HEALTH_URL="${MAFIA_DB_HEALTH_URL:-http://localhost:3004/health}"
RETAIN="${MAFIA_DB_BACKUP_RETAIN:-14}"
# auto (default) = try the in-container SQLite backup API, fall back to the
# trio copy. The forced values exist so both arms can be exercised on demand
# (operators rehearsing a degraded path; tests proving B still works).
METHOD_MODE="${MAFIA_DB_BACKUP_METHOD:-auto}"
case "$METHOD_MODE" in
  auto|api|trio) ;;
  *) printf 'ERROR: MAFIA_DB_BACKUP_METHOD must be auto, api or trio (got %s)\n' "$METHOD_MODE" >&2; exit 2 ;;
esac
# Deliberately OUTSIDE the production volume: the snapshot is bytes we do not
# need to keep in the data dir, and a full volume must not be able to fail a
# backup for lack of space in the very place it is backing up.
CONTAINER_TMP="/tmp/.mafia-backup-$$.db"

# Tables that must be non-empty for a dump to count as a real backup of the
# product payload. Everything else is recorded but not gated: the schema
# legitimately ships empty tables (agent_configs, model_presets, ...) and a
# zero there is not corruption.
CORE_TABLES="games token_usage events"

NAME_RE='^mafia-[0-9]{8}-[0-9]{6}\.db$'

log()  { printf '%s\n' "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit "${2:-3}"; }

WORK_DIR=""
PART_FILE=""

# shellcheck disable=SC2329  # invoked indirectly by the trap below
cleanup() {
  # Best effort, never fatal: a failed run must still publish the real reason.
  if [[ -n "$PART_FILE" ]]; then
    [[ -f "$PART_FILE" ]] && rm -f -- "$PART_FILE"
    rm -f -- "$PART_FILE-wal" "$PART_FILE-shm" 2>/dev/null || true
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi
  docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
command -v docker    >/dev/null 2>&1 || fail "docker not found in PATH" 2
command -v sqlite3   >/dev/null 2>&1 || fail "sqlite3 not found in PATH" 2
command -v jq        >/dev/null 2>&1 || fail "jq not found in PATH (needed for the manifest)" 2
command -v mktemp    >/dev/null 2>&1 || fail "mktemp not found in PATH" 2
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not found in PATH" 2

# The 04:30 daily run can land inside a deploy-refresh recreate window: the
# server container is DOWN for seconds-to-minutes while compose replaces it
# (observed 2026-11-25 09:30Z: instant refusal while the recreate was in
# flight, and no backup that morning). A hard-dying container stays dead, so
# wait a bounded window for it to come back before refusing; both ends stay
# fail-closed. Override with MAFIA_DB_BACKUP_WAIT_S (0 = old behavior).
BACKUP_WAIT_S="${MAFIA_DB_BACKUP_WAIT_S:-300}"
container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" == "true" ]]
}
if ! container_running; then
  log "container '$CONTAINER' not running — waiting up to ${BACKUP_WAIT_S}s for the deploy-refresh recreate to settle"
  waited=0
  while ! container_running && (( waited < BACKUP_WAIT_S )); do
    sleep 30; waited=$((waited + 30))
  done
  container_running \
    || fail "container '$CONTAINER' is not running after ${waited}s — refusing to fake a backup" 2
fi

mkdir -p "$DEST_DIR" || fail "cannot create destination '$DEST_DIR'" 2
[[ -w "$DEST_DIR" ]] || fail "destination '$DEST_DIR' is not writable" 2

# Serialise runs: a second cron tick (or a human) must not interleave with a
# run in progress. The lock file does not match the dump naming pattern, so
# retention can never delete it.
LOCK_FILE="$DEST_DIR/.backup.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "another backup-db.sh run holds $LOCK_FILE — abandoning this run" 2
fi

# ---------------------------------------------------------------------------
# Snapshot acquisition
# ---------------------------------------------------------------------------
NODE_BACKUP_JS=$(cat <<'JS'
const D = require("better-sqlite3");
const src = process.env.MAFIA_SRC;
const dst = process.env.MAFIA_DST;
if (!src || !dst) { console.error("missing MAFIA_SRC/MAFIA_DST"); process.exit(2); }
const db = new D(src, { readonly: true, fileMustExist: true });
db.backup(dst).then(() => { db.close(); console.log("backup-ok"); })
  .catch((e) => { console.error("backup-failed: " + e.message); process.exit(1); });
JS
)

# acquire_snapshot <out-file>; echoes "in-container-sqlite-backup" or
# "host-trio-consolidation" on success.
acquire_snapshot() {
  local out="$1" rc=0

  # --- Path A: SQLite backup API inside the container (preferred) -----------
  if [[ "$METHOD_MODE" == "trio" ]]; then
    log "MAFIA_DB_BACKUP_METHOD=trio — skipping the in-container backup API"
  elif docker exec -w /app/apps/server "$CONTAINER" \
       node -e 'require.resolve("better-sqlite3")' >/dev/null 2>&1; then
    docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
    rc=0
    # Everything the container prints is diverted to a log: this function's
    # stdout carries ONLY the method token, which the caller captures.
    local node_log="$WORK_DIR/acquire-node.log"
    timeout 900 docker exec \
        -e MAFIA_SRC="$DB_PATH" -e MAFIA_DST="$CONTAINER_TMP" \
        -w /app/apps/server "$CONTAINER" node -e "$NODE_BACKUP_JS" >"$node_log" 2>&1 || rc=$?
    if [[ $rc -ne 0 ]]; then
      log "in-container backup exited $rc: $(tr '\n' ' ' <"$node_log" | cut -c1-400)"
    elif docker exec "$CONTAINER" test -s "$CONTAINER_TMP" 2>/dev/null; then
      timeout 900 docker cp "$CONTAINER:$CONTAINER_TMP" "$out" || rc=$?
      docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
      if [[ $rc -eq 0 && -s "$out" ]]; then
        printf '%s' "in-container-sqlite-backup"
        return 0
      fi
    else
      docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true
    fi
    log "WARN: in-container backup API path failed (rc=$rc) — falling back to the db+wal+shm trio copy"
  else
    log "WARN: better-sqlite3 not resolvable in container '$CONTAINER' — falling back to the db+wal+shm trio copy"
  fi

  # --- Path B: trio copy + host-side consolidation ---------------------------
  # Only reached when Path A is unavailable. A trio copied from a live WAL
  # database is a racy read, which is exactly why it is the fallback.
  if [[ "$METHOD_MODE" == "api" ]]; then
    log "MAFIA_DB_BACKUP_METHOD=api — not falling back to the trio copy"
    return 1
  fi
  local trio="$WORK_DIR/trio"
  mkdir -p "$trio"
  docker cp "$CONTAINER:$DB_PATH"      "$trio/" || return 1
  docker cp "$CONTAINER:$DB_PATH-wal"  "$trio/" 2>/dev/null || true
  docker cp "$CONTAINER:$DB_PATH-shm"  "$trio/" 2>/dev/null || true
  local base
  base="$(basename "$DB_PATH")"
  sqlite3 "$trio/$base" ".backup '$out'" || return 1
  [[ -s "$out" ]] || return 1
  printf '%s' "host-trio-consolidation"
}

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
# counts_of <db> -> "table<TAB>count" for every user table, sorted by name.
counts_of() {
  local db="$1" t c
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    c="$(sqlite3 -readonly "$db" "SELECT count(*) FROM \"$t\";")" || return 1
    printf '%s\t%s\n' "$t" "$c"
  done < <(sqlite3 -readonly "$db" \
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
}

# verify_dump <db> <counts-file-out>
verify_dump() {
  local db="$1" counts_out="$2" integrity

  [[ -s "$db" ]] || { log "verify: snapshot is missing or empty ($db)"; return 1; }

  integrity="$(sqlite3 -readonly "$db" 'PRAGMA integrity_check;' 2>&1)" || {
    log "verify: integrity_check failed to run: $integrity"; return 1; }
  if [[ "$integrity" != "ok" ]]; then
    log "verify: integrity_check returned: $integrity"; return 1
  fi

  counts_of "$db" >"$counts_out" || { log "verify: could not read table counts"; return 1; }
  [[ -s "$counts_out" ]] || { log "verify: no user tables found in snapshot"; return 1; }

  local t n
  for t in $CORE_TABLES; do
    n="$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$counts_out")"
    if [[ -z "$n" ]]; then
      log "verify: core table '$t' is absent from the snapshot"; return 1
    fi
    if [[ "$n" -eq 0 ]]; then
      log "verify: core table '$t' has 0 rows — refusing to publish a hollow dump"; return 1
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mafia-backup-XXXXXX")" \
  || fail "cannot create a scratch directory" 2

attempt=0
METHOD=""
DUMP=""
while :; do
  attempt=$((attempt + 1))
  log "attempt $attempt/2: acquiring snapshot of $CONTAINER:$DB_PATH"

  SNAP="$WORK_DIR/snapshot.db"
  rm -f -- "$SNAP" "$WORK_DIR/counts.tsv"

  METHOD="$(acquire_snapshot "$SNAP")" || METHOD=""
  if [[ -z "$METHOD" ]]; then
    log "attempt $attempt: snapshot acquisition failed"
  elif verify_dump "$SNAP" "$WORK_DIR/counts.tsv"; then
    DUMP="$SNAP"
    break
  fi

  if [[ $attempt -ge 2 ]]; then
    fail "backup FAILED: two consecutive attempts produced no verified snapshot (see stderr above). Nothing was published to $DEST_DIR." 3
  fi
  log "retrying once after a failed/invalid snapshot"
  sleep 2
done

# Timestamped publication. Two runs in the same second cannot happen (flock),
# but never silently overwrite an existing dump if one is somehow there.
STAMP=""
FINAL=""
for _ in 1 2 3; do
  STAMP="$(date -u +%Y%m%d-%H%M%S)"
  FINAL="$DEST_DIR/mafia-$STAMP.db"
  [[ -e "$FINAL" ]] || break
  sleep 1
done
[[ ! -e "$FINAL" ]] || fail "refusing to overwrite existing dump $FINAL" 3

MANIFEST="$DEST_DIR/mafia-$STAMP.json"
PART_FILE="$FINAL.part"

cp -- "$DUMP" "$PART_FILE" || fail "could not stage snapshot at $PART_FILE" 3

# Normalise the snapshot to a rollback-journal (non-WAL) database. The SQLite
# backup API preserves the SOURCE journal mode, so the copy would otherwise
# carry `wal` in its header — and any read-only consumer (a drill, an analyst
# with sqlite3) then needs a -shm/-wal sibling to open it, which is exactly the
# multi-file artefact a "single-file backup" must not be. The conversion is a
# header-only change on an already-checkpointed file.
if ! sqlite3 "$PART_FILE" 'PRAGMA journal_mode=DELETE;' >/dev/null; then
  fail "could not normalise $PART_FILE to a single-file (journal_mode=DELETE) database" 3
fi
chmod 0644 "$PART_FILE" 2>/dev/null || true

# Re-verify the staged copy — this is the byte-for-byte object that becomes the
# published dump, so the manifest describes that file and not its source.
if ! verify_dump "$PART_FILE" "$WORK_DIR/published-counts.tsv"; then
  fail "staged copy failed verification — nothing published" 3
fi

BYTES="$(stat -c %s "$PART_FILE")"
SHA="$(sha256sum "$PART_FILE" | awk '{print $1}')"
CAPTURED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

HEALTH_JSON="$(curl -sS -m 5 "$HEALTH_URL" 2>/dev/null | jq -c . 2>/dev/null || true)"
if [[ -z "$HEALTH_JSON" || "$HEALTH_JSON" == "null" ]]; then
  HEALTH_JSON="$(jq -nc --arg url "$HEALTH_URL" '{error: "unreachable", url: $url}')"
  log "WARN: live health probe $HEALTH_URL was unreachable — recorded as such in the manifest (the dump is still valid)"
fi

TABLES_JSON="$(awk -F'\t' '{printf "%s\t%s\n", $1, $2}' "$WORK_DIR/published-counts.tsv" \
  | jq -Rn '[inputs | select(length > 0) | split("\t") | {(.[0]): (.[1] | tonumber)}] | add // {}')" \
  || fail "could not assemble the per-table count object" 3

mv -f -- "$PART_FILE" "$FINAL" || fail "could not publish $FINAL" 3
# A rollback-journal dump has no siblings; anything left over from the staging
# name is residue and must not accumulate next to the published dumps.
rm -f -- "$PART_FILE-wal" "$PART_FILE-shm" "$FINAL-wal" "$FINAL-shm" 2>/dev/null || true

jq -n \
  --arg schema "mafia-db-backup-manifest/v1" \
  --arg dump "$(basename "$FINAL")" \
  --arg sha256 "$SHA" \
  --argjson bytes "$BYTES" \
  --arg captured_at "$CAPTURED_AT" \
  --arg method "$METHOD" \
  --arg container "$CONTAINER" \
  --arg source_db "$DB_PATH" \
  --arg volume "$VOLUME_PATH" \
  --arg health_url "$HEALTH_URL" \
  --argjson health "$HEALTH_JSON" \
  --arg script "$SCRIPT_VERSION" \
  --argjson tables "$TABLES_JSON" \
  '{
     schema: $schema,
     dump: $dump,
     sha256: $sha256,
     bytes: $bytes,
     captured_at: $captured_at,
     snapshot_method: $method,
     source: {container: $container, db_path: $source_db, volume_path: $volume},
     live_health_at_capture: {url: $health_url, response: $health},
     tables: $tables,
     produced_by: $script
   }' >"$MANIFEST" || fail "could not write manifest $MANIFEST" 3

# ---------------------------------------------------------------------------
# Retention — newest $RETAIN dumps; touch NOTHING that does not match our own
# naming pattern (no globs, no wildcards beyond the exact shape).
# ---------------------------------------------------------------------------
PRUNED=0
mapfile -t ALL_DUMPS < <(
  find "$DEST_DIR" -maxdepth 1 -type f -name 'mafia-*.db' -printf '%f\n' 2>/dev/null \
    | grep -E "$NAME_RE" | sort
)
if [[ "${#ALL_DUMPS[@]}" -gt "$RETAIN" ]]; then
  surplus=$(( ${#ALL_DUMPS[@]} - RETAIN ))
  for ((i = 0; i < surplus; i++)); do
    victim="${ALL_DUMPS[$i]}"
    # Belt and braces: the name must still match the exact pattern right before
    # the unlink, so a stray find result can never delete anything else.
    [[ "$victim" =~ $NAME_RE ]] || continue
    rm -f -- "$DEST_DIR/$victim" && PRUNED=$((PRUNED + 1))
    victim_manifest="${victim%.db}.json"
    if [[ "$victim_manifest" =~ ^mafia-[0-9]{8}-[0-9]{6}\.json$ ]]; then
      rm -f -- "$DEST_DIR/$victim_manifest"
    fi
  done
fi

# Abandoned .part files (a killed run) older than 2h.
find "$DEST_DIR" -maxdepth 1 -type f -name 'mafia-????????-??????.db.part' -mmin +120 \
  -exec rm -f -- {} + 2>/dev/null || true

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
GAMES="$(awk -F'\t' '$1=="games"{print $2}' "$WORK_DIR/published-counts.tsv")"
TOKENS="$(awk -F'\t' '$1=="token_usage"{print $2}' "$WORK_DIR/published-counts.tsv")"
EVENTS="$(awk -F'\t' '$1=="events"{print $2}' "$WORK_DIR/published-counts.tsv")"

printf 'BACKUP OK file=%s sha256=%s bytes=%s tables=%s games=%s token_usage=%s events=%s method=%s pruned=%s\n' \
  "$FINAL" "${SHA:0:16}" "$BYTES" "$(wc -l <"$WORK_DIR/published-counts.tsv")" \
  "$GAMES" "$TOKENS" "$EVENTS" "$METHOD" "$PRUNED"

exit 0
