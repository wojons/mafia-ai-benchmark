# Dogfood integration report — 2026-10-20 (mafia-ai-benchmark)

Run 12 of the dogfood lane. Stack: shipped compose deployment (server :3004 / web :5174),
rebuilt 2026-10-20 08:15Z, HEAD 3550f7d. Findings: DF-MAFIA-AI-BENCHMARK-39..42,
DF-MAFIA-AI-BENCHMARK-22-R2, PERF-MAFIA-4.

## Promise (null hypothesis)

> A user can benchmark AI models' Mafia-playing ability head-to-head (one game, two models)
> from the CLI or the browser, and read trustworthy per-model win/cost statistics.

## What was actually done (real use, not the test suite)

1. **Documented head-to-head flow** — the CLI example from `mafiactl benchmark --help`:

   ```bash
   npx tsx apps/cli/src/index.ts benchmark --games 1 --models openai/gpt-4o-mini,openai/gpt-4o
   ```

   Result: run `dec5e3e1-183e-48d1-a84e-ab0322edfba9`, 1 game, 1 pairing, `real 276.07s`,
   per-model cost `$0.02`, run-scoped head-to-head block
   (`openai/gpt-4o-mini__vs__openai/gpt-4o — 1/1 completed`) and a Winner banner scoped to
   the run. Both models played in the **same** 10-player game (`benchmark_games.pairing_id`),
   and `players.tokens_used` is now populated per player (it was 0 everywhere in the 08-24 run).

2. **Dashboard walk** (`/`, `/stats`, `/benchmark`, New Game modal) with CDP resource timing.

3. **Reconciliation against the store** — `docker cp mafia-ai-benchmark-server-1:/app/data/mafia.db{,-wal}`
   then `sqlite3` on the copy. (The `-wal` file matters: without it the newest game reads as
   `IN_PROGRESS` and the newest `benchmark_games` row looks empty.)

## What holds up

- The documented CLI benchmark flow completes end to end and the run-scoped report is honest
  and sample-size-scoped (DF-28 fix verified again).
- Deployment freshness is real: both containers were newer than HEAD (the standing DF-38
  refresh mechanism is holding; no DF-17-class drift this tick).
- Mock/degenerate games are bucketed visibly (`mockGames`, `unattributedModels`) rather than
  silently mixed into `modelPerformance`.
- Token/cost attribution on a fresh real run is correct (per-model ~$0.02, usage rows present).

## What does not (the findings)

| # | Row | One line |
|---|-----|----------|
| 1 | DF-39 (P1) | 94% of ENDED games are 5-player, where the mafia wins 3.7%; so a model's win rate is its role-assignment odds, and the leaderboard exposes no role/configuration breakdown |
| 2 | DF-40 (P2) | The Head-to-Head panel can never populate — nothing writes `model_matchups` — while 91 games really pitted the two models against each other |
| 3 | DF-41 (P2) | `mafiaWinRate` divides mock-excluded wins by a mock-inclusive `completedGames`; the published totals do not add up |
| 4 | DF-42 (P2) | New Game presets name models that do not exist in the configured provider's catalog; VIGILANTE is left on the deployment default |
| 5 | DF-22-R2 (P2) | `'[object Object]'` still reaches `report.agentStats` (and 27 players rows / 32 usage calls in the store) |
| 6 | PERF-MAFIA-4 (P3) | Stats tab spends 39-43 extra requests (2020ms) rendering one table |
| 7 | DF-43 (P1) | A modal-created game runs every role on the literal string `'[object Object]'` - the API accepts `{ provider, model }` objects while the adapter's child-env injection has no type guard (its persistence path does) |
| 8 | PERF-MAFIA-3 (pending) | `/benchmark/compare` is 2.4s every request and blocks concurrent requests (re-measured; recurrence recorded as event 682) |

## Reproductions

```bash
# 1. win rates by configuration (5p vs 10p) and by role
docker cp mafia-ai-benchmark-server-1:/app/data/mafia.db /tmp/m/mafia.db
docker cp mafia-ai-benchmark-server-1:/app/data/mafia.db-wal /tmp/m/mafia.db-wal
sqlite3 /tmp/m/mafia.db "select json_extract(config,'$.numPlayers') np, ifnull(winner,'(null)'), count(*) \
  from games where status='ENDED' group by 1,2"
sqlite3 /tmp/m/mafia.db "select p.role, count(*), sum(p.won) from players p join games g on g.id=p.game_id \
  where g.status='ENDED' group by 1"

# 2. the winner split does not reconcile
curl -s http://localhost:3004/api/v1/stats | jq -c '.data'
curl -s http://localhost:3004/api/v1/benchmark/report | jq -c '.data.summary'

# 3. head-to-head surface is empty although the data exists
curl -s http://localhost:3004/api/v1/stats/matchups
curl -s http://localhost:3004/api/v1/benchmark/compare | jq '.data.headToHead | length'
sqlite3 /tmp/m/mafia.db "select count(*) from model_matchups"          # 0
sqlite3 /tmp/m/mafia.db "select count(distinct game_id) from benchmark_games"

# 4. list payload cannot fill the history table
curl -s 'http://localhost:3004/api/v1/games?limit=3' | jq -c '.data[0] | keys'

# 5. provider catalog check for the modal presets
curl -s https://openrouter.ai/api/v1/models | jq 'any(.data[]; .id=="deepseek-v4-flash")'   # false
curl -s https://openrouter.ai/api/v1/models | jq 'any(.data[]; .id=="deepseek/deepseek-v4-flash")'  # true
```

## Time/cost measured this tick

| Operation | Number |
|---|---|
| CLI head-to-head benchmark, 1 game, 10 players, 2 models | 276.07s wall (one-shot, LLM-bound), ~$0.04 |
| Stats dashboard data populate (cold page) | 2.7s idle; 4.4s while a benchmark game runs |
| `GET /api/v1/benchmark/compare` | 2.392 / 2.523 / 2.561s idle — no cold/warm difference |
| `GET /api/v1/stats/matchups` | 0.0014s via curl; 2678ms when fired beside `compare` in the page |
| `GET /api/v1/games/:id` details for one Stats page | 39 requests, 9-97ms each, 2020ms aggregate |
| Dashboard DOM load | 27-46ms, 0 longtasks |

## Not exercised (and why)

- **Install leg (bunker)**: no bunker host was proven reachable this tick, so no ephemeral
  agent was spawned and no install claim is made. The shipped compose deployment was used
  instead. An install-leg row belongs to the next tick that has a reachable host.
- **Creating a game from the New Game modal**: creating a 10-player game spends real LLM
  money (~$1+ per game at current settings), so DF-42 records the catalog/shape evidence and
  leaves the live failure mode to be confirmed by the fix.
