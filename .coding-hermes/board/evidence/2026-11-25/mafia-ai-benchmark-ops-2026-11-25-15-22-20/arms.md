# DOC-023 — Stage-2.4 teardown race: settled-stop repair, verbatim green proof

Tick: mafia-ai-benchmark-ops-2026-11-25-15-22-20. Measured 2026-11-25 15:35-15:45Z
(10:35-10:45 -05). Repo: /home/kara/wojons/mafia-ai-benchmark, base HEAD at tick start
7bf220ae0946fa37436abe9adb8e165c4101aef7 (== origin/main, `git fetch -q` + rev-parse, no drift).

## Premise re-proven live (red) before touching the doc

The block as written at HEAD, run verbatim against the newest dump
(mafia-db/mafia-20261125-153620.db, backup re-acquired same day after the 09:30Z
cron run refused while the server container was down — fail-closed, by design):

1. Single full Stage-2 run ended with the bare back-to-back teardown:

       docker stop mafia-restore-drill   → rc=0
       docker volume rm mafia_restore_drill → rc=0 (clean this time)

2. Same cycle repeated 6x (create → boot scratch server on :3014 → stop →
   immediate `docker volume rm`):

       attempts=6 reproduced=4
       attempt 5: REPRODUCED rc=1 err=Error response from daemon: remove mafia_restore_drill: volume is in use - [99ea668f...]
       attempt 6: REPRODUCED rc=1 err=Error response from daemon: remove mafia_restore_drill: volume is in use - [15308b7f...]

   4 of 6 cycles fail with the exact daemon error the row names and leave the
   drill volume behind. The row's defect is live, stochastic (daemon side
   settle race after `docker stop` returns), not a one-off measurement.

## Repair (doc-only, no code)

docs/ops/db-backup-restore.md Stage-2 step 4 at HEAD now settles between the
stop and the volume removal (line numbers at this tick in the committed diff):

    docker stop mafia-restore-drill
    docker rm -f mafia-restore-drill 2>/dev/null || true
    until [ -z "$(docker ps -a -q --filter name=mafia-restore-drill)" ]; do sleep 1; done
    docker volume rm mafia_restore_drill

## Green proofs after the fix

1. Verbatim end-to-end Stage-2 (block extracted from the doc with awk, not
   retyped): derived newest dump, volume create + copy, boot on spare :3014,
   health `{"status":"healthy",...}`, counts through the service
   games 5095 | token_usage 25710 | events 200649, settled teardown:
   STAGE2_BLOCK_RC=0, and the post-teardown listing

       docker volume ls -q | grep '^mafia_restore_drill$'

   prints zero rows for the drill name.

2. Stress repeat of the same loop with the settled teardown:

       settled=attempts:6 ok=6 fail=0
       (no drill volume left)

## Stage 1 regression check

    bash scripts/restore-drill.sh
    → DRILL OK: mafia-20261125-153620.db — integrity ok, 20/20 tables match the manifest, sha256 fc11dc55ac833022
      tables compared: 20 mismatches: 0, exit 0

LITERAL DEVIATION, disclosed: criterion 3 says "18/18 tables"; the schema grew
to 20 tables through repo work landed after 2026-11-22, so no current dump can
print 18/18. What the arm protects — every manifest table recounted and
compared row-by-row, zero mismatches — is intact at 20/20. The no-literal-
dump-filename property holds: grep -nE "cp .*mafia-2026[0-9]{4}-[0-9]{6}\.db"
docs/ops/db-backup-restore.md exits 1.

## Live-service safety

The productDB and the running server were never touched: the drill uses its own
`mafia_restore_drill` volume and spare port 3014; localhost:3004 server stayed
healthy throughout (restarts=0). Leftover drill volumes from the red proof were
removed (own residue); the pre-existing `mafia_restore_drill_eval` volume from
an earlier QA battery was deliberately left alone — not this lane's evidence.

## Backup cadence gap (NOT this row; filed here for the foreman's next sweep)

backup.log: Nov 23 backup failed (better-sqlite3 not resolvable → trio-copy
fallback failed twice, "two consecutive attempts produced no verified
snapshot"); Nov 25 09:30Z refused ("container 'mafia-ai-benchmark-server-1' is
not running" — deploy-refresh recreate window at the probe time; fail-closed).
Manual re-run 2026-11-25 15:36Z: BACKUP OK mafia-20261125-153620.db
sha256=fc11dc55ac833022 tables=20 — the Nov 23/25 ledger holes are papered over
only forward; a cron-window collision check for deploy-refresh vs the 04:30
cron is open follow-up work.
