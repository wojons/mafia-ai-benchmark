#!/usr/bin/env bash
# restore-drill.sh — prove a dump is restorable, without going near the live DB
# (MAF-GAP-075).
#
# A backup nobody has opened is a hypothesis. This drill answers the only
# question that matters at 3am: can this file be opened, does it pass SQLite's
# integrity check, and does it contain the rows its manifest claims?
#
# SAFETY CONTRACT
#   - The dump is COPIED into a private mktemp scratch directory and reopened
#     there, read-only. The live volume, the live DB and the running service are
#     never touched, opened for write, or restarted by this script.
#   - Nothing is written outside the scratch dir (removed on exit).
#
# USAGE
#   scripts/restore-drill.sh                # newest dump in the destination dir
#   scripts/restore-drill.sh <dump.db>      # a specific dump
#   MAFIA_DB_BACKUP_DIR=/some/dir scripts/restore-drill.sh
#
# CHECKS
#   1. dump bytes present, sha256 matches the manifest's sha256
#   2. PRAGMA integrity_check == ok (on the scratch copy we actually reopen)
#   3. every table in the manifest is recounted and compared row-by-row
#
# EXIT CODES
#   0  integrity ok AND every manifest count matched
#   2  preflight/usage (no dumps, missing sqlite3/jq, unreadable dump)
#   3  integrity_check failed
#   4  manifest missing or unreadable
#   5  row-count mismatch
#   6  sha256/byte size does not match the manifest
set -Eeuo pipefail

SCRIPT_VERSION="restore-drill.sh v1.0.0"

DEST_DIR="${MAFIA_DB_BACKUP_DIR:-/mnt/bulk/hermes-backups/mafia-db}"
NAME_RE='^mafia-[0-9]{8}-[0-9]{6}\.db$'

fail() { printf 'ERROR: %s\n' "$*" >&2; exit "${2:-2}"; }

SCRATCH=""
# shellcheck disable=SC2329  # invoked indirectly by the trap below
cleanup() {
  if [[ -n "$SCRATCH" && -d "$SCRATCH" ]]; then rm -rf -- "$SCRATCH"; fi
}
trap cleanup EXIT INT TERM

command -v sqlite3   >/dev/null 2>&1 || fail "sqlite3 not found in PATH"
command -v jq        >/dev/null 2>&1 || fail "jq not found in PATH (needed to read the manifest)"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not found in PATH"
command -v mktemp    >/dev/null 2>&1 || fail "mktemp not found in PATH"

# ---------------------------------------------------------------------------
# Resolve which dump to drill
# ---------------------------------------------------------------------------
DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  [[ -d "$DEST_DIR" ]] || fail "destination '$DEST_DIR' does not exist and no dump was given"
  # Newest by the script's own naming pattern (the date sorts lexicographically).
  # `|| true` is load-bearing: with `set -o pipefail`, a grep that matches
  # nothing would otherwise abort the script with a bare exit 1 and no message.
  NEWEST="$(
    find "$DEST_DIR" -maxdepth 1 -type f -name 'mafia-*.db' -printf '%f\n' 2>/dev/null \
      | grep -E "$NAME_RE" | sort | tail -1 || true
  )"
  [[ -n "$NEWEST" ]] || fail "no mafia-YYYYMMDD-HHMMSS.db dumps found in $DEST_DIR"
  DUMP="$DEST_DIR/$NEWEST"
fi

[[ -f "$DUMP" ]] || fail "dump not found: $DUMP"
[[ -r "$DUMP" ]] || fail "dump is not readable: $DUMP"

DUMP_NAME="$(basename "$DUMP")"
MANIFEST="${DUMP%.db}.json"
[[ -f "$MANIFEST" ]] \
  || fail "manifest missing for $DUMP_NAME (expected $MANIFEST) — cannot prove row counts without it" 4
jq -e '.tables | type == "object"' "$MANIFEST" >/dev/null 2>&1 \
  || fail "manifest $MANIFEST has no usable .tables object" 4

# ---------------------------------------------------------------------------
# Reopen a COPY in scratch, read-only. The live path is never reopened.
# ---------------------------------------------------------------------------
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/mafia-drill-XXXXXX")" || fail "cannot create a scratch directory"
COPY="$SCRATCH/$DUMP_NAME"
cp -- "$DUMP" "$COPY" || fail "could not copy the dump into scratch"
chmod 0400 "$COPY" 2>/dev/null || true

# 1. Manifest identity: the bytes we just reopened must be the bytes described.
EXPECTED_SHA="$(jq -r '.sha256 // empty' "$MANIFEST")"
ACTUAL_SHA="$(sha256sum "$COPY" | awk '{print $1}')"
EXPECTED_BYTES="$(jq -r '.bytes // empty' "$MANIFEST")"
ACTUAL_BYTES="$(stat -c %s "$COPY")"

