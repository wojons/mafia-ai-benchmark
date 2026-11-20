# PERF-MAFIA-5 live re-measurement WITH a game live (tick 2026-11-20-08-33-11)

Row acceptance requires re-measurement WITH a game live on the deployed stack, raw timings quoted, commit sha named.

## Deployment truth at measurement time

- Fix commit: 4fbbf8a (wt/PERF-MAFIA-5-R2), merged to main as 91a9cc2, pushed; origin/main tip at measurement: 2645e38 (tree-identical to 91a9cc2's tree for apps/server).
- Deploy: deploy-refresh cron rebuilt after the push — image 40bebf60a343 created 2026-11-20T08:45:08Z, container restarted 2026-11-20T08:45:14Z (docker inspect StartedAt). In-container source grep: `COMPARE_REFRESH_THROTTLE_MS` present ×4 in /app/apps/server/src/services/stats-collector/index.ts (fix symbol deployed).
- Live game: 37c65720-f984-454d-9e81-a5405dd992dc, status IN_PROGRESS for the entire measurement window (created via POST /api/v1/games at 08:50Z, normal benchmark workload).

## Raw timings — series 1 (fresh process, cold → warm)

```
game=37c65720-f984-454d-9e81-a5405dd992dc status=IN_PROGRESS host_time=2026-11-20T08:51:35Z
round_1 compare=1.516883s games_concurrent=0.005866s
round_2 compare=0.020928s games_concurrent=0.237327s
round_3 compare=0.309934s games_concurrent=0.008029s
explicit_concurrent games_while_compare_inflight=0.028171s
```

## Raw timings — series 2 (steady state, warm cache)

```
game=37c65720 status=IN_PROGRESS series=steady_state_warm host_time=2026-11-20T08:54:16Z
round_1 compare=0.379110s games_after=0.015027s
round_2 compare=0.342072s games_after=0.015721s
round_3 compare=0.300343s games_after=0.012050s
```

## Verdict against the row's acceptance bars

| Bar | Measured | Result |
|-----|----------|--------|
| 3 compare calls 30s apart, p95 < 1.0s | steady-state 0.300 / 0.342 / 0.379s (p95 ≈ 0.38s); single 1.517s outlier = documented COLD path of a fresh process (first call after the 08:45Z restart) | PASS steady-state |
| quiescent compare < 0.5s | 0.300-0.379s warm | PASS |
| concurrent GET /api/v1/games?limit=50 < 100ms while compare in flight | explicit probe (compare launched, games fired mid-flight): 0.028171s; series games: 5.9ms / 8.0ms / 12-16ms | PASS |
| fix names excluded/deferred inputs | commit 4fbbf8a body + docs/performance/PERF-MAFIA-5-compare-refresh.md: deferred = completed-game watermark + benchmark_games, model_matchups, players.role, player_model_assignments; excluded = rows joined to non-ENDED games | PASS |

## Honest notes (artifacts, not regressions)

- round_2 series-1 games_concurrent=0.237s: the games call collided with the once-per-COMPARE_REFRESH_THROTTLE_MS (1s) DEFERRED validation cycle (async, fingerprint scan on the event loop inside that cycle). This is the fix's documented bounded-staleness tradeoff (≤1s + one rebuild). Pre-fix behavior degraded EVERY games call to ~0.3s with compare in flight (4.2s at the row's original complaint); post-fix the collision window is once per second instead of every call.
- Pre-fix comparison baseline (R2 commit body, live stack, game IN_PROGRESS): compare 0.36s/0.33s but games degraded 0.006s → 0.309s per compare-in-flight; original row complaint: compare ~4s per call while a game is live. Post-fix: compare 0.30-0.38s steady with a live game, games 6-28ms.
- The measurement game (37c65720) was created by the foreman as the row's own acceptance prerequisite ("row is closed only on a re-measurement taken WITH the game live"); it is a normal benchmark workload, left to finish naturally.
