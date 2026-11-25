# Evidence — MAF-GAP-076 (backup cadence vs deploy-refresh recreate window)

Tick: mafia-ai-benchmark-ops-2026-11-25-15-22-20 (fire 2). All live probes on
the canonical checkout ~/wojons/mafia-ai-benchmark, rendered as `~`
where paths appear. Times UTC.

## 1. Failure accounting (backup.log, read 2026-11-25T15:55Z)

`tail -60 /mnt/bulk/hermes-backups/mafia-db/backup.log`:

```
attempt 1/2: acquiring snapshot of mafia-ai-benchmark-server-1:/app/data/mafia.db
BACKUP OK file=/mnt/bulk/hermes-backups/mafia-db/mafia-20261120-093006.db ... tables=18 games=5092
BACKUP OK ... mafia-20261121-093004.db ... tables=18
BACKUP OK ... mafia-20261122-093006.db ... tables=18
WARN: better-sqlite3 not resolvable in container 'mafia-ai-benchmark-server-1' — falling back to the db+wal+shm trio copy    <- 2026-11-23 ~04:30Z? actually 09:30Z window
attempt 1: snapshot acquisition failed
retrying once after a failed/invalid snapshot
attempt 2/2: acquiring snapshot ...
WARN: better-sqlite3 not resolvable ...
attempt 2: snapshot acquisition failed
ERROR: backup FAILED: two consecutive attempts produced no verified snapshot (see stderr above). Nothing was published ...
Killed
BACKUP OK ... mafia-20261124-093011.db ... tables=18
ERROR: container 'mafia-ai-benchmark-server-1' is not running — refusing to fake a backup 2     <- 2026-11-25 09:30Z, deploy-refresh recreate window
```

Failures: 2026-11-23 (better-sqlite3 unresolvable in THAT day's container -> trio
fallback also failed) and 2026-11-25 (instant refusal while the server container
was down in the deploy-refresh recreate window). Two of the last four nightly
runs produced nothing.

## 2. Classification of the 11-23 class (probe-shaped pitfall disclosed)

- WRONG probe shape, 2026-11-25T15:57Z: `docker exec mafia-ai-benchmark-server-1
  node -e "require('better-sqlite3')" -> FAIL: MODULE_NOT_FOUND` — this runs in
  the image WORKDIR and proves nothing about the app.
- CORRECT probe shape (the exact shape scripts/backup-db.sh line 125 uses):
  `docker exec -w /app/apps/server mafia-ai-benchmark-server-1 node -e
  "require.resolve('better-sqlite3'); console.log('OK')"` ->
  `BETTERSQLITE3-RESOLVABLE-APPSERVER`, and `require(...)` -> `REQUIRE-OK` (rc 0).
- Verdict: in TODAY's image (mafia-ai-benchmark-api-build 6627853cc155, built
  2026-11-25 04:58 -05) the in-container backup API path is healthy. The 11-23
  failure is day-transient (that day's container state), not a standing
  regression. No image change needed.

## 3. Fix scripts/backup-db.sh (fire 2 commit)

Preflight hard-fail replaced with a bounded wait before the SAME fail-closed
refusal; env knob `MAFIA_DB_BACKUP_WAIT_S` (default 300s, 0 restores old
behavior, poll every 30s). Doc header usage line added.

RED ARM (absent container, no live service touched), 2026-11-25T15:58Z:
```
MAFIA_DB_CONTAINER=mafia-wait-test-absent MAFIA_DB_BACKUP_WAIT_S=60 \
  MAFIA_DB_BACKUP_DIR=~/.hermes/cache/scratch/mafia-wait-test scripts/backup-db.sh
container 'mafia-wait-test-absent' not running — waiting up to 60s for the deploy-refresh recreate to settle
ERROR: container 'mafia-wait-test-absent' is not running after 60s — refusing to fake a backup 2
rc=2
```
Exit code 2 and the "refusing to fake a backup" contract are preserved; nothing
was published to the (scratch) destination.

GREEN ARM (live container), 2026-11-25T15:59:26Z, full real run:
```
attempt 1/2: acquiring snapshot of mafia-ai-benchmark-server-1:/app/data/mafia.db
BACKUP OK file=/mnt/bulk/hermes-backups/mafia-db/mafia-20261125-155926.db
  sha256=fc11dc55ac833022... bytes=205467648 tables=20 games=5095
  token_usage=25710 events=200649 method=in-container-sqlite-backup pruned=0
rc=0
```
Manifest sha256 (full): fc11dc55ac83302265dfe6f66fdc4d70ba1f5bff949772233522891511b62d09.
Byte-identical to the 15:36Z manual dump (same file hash; DB idle since 11-21 —
same counts repeat across the 11-21/11-22/11-24 dumps), which independently
confirms deterministic acquisition.

`bash -n scripts/backup-db.sh` -> SYNTAX-OK; `shellcheck -S error` -> clean.

## 4. Deploy freshness note

.deploy-stamp reads 7bf220a while origin/main is 2e251e5 — both commits are
board/doc/evidence only; the deploy-refresh cron (*/15) re-stamps on its next
cache-hit pass. Live health measured this fire: `docker ps` shows
mafia-ai-benchmark-server-1 Up 5 hours (healthy), web up.