printf 'restore drill — %s\n' "$SCRIPT_VERSION"
printf 'dump        : %s\n' "$DUMP"
printf 'scratch copy: %s (read-only, removed on exit)\n' "$COPY"
printf 'manifest    : %s\n' "$MANIFEST"
printf 'captured at : %s\n' "$(jq -r '.captured_at // "unknown"' "$MANIFEST")"
printf 'snapshot    : %s\n' "$(jq -r '.snapshot_method // "unknown"' "$MANIFEST")"
printf 'source      : %s\n' "$(jq -rc '.source // {}' "$MANIFEST")"
printf 'sha256      : %s (manifest %s)\n' "$ACTUAL_SHA" "${EXPECTED_SHA:-<absent>}"
printf 'bytes       : %s (manifest %s)\n' "$ACTUAL_BYTES" "${EXPECTED_BYTES:-<absent>}"

if [[ -z "$EXPECTED_SHA" ]]; then
  fail "manifest records no sha256 — cannot prove the dump is the one that was verified" 6
fi
if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  fail "sha256 MISMATCH: dump bytes are not the ones the manifest describes" 6
fi
if [[ -n "$EXPECTED_BYTES" && "$EXPECTED_BYTES" != "$ACTUAL_BYTES" ]]; then
  fail "byte-size MISMATCH: dump is $ACTUAL_BYTES bytes, manifest says $EXPECTED_BYTES" 6
fi

# 2. SQLite integrity, on the reopened copy only.
INTEGRITY="$(sqlite3 -readonly "$COPY" 'PRAGMA integrity_check;' 2>&1)" || {
  printf 'integrity   : ERROR running PRAGMA integrity_check\n%s\n' "$INTEGRITY"
  exit 3
}
printf 'integrity   : %s%s\n' "$INTEGRITY" "$([[ "$INTEGRITY" == "ok" ]] && printf '' || printf '  <-- FAILED')"
[[ "$INTEGRITY" == "ok" ]] || fail "PRAGMA integrity_check did not return ok" 3

# 3. Row-by-row comparison against the manifest.
count_in() { sqlite3 -readonly "$COPY" "SELECT count(*) FROM \"$1\";"; }

MISMATCHES=0
COMPARED=0
printf '\n%-34s %10s %10s  %s\n' "table" "manifest" "drill" "match"
printf '%s\n' "----------------------------------------------------------------------"
while IFS=$'\t' read -r table expected; do
  [[ -z "$table" ]] && continue
  COMPARED=$((COMPARED + 1))
  if actual="$(count_in "$table" 2>/dev/null)"; then
    if [[ "$actual" == "$expected" ]]; then
      printf '%-34s %10s %10s  %s\n' "$table" "$expected" "$actual" "match"
    else
      printf '%-34s %10s %10s  %s\n' "$table" "$expected" "$actual" "MISMATCH"
      MISMATCHES=$((MISMATCHES + 1))
    fi
  else
    printf '%-34s %10s %10s  %s\n' "$table" "$expected" "-" "MISSING"
    MISMATCHES=$((MISMATCHES + 1))
  fi
done < <(jq -r '.tables | to_entries | sort_by(.key)[] | [.key, (.value | tostring)] | @tsv' "$MANIFEST")

printf '%s\n' "----------------------------------------------------------------------"
printf 'tables compared: %s   mismatches: %s\n' "$COMPARED" "$MISMATCHES"

# Tables in the dump that the manifest does not mention are not a restore
# failure (the manifest is authoritative for what was captured), but they are
# worth naming so a manifest bug cannot hide behind a green drill.
EXTRA="$(
  comm -13 \
    <(jq -r '.tables | keys[]' "$MANIFEST" | sort) \
    <(sqlite3 -readonly "$COPY" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" | sort) \
    2>/dev/null || true
)"
if [[ -n "$EXTRA" ]]; then
  printf 'note: tables present in the dump but absent from the manifest (not compared): %s\n' \
    "$(printf '%s' "$EXTRA" | tr '\n' ' ')"
fi

if [[ "$COMPARED" -eq 0 ]]; then
  fail "manifest listed no tables — nothing was actually compared" 4
fi
if [[ "$MISMATCHES" -ne 0 ]]; then
  fail "DRILL FAILED: $MISMATCHES of $COMPARED tables disagree with the manifest" 5
fi

printf 'DRILL OK: %s — integrity ok, %s/%s tables match the manifest, sha256 %s\n' \
  "$DUMP_NAME" "$COMPARED" "$COMPARED" "${ACTUAL_SHA:0:16}"
exit 0
