# Product DB backup + restore

The product database is the only irreplaceable asset this project owns: every
benchmark game, every player, and every row of real provider spend
(`token_usage`). It lives **only** inside a root-owned Docker volume. Until
MAF-GAP-075 there was no backup script, no restore path, no retention policy and
no evidence artifact — a `docker volume rm`, a disk failure or a bad migration
would have destroyed the dataset with no way back.

This document is the operator contract for that path: where the data lives, how
a dump is produced and proven, how old dumps are pruned, and — the part that is
always missing until the day it matters — how to actually restore one.

Scripts:

| Script | Purpose |
|---|---|
| `scripts/backup-db.sh` | produce + verify a consistent single-file dump, write its manifest, prune old dumps |
| `scripts/restore-drill.sh` | reopen a dump read-only in scratch and prove its row counts match its manifest |

---

## 1. Where the data lives

| Thing | Value |
|---|---|
| Docker volume | `mafia-ai-benchmark_data` |
| Volume mountpoint on the host | `/var/lib/docker/volumes/mafia-ai-benchmark_data/_data` (root-owned, `0700`; **read-only for non-root** — never write here by hand) |
| DB file inside the container | `/app/data/mafia.db` (plus `mafia.db-wal` / `mafia.db-shm` while the server is running) |
| Container | `mafia-ai-benchmark-server-1` (image `mafia-ai-benchmark-server`) |
| Host port | `3004` → container `3000` (`curl -s http://localhost:3004/health`) |
| Backup destination | `/mnt/bulk/hermes-backups/mafia-db/` (kara-owned, writable without sudo) |

> **Do not touch `/app/apps/server/data/`.** That is a stale legacy path inside
> the image; it is not the live DB, and writing there changes nothing.

The DB runs in **WAL** mode, so the live on-disk state is the `mafia.db` +
`-wal` pair. Any copy that takes only `mafia.db` while the server is running is
potentially stale and potentially torn. That is why `backup-db.sh` never copies
the live file: it asks SQLite for a consistent snapshot (see §2).

> **Writing to this data?** Read
> [db-write-convention.md](./db-write-convention.md) first: never issue raw SQL
> against the live DB or `docker exec` writes into the running container — use
> the HTTP API, or snapshot to a throwaway copy and work there.

---

## 2. Taking a backup

    bash scripts/backup-db.sh

Cron-safe: one line of stdout on success, everything else on stderr.

Sample output (a captured run, not part of the recipe — the dump filename is
whatever that run produced):

    BACKUP OK file=/mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.db sha256=874e41bef387dd44 bytes=204926976 tables=18 games=5088 token_usage=25668 events=200713 method=in-container-sqlite-backup pruned=0

### How the snapshot is taken

1. **Primary path — `in-container-sqlite-backup`.** The SQLite backup API is
   driven from inside the running container:

        docker exec -w /app/apps/server mafia-ai-benchmark-server-1 node -e "
          const D = require('better-sqlite3');
          const db = new D('/app/data/mafia.db', { readonly: true, fileMustExist: true });
          db.backup('/tmp/.mafia-backup-<pid>.db').then(() => { db.close(); console.log('backup-ok'); });"

   This is a page-level consistent copy taken against a live writer: it can not
   capture a half-written transaction, and the server keeps serving throughout
   (measured: ~1 s for a ~195 MiB DB). The temporary file is written to the
   container's `/tmp`, deliberately **outside** the production volume, and is
   removed on success, on failure, and on SIGINT/SIGTERM.

2. **Fallback path — `host-trio-consolidation`.** Only if `better-sqlite3` is
   not resolvable (or `MAFIA_DB_BACKUP_METHOD=trio`): copy `mafia.db` +
   `mafia.db-wal` + `mafia.db-shm` into one host scratch dir and consolidate
   with `sqlite3 <dir>/mafia.db ".backup consolidated.db"`. The `-wal` is
   mandatory here — without it the consolidation silently loses every
   transaction that has not been checkpointed yet. This path is strictly worse
   than the primary (a trio copied from a live WAL DB is a racy read) and the
   manifest records which path ran, so an audit can tell them apart.

3. **Publish only what verifies.** The snapshot is written as
   `mafia-YYYYMMDD-HHMMSS.db.part`, normalised to `journal_mode=DELETE` (a
   single self-contained file, no `-wal`/`-shm` siblings), then:

   - `PRAGMA integrity_check` must return exactly `ok`
   - every user table is recounted; `games`, `token_usage` and `events` must be
     non-empty (an empty core table means a hollow dump, not a small one)

   Only after both pass is the file renamed into place. A crash, a full disk or
   a killed run therefore leaves no file that could be mistaken for a good
   backup. On a failed or invalid snapshot the whole acquisition retries once;
   a second failure exits non-zero and publishes nothing.

