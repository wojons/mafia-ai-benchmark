# PERF-MAFIA-5 arm 2 — `/api/v1/benchmark/compare` is stale-while-revalidate

**Scope:** `apps/server/src/services/stats-collector/index.ts`
(`StatsCollector.getCompareReport`, the compare cache + deferred refresh),
`apps/server/src/services/stats-collector.ts` (re-export), and
`apps/server/src/__tests__/services/compare-cache.test.ts` (the rebuild-path
tests). Route, response shape and query parameters are unchanged.

## The problem this row fixes (measured on the live stack, HEAD e9f49d7)

The compare cache (PERF-MAFIA-3) already survived in-progress game writes, but
it paid for that on **every request**:

| probe | before |
|---|---|
| cold compare (first call in process) | 9.2 s — full rebuild, blocks the loop |
| compare hit, 30 s apart, game live | 0.36 s / 0.33 s — of which ~0.3 s is the fingerprint SQL |
| `GET /api/v1/games?limit=50` alone | 0.006 s |
| the same call **while a compare was in flight** | 0.309 s (target: < 100 ms) |

The ~0.3 s was `computeCompareWatermark()` running synchronously on the request
path to decide "cache hit or not". Node is single-threaded, so that scan is a
head-of-line block for every other route on the process — which is why an
unrelated `games?limit=50` degraded from 6 ms to 309 ms.

## The mechanism

`getCompareReport(modelFilter?)`:

1. **Cache hit** (an entry exists for this `?models=` key): return the cached
   report and **do no database work at all** — no fingerprint, no `pragma`, no
   build. The key is enqueued for deferred validation and the request returns.
2. **True cold path** (no entry for this key in this process): compute the
   fingerprint once, build once, store under the pre-build fingerprint. This is
   the only path still allowed to block. Build errors propagate to the route's
   500 unchanged and are never memoized.

Deferred validation runs in a background cycle:

* armed with `setTimeout` when a key is enqueued, `unref`'d so it never holds
  the process open;
* prefixed with a `setImmediate` yield, so the request that scheduled it writes
  its response before the first fingerprint statement runs;
* **throttled** to at most one cycle per `COMPARE_REFRESH_THROTTLE_MS` (1000 ms)
  per repository;
* **coalesced**: every key queued during a cycle folds into the same batch, and
  the batch computes the fingerprint **once** (the watermark is data-wide; the
  `?models=` filter only chooses which report is derived from it);
* rebuilds only keys whose stored watermark differs from the current one.

## Inputs that are deferred, and the bound

**Deferred (moved off the request path):** the entire compare fingerprint —
`computeCompletedCompareBaseWatermark` (games / players / events / token_usage /
api_calls / agent_sessions / player_model_assignments) **plus** the compare-only
half (`benchmark_games`, `model_matchups`, `players.role` length,
`player_model_assignments` rowid + text lengths).

**Bound:** validation is deferred by **at most one throttle window (≤ 1 s) plus
one rebuild**. The timer is armed when the key is enqueued, so a key is
revalidated inside that window even if the dashboard stops polling — staleness
is not "until the next request". The rebuild itself (2–9 s at the live corpus)
is now paid by the background cycle instead of by the caller.

**Excluded (never part of the report — not a deferral):** every row belonging to
a game whose `status` is not `ENDED`, i.e. events / players / token_usage /
api_calls / agent_sessions / player_model_assignments joined to a non-ENDED
game, and the `benchmark_games` rows joined to one. That ENDED scoping is what
lets an in-progress game write freely without touching the compare cache; it
predates this row (PERF-MAFIA-3 / PERF-MAFIA-5) and is unchanged here.

## Correctness guarantees (pinned by tests)

* **No permanently stale report.** After the deferred cycle runs, a compare
  computed over changed ENDED data reflects it. `flushCompareRefresh()` is the
  awaitable hook the tests use instead of sleeping.
* **A failed/absent fingerprint drops the entry.** If the deferred cycle cannot
  compute the fingerprint (`null` — schema variant, broken store), the cached
  entry is deleted so the next request takes the cold path: *compute fresh,
  never memoize*. Serving the last-good report forever is explicitly not
  allowed.
* **A failed rebuild keeps the last-good report** and the next request
  re-schedules validation, so a transient read failure degrades to bounded
  staleness instead of a blank/500 outage. Permanent staleness therefore
  requires *every* rebuild to keep throwing.
* **The filter stays in the key.** A `?models=` key is never re-served the
  unfiltered report, and the deferred cycle rebuilds each queued key from its
  own filter.
* **Errors are never memoized.** The cold path still lets `getCompareReport`
  throw to the route.
* **No response-shape change**, no timeout change, no cache-buster parameter,
  no "stale forever" mode.

Rationale for dropping the old `PRAGMA data_version` guard from the compare
entry: the watermark fingerprints every source table (including in-place
mutation length sums), so it subsumes the cross-connection version hint — and a
version-mismatch `null` on the request path would have forced exactly the
synchronous rebuild this row removes. The report cache (`generateReport()`,
PERF-MAFIA-2) still uses its own `data_version` guard; that path is untouched.

## What is deliberately still synchronous

The first compare request per `?models=` key in a process (the true cold case,
including a process restart) still fingerprints and builds on the caller, and a
new filter variant arriving for the first time pays one cold build. A
boot-time warm-up was considered and is **out of scope** for this row: it would
load the corpus during startup and couple the cache to boot ordering. A
follow-up row can warm `unfiltered` once the server is listening.

## Verifying

```bash
pnpm --filter @mafia/server exec tsc --noEmit
pnpm --filter @mafia/server exec eslint --max-warnings 0
pnpm --filter @mafia/server exec vitest run src/__tests__/services/compare-cache.test.ts
```

Live re-measure recipe (unchanged from the row's acceptance): measure
`GET /api/v1/benchmark/compare` cold, then warm, and time
`GET /api/v1/games?limit=50` **while** a compare is in flight. The warm compare
must do no fingerprint work and the concurrent `games` call must stay in the
single-digit-millisecond range.
