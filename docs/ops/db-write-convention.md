# Product DB write convention

**Rule: never write into the live demo database by hand.** No raw `sqlite3`
against `/var/lib/docker/volumes/mafia-ai-benchmark_data/_data/mafia.db`, no
`docker exec ... sqlite3 /app/data/mafia.db`, no `UPDATE`/`INSERT`/`DELETE`
issued from a measurement script against the running container. Write through
the HTTP API, or work on a throwaway copy.

This page is the write-side companion to
[db-backup-restore.md](./db-backup-restore.md) (read/copy side: where the data
lives, how to snapshot and restore it).

---

## 1. Why — the shape this convention prevents

An earlier measurement script wrote raw SQL into the live DB. It left one game
row in a state the write paths never produce:

| column | value |
|---|---|
| `status` | `IN_PROGRESS` |
| `winner` | `NULL` |
| `started_at` | `NULL` |
| `ended_at` | `NULL` |
| transcript | contains `GAME_ENDED` (winner `TOWN`) |

The API derives `winner` from the transcript, so the detail endpoint served

    status: "IN_PROGRESS"
    winner: "TOWN"

in the same response — a self-contradiction on a product surface — and the row
inflated the "live games" counter because `activeGames` is a plain
`WHERE status = 'IN_PROGRESS'` count.

Two things follow from this:

1. **Hand-written SQL bypasses application invariants.** Writing only a subset
   of the lifecycle columns and events can produce contradictory records.
2. **Analytics cannot repair intent.** The read path can only guess (and now
   warns — see §4); it must not silently rewrite a product row, because a wrong
   guess changes history that reports and benchmarks cite.

---

## 2. What to do instead

### 2.1 Preferred: the HTTP API

Use the HTTP API for supported mutations, including one-off operations.

    curl -s http://localhost:3004/health
    curl -s http://localhost:3004/api/v1/games            # list
    curl -s http://localhost:3004/api/v1/games/<id>       # detail

If an operation has no endpoint, that is a gap to file, not a licence to write
SQL: open a row against the server API instead.

### 2.2 Otherwise: a throwaway copy, never the live file

For analysis, measurement or any experiment that needs SQL, copy the database
out and query the copy. The DB runs in WAL mode, so copy `mafia.db` together
with `mafia.db-wal` and `mafia.db-shm` when present. Sequential copies from a
running database are not guaranteed to be consistent: use the supported backup
procedure for a reliable snapshot. For exploratory work only:

    mkdir -p ~/scratch/mafia-copy
    docker cp mafia-ai-benchmark-server-1:/app/data/mafia.db      ~/scratch/mafia-copy/
    docker cp mafia-ai-benchmark-server-1:/app/data/mafia.db-wal  ~/scratch/mafia-copy/ 2>/dev/null || true
    docker cp mafia-ai-benchmark-server-1:/app/data/mafia.db-shm  ~/scratch/mafia-copy/ 2>/dev/null || true

    # Consolidate the copied files; this cannot fix an inconsistent copy.
    sqlite3 ~/scratch/mafia-copy/mafia.db "VACUUM INTO '$HOME/scratch/mafia-copy/snapshot.db'"
    sqlite3 ~/scratch/mafia-copy/snapshot.db "SELECT status, winner, started_at, ended_at FROM games WHERE id = '...';"

Use the documented backup procedure in db-backup-restore.md for routine copies.

Measurements that need a write (backfills, counter recomputation) run against
`~/scratch/mafia-copy/snapshot.db` and are reported as findings. If the result
must land in production data, it lands through the API or as a reviewed
migration — not as an ad-hoc `UPDATE`.

### 2.3 Never

- `docker exec mafia-ai-benchmark-server-1 sqlite3 /app/data/mafia.db ...` with
  a write statement.
- Writing into `/var/lib/docker/volumes/mafia-ai-benchmark_data/_data/` from the
  host (root-owned `0700`; the live WAL makes any direct write unsafe).
- `docker cp` **into** the container, `docker compose restart` to "reload" a
  hand-edited file, or any other mutation of the running service to make a
  script's output take effect.
- Fixing a bad row by editing `status` alone. `status`, `winner`,
  `started_at`, `ended_at` and the terminal `GAME_ENDED` event are one fact;
  writing a subset is exactly how the corruption above was produced.

---

## 3. If a bad write already happened

1. **Do not "repair" it with more hand-written SQL.** Stop writing.
2. Capture evidence: dump the row and its transcript to a scratch file
   (`sqlite3 ... "SELECT * FROM games WHERE id='...'"`, plus:
   `SELECT * FROM events WHERE game_id='...' ORDER BY timestamp, sequence`).
3. Decide the intended state from the transcript (it is the record of what
   actually happened) and express the fix as a reviewed migration or an API
   operation — one that writes every coupled column in a single transaction.
4. Report the shape, the game id and the evidence. The read path only *flags*
   inconsistent rows; it never repairs them.

---

## 4. What the code does about it now

`GameRepository.getGame()` (DF-MAFIA-AI-BENCHMARK-53) detects the inconsistent
shape — `status = 'IN_PROGRESS'` while a winner is set or a terminal
`GAME_ENDED`/`GAME_OVER` event exists in the transcript — logs a warning naming
the game id and the shape, and serves the row as `ENDED` (phase `GAME_OVER`,
`endedAt` from the terminal event) so no served field contradicts another.

`StatsCollector.getGameStats()` excludes live-status rows with a recorded winner
or terminal event from `activeGames` and counts those rows as failed, keeping
`total = active + completed + failed` reconciled.

Both are read-only: they make a corrupted row visible and non-contradictory,
they never change it. The warning is the signal to fix the write path that
produced it.
