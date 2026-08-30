# Mafia AI Benchmark — Sync-Twin Integration Report (2026-08-28 dogfood run)

> Real-use session 2026-08-28 against the live DuckBrain sync twin for the
> `mafia-benchmark` namespace. First end-to-end run of the sync pipeline:
> manual run keeps the namespace fresh (5/5 writes verified on disk in ~3
> min), but the automatic 6h scheduler tick silently under-syncs. The full
> contract is documented in [`specs/sync-integration.md`](../../specs/sync-integration.md).

## 1. TL;DR (what works today)

| Path | Status | Notes |
|------|--------|-------|
| Manual sync pipeline (preflight → status → recent-commits → live-stats → last-run) | ✅ WORKS | 5/5 writes verified via API recall + JSONL grep, ~3 min TTFS |
| `POST /api/memories?namespace=mafia-benchmark` + `X-API-Key` | ✅ WORKS | Key from `~/.duckbrain/auth.json` apiKeys[0] |
| Recall verification (`GET /api/memories?prefix=…&limit=20`) | ✅ WORKS | Locate by UUID, NOT position (recall order mixed) |
| On-disk split `{event,config}/2026-08/current.jsonl` | ✅ CONFIRMED | `config`-domain keys under `config/`, NOT `event/` |
| 6h scheduler tick (`mafia-benchmark-sync`, cooldown 21600s) | 🔴 SILENT NO-OP | 10:09Z Aug 28: 12s, exit 0, ZERO DuckBrain writes — namespace 18h stale (GAP-001) |
| `mafiaWinRate` as an assertable metric | 🔴 UNRELIABLE | 0.0532→0.1237 across +8 completed games — record, never assert (GAP-036/045 history) |

Time-to-first-success: **~3 min** (API docs + auth pattern already in the
workdir scripts and cheat sheet — no source reading needed). Friction: 4 (§4).

## 2. The working recipe (verified end-to-end)

```bash
# 1. Preflight write-test (rotating daily key)
python3.14 preflight.py   # POST /sync/write-test-YYYY-MM-DD (domain=config) + recall verify

# 2. Batch writes (consolidated layer ONLY — never tick detail; foreman owns that)
#    a) /project/mafia-benchmark/status   (domain=event)  — window summary, ticks, escalations
#    b) /project/mafia-benchmark/recent-commits (domain=event) — commit list + HEAD + parity
#    c) /project/mafia-benchmark/live-stats-YYYY-MM-DD (domain=event) — in-container report numbers
#    d) /sync/last-run (domain=config) — window + writes + verification note

# 3. Verify EVERY write two ways:
#    a) API recall: GET /api/memories?prefix=<key>&namespace=mafia-benchmark&limit=20
#       — locate by UUID, NOT position (recall order is mixed; status accumulator is worst)
#    b) JSONL grep (authoritative):
#       grep -c <uuid> /home/kara/duckbrain/namespaces/mafia-benchmark/event/2026-08/current.jsonl
#       grep -c <uuid> /home/kara/duckbrain/namespaces/mafia-benchmark/config/2026-08/current.jsonl
#       (config-domain keys live under config/, event-domain under event/ — grep BOTH)

# 4. HALT rule: ≥2 write failures → stop, report. 1 failure → continue, note it.
```

## 3. The real run (2026-08-28)

Window facts gathered: `git log --since=2026-08-28T03:00Z` (9 commits, HEAD
0d30d64→b1126cd, 0 unpushed, remote parity via `git ls-remote origin HEAD`);
scheduler `/api/v1/ticks?project=mafia-ai-benchmark&limit=20` (ticks through
15:20:37Z committed b1126cd); board `tasks.jsonl` (4 OPEN tasks, was 0); live
report via `docker exec mafia-ai-benchmark-server-1 wget -qO- http://localhost:3000/api/v1/benchmark/report`
(1934 total / 1819 completed / 97 active / 18 failed; modelPerformance 4 rows).

All 5 writes verified two ways: API recall (all PASS) + JSONL grep on
`namespaces/mafia-benchmark/{event,config}/2026-08/current.jsonl` (all found).

## 4. Friction log (2026-08-28)

1. **`config`-domain keys live under `config/`, NOT `event/`** — first verify
   pass grepped `event/` only and falsely reported 2 FAILs (~2 min lost).
   Cheat sheet documents recall ordering but not the on-disk domain split.
2. **Scheduler ticks endpoint is `GET /api/v1/ticks?project=X`** —
   `/api/v1/projects/X/ticks` returns 405. Not documented in the cheat sheet.
3. **Board status values undocumented** — had to read `tasks.jsonl` directly
   (status field values `open`/`in_progress`/`todo`/`pending`/empty); no
   one-liner documented.
4. **mafiaWinRate 0.0532→0.1237 across +8 completed games** — metric moved
   ~2.3x for ~0.4% population growth: likely a metric-definition/attribution
   change (see MAF-GAP-036/045 history). Flagged; do NOT hardcode expectations.

## 5. Findings (tasks for the sync foreman)

### GAP-001 (P1) — Sync tick can silently no-op for a full window
At 10:09Z Aug 28 the mafia-benchmark-sync tick ran 12s, exit 0, ZERO DuckBrain
writes, while its window had 4+ commits and 3 board task changes. Namespace
went 03:00Z→21:10Z (18h) stale; nothing in the workdir explains the skip.
**Fix direction:** every tick MUST write the `/sync/write-test-YYYY-MM-DD` +
`/sync/last-run` marker even when it decides "nothing new" — a no-op tick
should be visible as a marker, not as an absence. Add a freshness guard: if
`/sync/last-run` is older than the tick window and the repo has in-window
commits, write the status window-summary unconditionally.

### GAP-002 (P2) — Sync pipeline exists only as unversioned scratch scripts
The workdir holds one generation of ad-hoc scripts (`preflight.py`, `batch1.py`,
`verify.py`, `last_run.py`) with no README, no git, no explanation. A new sync
agent must reverse-engineer the pattern from one example.
**Fix direction:** promote the documented pipeline (preflight → batch write →
verify via recall+JSONL grep → last-run marker) into the data skill as a
reusable recipe.

### GAP-003 (P2) — No documented freshness check for the sync's own state
The cheat sheet documents mafia-ai-benchmark's scheduler row but not
mafia-benchmark-sync's own row (cooldown 21600, prompt, last tick), and no
check exists for "is the last sync actually fresh?". The 10:09Z no-op would
have been caught instantly by an age check on `/sync/last-run`.
**Fix direction:** add the sync project's scheduler row + a last-run age check
to the cheat sheet's scheduler section.

## 6. Verdict

**🟡 PROMISING-BUT-ROUGH** — the sync mechanism works end-to-end when run
manually (5/5 writes verified on disk in ~3 min), but the automatic path
silently under-syncs: the 6-hour scheduler tick wrote NOTHING in a window with
real changes, leaving the namespace 18h stale. The contract is now documented
in [`specs/sync-integration.md`](../../specs/sync-integration.md); the
remaining blockers are the silent no-op tick (GAP-001) and pipeline
versioning/freshness gaps (GAP-002/003).