### Manifest

Every dump has a sibling JSON written immediately after it:

    mafia-20261120-085632.json

```json
{
  "schema": "mafia-db-backup-manifest/v1",
  "dump": "mafia-20261120-085632.db",
  "sha256": "874e41bef387dd44296f020bfafd97a0d9f615174139b03b42882685ff40c806",
  "bytes": 204926976,
  "captured_at": "2026-11-20T08:56:38Z",
  "snapshot_method": "in-container-sqlite-backup",
  "source": {
    "container": "mafia-ai-benchmark-server-1",
    "db_path": "/app/data/mafia.db",
    "volume_path": "/var/lib/docker/volumes/mafia-ai-benchmark_data/_data"
  },
  "live_health_at_capture": {
    "url": "http://localhost:3004/health",
    "response": { "status": "healthy", "checks": { "db_write": { "ok": true } } }
  },
  "tables": {
    "games": 5088, "token_usage": 25668, "events": 200713,
    "players": 19275, "api_calls": 25758, "benchmark_runs": 269
  },
  "produced_by": "backup-db.sh v1.0.0"
}
```

`tables` carries **every** user table found in `sqlite_master` at capture time,
not a hard-coded list — a schema addition is covered automatically. Legitimately
empty tables (`agent_configs`, `model_presets`, …) are recorded as `0`; only the
three core tables are gated non-zero.

### Exit codes and knobs

| Exit | Meaning |
|---|---|
| `0` | dump published and verified, manifest written |
| `2` | preflight failure (docker / container not running / sqlite3 / jq / destination not writable / destination lock held) |
| `3` | acquisition or verification failed on both attempts — nothing published |

| Env var | Default |
|---|---|
| `MAFIA_DB_CONTAINER` | `mafia-ai-benchmark-server-1` |
| `MAFIA_DB_PATH` | `/app/data/mafia.db` |
| `MAFIA_DB_BACKUP_DIR` | `/mnt/bulk/hermes-backups/mafia-db` |
| `MAFIA_DB_BACKUP_RETAIN` | `14` |
| `MAFIA_DB_BACKUP_METHOD` | `auto` (`api` = never fall back, `trio` = force the fallback arm) |
| `MAFIA_DB_HEALTH_URL` | `http://localhost:3004/health` |

Runs are serialised with `flock` on `<dest>/.backup.lock`; a second run (cron
overlapping a human) exits 2 rather than interleaving.

An unreachable health endpoint does **not** fail the backup — it is recorded in
the manifest as `{"error": "unreachable"}` and a warning goes to stderr. The
data is what matters; a dead service is a different ticket.

---

## 3. Retention

Newest **14** dumps are kept (`MAFIA_DB_BACKUP_RETAIN`), oldest pruned after a
successful publish.

Pruning is name-scoped: only files matching the script's own pattern
`mafia-YYYYMMDD-HHMMSS.db` (plus the sibling `.json` of a pruned dump) are
deleted. It never globs the directory, so anything else living in the backup
directory — an operator's notes, a hand-made copy, a `.backup.lock` — survives.
Abandoned `mafia-*.db.part` files older than two hours are removed.

---

## 4. Proving a dump is restorable

    bash scripts/restore-drill.sh                     # newest dump in the destination dir
    bash scripts/restore-drill.sh /path/to/dump.db    # a specific dump

Output:

    restore drill — restore-drill.sh v1.0.0
    dump        : /mnt/bulk/hermes-backups/mafia-db/mafia-20261120-085632.db
    sha256      : 874e41be...c806 (manifest 874e41be...c806)
    integrity   : ok

    table                                manifest      drill  match
    ----------------------------------------------------------------------
    api_calls                               25758      25758  match
    events                                 200713     200713  match
    games                                    5088       5088  match
    ...
    tables compared: 18   mismatches: 0
    DRILL OK: mafia-20261120-085632.db — integrity ok, 18/18 tables match the manifest, sha256 874e41bef387dd44

The drill copies the dump into a private `mktemp` directory, `chmod 0400`s the
copy and opens **that** with `sqlite3 -readonly`. It never opens the live DB,
never touches the volume, and never restarts the service — a drill is safe to
run on a production host in the middle of the day.

