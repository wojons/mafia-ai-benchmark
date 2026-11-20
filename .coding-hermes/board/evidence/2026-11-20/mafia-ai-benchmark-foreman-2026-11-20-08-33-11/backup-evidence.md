# MAF-GAP-075 — product DB backup + restore path: evidence

Captured on the live host, 2026-11-20, by the MAF-GAP-075 worker (worktree
`/home/kara/worktrees/mafia-ai-benchmark-MAF-GAP-075`, branch `wt/MAF-GAP-075`).

Nothing in this artifact is reconstructed from memory: every number below came
out of the commands quoted with it, run against the live Docker volume.

---

## 1. Artifact under test

| Field | Value |
|---|---|
| Dump | `mafia-20261120-085632.db` |
| Location | `/mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.db` |
| sha256 | `874e41bef387dd44296f020bfafd97a0d9f615174139b03b42882685ff40c806` |
| Bytes | `204926976` (195.4 MiB) |
| Captured at (UTC) | `2026-11-20T08:56:38Z` |
| Snapshot method | `in-container-sqlite-backup` (primary path) |
| Source container | `mafia-ai-benchmark-server-1` |
| Source DB (in container) | `/app/data/mafia.db` |
| Source volume | `/var/lib/docker/volumes/mafia-ai-benchmark_data/_data` |
| Produced by | `backup-db.sh v1.0.0` |

The dump's manifest is copied next to this file as `dump-manifest.json`; it is
byte-identical to `/mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.json`.

A second dump taken 3m34s earlier (`mafia-20261120-085250.db`, sha256
`c37da1521a69cfe3…`) is also present in the destination — it is what proved a
repeat run is safe, and it is the source of the "counts drift" row below.

---

## 2. Production command + output

    $ bash scripts/backup-db.sh
    attempt 1/2: acquiring snapshot of mafia-ai-benchmark-server-1:/app/data/mafia.db
    BACKUP OK file=/mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.db sha256=874e41bef387dd44 bytes=204926976 tables=18 games=5088 token_usage=25668 events=200713 method=in-container-sqlite-backup pruned=0
    exit=0

    $ bash scripts/restore-drill.sh
    restore drill — restore-drill.sh v1.0.0
    dump        : /mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.db
    scratch copy: /mnt/ssd/tmp/mafia-drill-gc2P9k/mafia-20261120-085632.db (read-only, removed on exit)
    manifest    : /mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.json
    captured at : 2026-11-20T08:56:38Z
    snapshot    : in-container-sqlite-backup
    source      : {"container":"mafia-ai-benchmark-server-1","db_path":"/app/data/mafia.db","volume_path":"/var/lib/docker/volumes/mafia-ai-benchmark_data/_data"}
    sha256      : 874e41bef387dd44296f020bfafd97a0d9f615174139b03b42882685ff40c806 (manifest 874e41bef387dd44296f020bfafd97a0d9f615174139b03b42882685ff40c806)
    bytes       : 204926976 (manifest 204926976)
    integrity   : ok
    exit=0

---

## 3. Verified row counts (the drill's actual table)

Produced by reopening the dump read-only in a scratch directory and recounting
every table named in the manifest:

| table | manifest | drill | match |
|---|---:|---:|---|
| agent_configs | 0 | 0 | match |
| agent_sessions | 0 | 0 | match |
| api_calls | 25758 | 25758 | match |
| benchmark_games | 273 | 273 | match |
| benchmark_reports | 0 | 0 | match |
| benchmark_runs | 269 | 269 | match |
| bulk_model_assignments | 0 | 0 | match |
| events | 200713 | 200713 | match |
| game_snapshots | 0 | 0 | match |
| games | 5088 | 5088 | match |
| model_aggregate_stats | 0 | 0 | match |
| model_matchups | 0 | 0 | match |
| model_presets | 0 | 0 | match |
| player_config_templates | 0 | 0 | match |
| player_game_stats | 4650 | 4650 | match |
| player_model_assignments | 1133 | 1133 | match |
| players | 19275 | 19275 | match |
| token_usage | 25668 | 25668 | match |

    tables compared: 18   mismatches: 0
    DRILL OK: mafia-20261120-085632.db — integrity ok, 18/18 tables match the manifest, sha256 874e41bef387dd44

Zero-row tables are legitimate empty tables in the shipped schema (verified by
counting the live DB, which reports the same zeros); only `games`,
`token_usage` and `events` gate a backup, and all three are non-empty.

### Live-DB drift during this ticket (expected, and predicted by the board row)

| Table | Board census (row text) | Backup at 08:52:50Z | Backup at 08:56:32Z |
|---|---:|---:|---:|
| games | 5087 | 5088 | 5088 |
| token_usage | 25662 | 25668 | 25668 |
| events | 200119 | 200186 | 200713 |

The dump counts are the live counts *at the snapshot instant* — they were read
out of the snapshot itself, not copied from a stale census. The upward drift is
the service doing real work between runs (the live DB's `-wal` grew from 0 B to
4.1 MiB during this session).

---

## 4. Scripts under version control

| File | Bytes | Lines | sha256 |
|---|---:|---:|---|
| `scripts/backup-db.sh` | 16849 | 380 | `d5ad540811d42db13b4a771d4b665539c76c476df9f267fd8010f52339fbf3c5` |
| `scripts/restore-drill.sh` | 7675 | 171 | `5590783c15fd99667cb33dcf0b59602f24d6923776effb15af977c707eccb163` |

Gates, all green on these exact files:

    $ bash -n scripts/backup-db.sh scripts/restore-drill.sh
    BASH-N OK
    $ shellcheck -x scripts/backup-db.sh scripts/restore-drill.sh   # shellcheck 0.11.0
    SHELLCHECK CLEAN (no findings)