Checks, in order: the bytes match the manifest's `sha256` and `bytes`; `PRAGMA
integrity_check` returns `ok`; every table listed in the manifest is recounted
and compared row by row.

| Exit | Meaning |
|---|---|
| `0` | integrity ok and every manifest count matched |
| `2` | preflight/usage (no dumps found, unreadable dump, missing tool) |
| `3` | `integrity_check` failed |
| `4` | manifest missing or unparsable |
| `5` | row-count mismatch |
| `6` | sha256 / byte size does not match the manifest |

Positive and negative arms are all exercised for real on this host
(2026-11-20): a verified dump drills green (18/18); a flipped byte exits 6; a
truncated-and-rehashed dump exits 3; a manifest with `games` inflated by one
exits 5; a missing manifest exits 4; an empty destination exits 2.

---

## 5. Scheduling

Daily, just before the low-activity window:

    30 4 * * * /home/kara/wojons/mafia-ai-benchmark/scripts/backup-db.sh >> /mnt/bulk/hermes-backups/mafia-db/backup.log 2>&1

The foreman wires the actual scheduler entry; this line is the contract for it.
Holding the crontab line in this repo rather than on the host means the schedule
is reviewable and survives a host rebuild.

**Recovery point objective.** A dump is a point-in-time snapshot. Under the
daily cron above the RPO is **24 hours**: everything committed between the last
successful run and a loss is gone. Shortening that means running the script more
often (`flock` makes overlapping runs safe, and a run costs ~12 s wall clock and
~195 MiB of disk); `*/30` would take the RPO to 30 minutes at 48 dumps/day, so
raise `MAFIA_DB_BACKUP_RETAIN` in the same change.

**Recovery time objective.** Restoring is a file copy plus a container start —
minutes, dominated by how long it takes an operator to read this page.

---

## 6. Restoring

Three stages, in increasing order of danger. Do them in order; never start at 3.

No stage names a dump file literally: retention (§3) keeps only the newest
`MAFIA_DB_BACKUP_RETAIN` (14) dumps, so a hardcoded filename stops existing
within a day of cron cadence. Derive the newest one in the shell you are about
to use (re-derive it in every new shell):

    BACKUP_DIR=/mnt/bulk/hermes-backups/mafia-db
    DUMP=$(ls -t "$BACKUP_DIR"/*.db | head -1)
    DUMP_NAME=$(basename "$DUMP")
    echo "$DUMP"        # sanity check: the newest mafia-YYYYMMDD-HHMMSS.db

To restore a specific dump instead (an older one, or one an audit named), set
`DUMP` to its full path and `DUMP_NAME` to its basename and leave the rest of
the recipe unchanged.

### Stage 1 — inspect the dump without a service

    bash scripts/restore-drill.sh "$DUMP"
    sqlite3 -readonly "$DUMP" \
      "SELECT count(*) FROM games; SELECT count(*) FROM token_usage;"

`sqlite3` can open a published dump directly: dumps are `journal_mode=DELETE`,
a single file with no `-wal`/`-shm` siblings.

### Stage 2 — rehearse into a scratch volume and a throwaway container

This is the real test: a restored database that a server can boot on.

    # 1. scratch volume + a copy of the newest dump into it
    docker volume create mafia_restore_drill
    docker run --rm \
      -v mafia_restore_drill:/data \
      -v "$BACKUP_DIR":/backup:ro \
      --entrypoint sh mafia-ai-benchmark-server \
      -c "cp /backup/$DUMP_NAME /data/mafia.db && ls -la /data"

    # 2. boot a throwaway server against it on a spare port (mirrors the compose
    #    service; only the volume + port differ — PORT must be pinned because the
    #    compose file sets it and the image default is not guaranteed)
    docker run --rm -d --name mafia-restore-drill \
      -v mafia_restore_drill:/app/data \
      -p 3014:3000 -e PORT=3000 mafia-ai-benchmark-server
    sleep 12
    curl -s http://localhost:3014/health

    # 3. confirm the restored data is really there through the service.
    #    -w /app/apps/server is required: better-sqlite3 is a pnpm workspace dep,
    #    so `docker exec` from the default /app workdir cannot resolve it.
    docker exec -w /app/apps/server mafia-restore-drill node -e "
      const D=require('better-sqlite3');
      const db=new D('/app/data/mafia.db',{readonly:true});
      for (const t of ['games','token_usage','events'])
        console.log(t, db.prepare('SELECT count(*) c FROM \"'+t+'\"').get().c);"

    # 4. tear the rehearsal down. Settle the stop before touching the volume:
    #    `docker stop` can return while the daemon is still finishing the
    #    auto-removed container, and the immediate `docker volume rm` then
    #    fails with "volume is in use" and leaves the drill volume behind
    #    (reproduced verbatim 2026-11-25: 4 of 6 cycles). Force-remove the
    #    container (it is usually already gone via --rm; the error is fine)
    #    and wait until it no longer lists, then drop the volume.
    docker stop mafia-restore-drill
    docker rm -f mafia-restore-drill 2>/dev/null || true
    until [ -z "$(docker ps -a -q --filter name=mafia-restore-drill)" ]; do sleep 1; done
    docker volume rm mafia_restore_drill

The rehearsal volume is disposable: it shares nothing with
`mafia-ai-benchmark_data`.

Verified 2026-11-25 (newest published dump, manifest sha256
`fc11dc55ac833022`): the block above, run verbatim including the settled
teardown, exits 0 end to end, and a 6-cycle stress repeat of create → boot →
stop → settled teardown is 6/6 clean, with the post-teardown listing

    docker volume ls -q | grep '^mafia_restore_drill$'

printing zero rows for the drill name. For contrast, the block as it stood
before the settle (bare `docker stop` immediately followed by
`docker volume rm`) failed 4 of those 6 cycles with
`Error response from daemon: remove mafia_restore_drill: volume is in use - [id]`
and left the drill volume behind — which is the failure mode the settle step
exists to prevent.

### Stage 3 — in-place restore (disruptive, explicit operator decision)

Only when the live volume is known bad and the service must come back on the
restored data. **This stops the service and overwrites the live DB** — there is
no undo except the safety copy in step 2, so take it.

    # 0. take a fresh dump of the CURRENT state first, even if it looks broken:
    #    it is the only forensic copy of whatever the corruption did.
    bash scripts/backup-db.sh
    #    $DUMP must still point at the PRE-incident dump — do not re-derive it
    #    after this step, or step 3 restores the broken state.

    # 1. quiesce the writer
    cd /home/kara/wojons/mafia-ai-benchmark && docker compose stop server

    # 2. safety copy of the live volume (rollback path)
    docker volume create mafia_data_pre_restore
    docker run --rm -v mafia-ai-benchmark_data:/from:ro \
      -v mafia_data_pre_restore:/to --entrypoint sh mafia-ai-benchmark-server \
      -c 'cp -a /from/. /to/ && ls -la /to'

    # 3. replace the DB, removing the stale WAL/SHM pair explicitly — leaving a
    #    -wal next to a restored db replays the OLD transactions into it.
    docker run --rm -v mafia-ai-benchmark_data:/data \
      -v "$BACKUP_DIR":/backup:ro \
      --entrypoint sh mafia-ai-benchmark-server \
      -c "rm -f /data/mafia.db-wal /data/mafia.db-shm &&
          cp /backup/$DUMP_NAME /data/mafia.db &&
          ls -la /data"

    # 4. restart and verify
    docker compose up -d server
    sleep 5
    curl -s http://localhost:3004/health
    docker exec -w /app/apps/server mafia-ai-benchmark-server-1 node -e "
      const D=require('better-sqlite3');
      const db=new D('/app/data/mafia.db',{readonly:true});
      for (const t of ['games','token_usage','events'])
        console.log(t, db.prepare('SELECT count(*) c FROM \"'+t+'\"').get().c);"

Expected counts after step 4 are exactly the `tables` block of the dump's
manifest. If they differ, stop and restore the step-2 safety volume before doing
anything else:

    docker compose stop server
    docker run --rm -v mafia_data_pre_restore:/from:ro -v mafia-ai-benchmark_data:/to \
      --entrypoint sh mafia-ai-benchmark-server -c 'cp -a /from/. /to/'
    docker compose up -d server

Delete `mafia_data_pre_restore` only once the restored service has served real
traffic without incident.

---

## 7. Evidence artifacts

Each backup/drill run that matters is recorded under
`.coding-hermes/board/evidence/<date>/`. For the first run of this path:

    .coding-hermes/board/evidence/2026-11-20/mafia-ai-benchmark-foreman-2026-11-20-08-33-11/
      backup-evidence.md    # real sha256, verified row counts, script versions, probe results
      dump-manifest.json    # byte copy of the dump's manifest

---

## 8. Limits — what this does NOT protect against

Stated plainly so nobody assumes more than exists:

- **Same host.** Dumps land in `/mnt/bulk/hermes-backups/mafia-db` on the host
  that runs the container. Host loss, filesystem loss under `/mnt/bulk`, or
  ransomware on this machine takes the dumps with the DB. Off-host replication
  is not wired yet. A 195 MiB daily artefact is a good fit for the Hetzner
  Storage Box already used elsewhere in the fleet; until that exists, treat
  "machine is gone" as unrecoverable.
- **Not encrypted.** The destination is `0775 kara:kara` and the dump contains
  real spend and player data. Restrict access accordingly (`chmod 750` on the
  directory is the minimum sensible change; add age/gpg for off-host copies).
- **Daily granularity** unless the cron cadence in §5 is changed — see the RPO
  note there.
- **No automatic restore.** The drill proves restorability; it does not watch
  for "DB is corrupt" and heal it. Detection stays a human/monitoring job.