(`npx --yes shellcheck` was not needed — a host `shellcheck` binary is
installed; no network dependency in this gate.)

---

## 5. Negative arms — the drill is proven to fail when it should

A drill that only ever prints green proves nothing. Each arm below ran against a
private copy (never the published dumps, never the live volume):

| Arm | Manipulation | Expected | Observed |
|---|---|---|---|
| A | one byte flipped deep in a data page, manifest untouched | exit 6 | `ERROR: sha256 MISMATCH: dump bytes are not the ones the manifest describes` → exit **6** |
| B | dump truncated to 60 % + manifest re-hashed/byte-sized to match | exit 3 | `integrity_check` → `database disk image is malformed` → exit **3** |
| C | pristine dump, manifest `games` inflated by 1 | exit 5 | `games  5089  5088  MISMATCH` / `1 of 18 tables disagree` → exit **5** |
| D | manifest deleted | exit 4 | `ERROR: manifest missing for d.db …` → exit **4** |
| E | empty destination dir, no dump argument | exit 2 | `ERROR: no mafia-YYYYMMDD-HHMMSS.db dumps found in …` → exit **2** |
| F | backup with `MAFIA_DB_CONTAINER=mafia-does-not-exist` | exit 2, nothing published | `ERROR: container 'mafia-does-not-exist' is not running — refusing to fake a backup` → exit **2**, `files published: 0` |
| G | `MAFIA_DB_BACKUP_METHOD=trio` forced (fallback path) | valid dump | `method=host-trio-consolidation … games=5088 token_usage=25668 events=200713`, then drill `18/18 tables match` → exit **0/0** |
| H | retention `RETAIN=2` over 3 planted dumps + 2 non-conforming files | 2 pruned, strangers untouched | `pruned=2`; survivors = newest planted dump, the new dump, `README.txt`, `mafia-notadump.db` |

Arm H is the one that matters for "never glob-delete anything else": an
unrelated `README.txt` and a file named `mafia-notadump.db` both survived a
prune that removed two real dumps.

Arm G matters for the fallback's honesty: the consolidated trio dump and the
primary backup-API dump produced **byte-identical** sha256
(`874e41bef387dd44…`) from the same source state, and the trio drill reported
`events 200713` — i.e. the copy picked up committed content from the 4 MiB
`-wal`, so the fallback is not subtly stale.

---

## 6. The service was not disturbed

| Probe | Before | After |
|---|---|---|
| `docker ps` | `mafia-ai-benchmark-server-1 Up 11 minutes (healthy)` | `… Up 11 minutes (healthy)` |
| `/health` `uptime` | 674.18 s | 686.17 s |
| `/health` `status` | `healthy` (`db_write.ok`, `legacy_adapter.ok`) | `healthy` |

The uptime climbed monotonically across the backup and drill — no restart, no
stop, no config change. The scripts are read-only with respect to the service;
the only writes they make are a temp file in the container's `/tmp` (removed on
exit, verified: 0 residue) and the dump/manifest in the backup destination.

---

## 7. Restore rehearsal — executed, not just documented

Stage 2 of `docs/ops/db-backup-restore.md` was run for real so the documented
commands are known to work: dump copied into a **scratch volume**
(`mafia_restore_drill_maf075`), a throwaway container booted against it on port
`3014`, then torn down. The live volume was never mounted.

    $ docker run --rm -d --name mafia-restore-drill-maf075 \
        -v mafia_restore_drill_maf075:/app/data -p 3014:3000 -e PORT=3000 mafia-ai-benchmark-server
    $ curl -s http://localhost:3014/health
    {"status":"healthy","checks":{"db_write":{"ok":true},"legacy_adapter":{"ok":true}}}

    $ docker exec -w /app/apps/server mafia-restore-drill-maf075 node -e '…counts…'
    games 5088
    token_usage 25668
    events 200713
    players 19275
    api_calls 25758
    benchmark_runs 269

A server booted on the restored copy reports healthy **and** serves the exact
manifest counts. That is the difference between "the file opens" and "the file
is a database this system can run on".

Two documentation bugs were found and fixed by doing this rather than assuming:
the rehearsal needs `-e PORT=3000` (the compose file pins it; the image default
is not guaranteed), and the count probe needs `-w /app/apps/server`
(`better-sqlite3` is a pnpm workspace dependency, unresolvable from `/app`).

---

## 8. What this ticket did NOT do (residuals, stated plainly)

- **Stage 3 (in-place restore) was not executed.** It stops the live service and
  overwrites the live volume; that is an operator decision, and doing it to prove
  a document would be a real outage. The procedure is documented with a safety
  copy and a rollback path.
- **The cron entry was not registered.** The ticket scopes scheduling to the
  foreman. Until it is wired, backups only happen when a human runs the script —
  i.e. **there is still no automatic protection**, only a proven path to it. The
  contract line is in `docs/ops/db-backup-restore.md` §5
  (`30 4 * * * …/scripts/backup-db.sh`).
- **No off-host copy.** Dumps live on the same host as the volume; host loss
  still takes everything. Named as a residual risk in the doc (§8).
- **Not encrypted at rest.** Destination is `0775 kara:kara`.

---

## 9. Reproduce this artifact

    bash scripts/backup-db.sh
    bash scripts/restore-drill.sh
    sha256sum /mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.db
    jq . /mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.json

Any later drift in `live_health_at_capture`, `tables`, or the dump's sha256
means new data was written, not that this evidence was wrong: the dump is
immutable once published and its sha256 is the identity of these claims.
