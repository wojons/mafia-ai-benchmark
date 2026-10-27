# Mafia AI Benchmark — integration report, dogfood tick 2026-10-27

**Run:** `mafia-ai-benchmark-dogfood-2026-10-27-21-34-02` (read-only dogfood lane)
**Target:** `/home/kara/wojons/mafia-ai-benchmark` @ `1c3e8f7` (`origin/main` parity 0/0 at tick start)
**Deployment:** compose stack at HEAD — `.deploy-stamp == 1c3e8f7`, server container `StartedAt 2026-10-27T21:15:05Z`, web `21:15:11Z`
**Verdict:** 🟡 PROMISING-BUT-ROUGH — the benchmark machinery, the stats identity and the new seat/role breakdowns are honest and live; two served surfaces still sell dead games and a blended win rate as if they were real.

## The promise

> A user can benchmark AI models' Mafia ability head-to-head (`mafiactl` / API `:3004` / web `:5174`) and read trustworthy per-model win/cost statistics.

## What was driven (real use, not tests)

| Leg | What a visitor/user did | Result |
|---|---|---|
| API | `/health`, `/api/v1/{health,stats,games,models,benchmark/report,benchmark/compare}` | all 200; numbers reconciled below |
| Web | `/` (Games), `/stats`, `/benchmark`, `/watch/<id>` in a headless Chrome (CDP), text-extracted | renders; 4-5 API calls per cold page |
| CLI | the README's persistent-config block verbatim (`init --default`, `config show`, `config set numPlayers 8`, `config show`, `config reset`) via the documented `pnpm --filter @mafia/cli dev --` / `run config …` forms | `set` → `show` round-trip works (`Players: 8`); the file lands in `apps/cli/` |
| Store | read-only `better-sqlite3` census inside the running container | ground truth for the ghost and seat findings |
| Install | `bunker-qa.sh launch` on `bunker-mvp` (agent `cfa91552`, QA HEAD `1c3e8f7`, pull=ff-only ok) | see install leg below |

## Verified true at HEAD (fixes that hold)

- **Population identity (DF-41/DF-41-R2).** `report.data.summary` = `{totalGames 5077, completedGames 4389, mockGames 483, inProgress 12, failedGames 0, cancelledGames 193}` plus a `population` object; `5077 = 4389 + 483 + 12 + 0 + 193` holds arithmetically. `/stats` agrees: `mafiaWins 88 + townWins 4301 = 4389`.
- **Ghost retirement mechanism exists (DF-23-R2's first half).** Boot log: `Game lifecycle reconciliation: 0 retired, 0 live, 12 recent, 12 inspected`; `stats.activeGames 12 == ` IN_PROGRESS list length `12` (the old 0-vs-166 split is gone).
- **Stale `:3004/report/summary` probe retracted.** My first probe 404'd on `/api/v1/benchmark/report/summary`; no such route exists in `apps/server/src/routes/benchmark.ts` (the population lives in `report.data.summary`). Not a finding — the path came from a row title, not from the product.
- **Deploy-refresh is current.** Both containers are younger than the HEAD commit; DF-38's drift is not reproducing.
- **~483 mock games stay excluded** from the model aggregates and are declared rather than hidden.

## Findings filed this tick

### 1. `DF-MAFIA-AI-BENCHMARK-23-R3` (P2) — 12 never-started games are still sold as live
- `curl '/api/v1/games?status=IN_PROGRESS&limit=1000'` → **12 rows**, all `startedAt null / endedAt null`.
- `/state` sampled 3x, twice, 20 s apart → identical `phase NIGHT_ACTIONS, turnNumber 8, day 1, timeRemaining 0, alive 1`. **No row advances.**
- Store: all 12 have **0 `players` rows, 0 `token_usage` rows ($0), 0 `benchmark_games` rows**, `started_at NULL`, 8-ish events whose last is 17-21 h old (created 2026-10-27 00:45–04:31Z).
- Browser: header `12 Active` over cards `IN PROGRESS … Phase: In Progress [Watch]`; `/watch/fc4c1509-…` renders **`LIVE`** with `Time 0s`, `Alive 1`, "Recent Events about 17 hours ago".
- DF-23-R2's own acceptance (0 ghost rows **or** every remaining row proves liveness within 60 s) is red at HEAD; the sweeper's age window classifies them as "recent" and never asks whether an engine owns them.

### 2. `DF-MAFIA-AI-BENCHMARK-39-R3` (P2) — the seat caveat is missing on the row it exists for
One `GET /benchmark/compare` payload, same minute as the browser read:

| model | gamesPlayed | byNumPlayers | Σ buckets | seat note rendered? |
|---|---|---|---|---|
| `openai/gpt-4o-mini` | 4382 | 5:3629, 6:3, 7:2, 8:2, 10:93 | **3729** (653 = 14.9% uncovered) | **no** |
| `openai/gpt-4o` | 95 | 5:2, 6:2, 7:1, 10:90 | 95 | yes — "94.7% of games used 10-player seats" |

- The note (DF-39-R2's fix) is gated at `share >= 0.9` (`apps/web/src/components/BenchmarkLeaderboard.tsx:98-116`, call `:188`, render `:243-247`); for the flagship row the share is `3629/4382 = 0.828` — below the gate, although that row's own panel shows 5-player seats winning `3628/3629 = 100.0%` and MAFIA seats `21/3723 = 0.6%`.
- A reader therefore sees exactly one page-level-looking note, attached to the 95-game model, while the 4382-game row at `85.0%` carries no caveat.
- Independent store census: 3779 ENDED games carry a players row naming that model (`openai/gpt-4o-mini` 3718 + `gpt-4o-mini` 61) — a **third** population for the same model on one endpoint. Corpus ground truth: ENDED 4872 = 5-player 4621 (94.9%), 10-player 245, 7-player 3, 8-player 2, 6-player 1.

### 3. `DF-MAFIA-AI-BENCHMARK-49` (P5) — the usage skill's coaching had no verifier
`skills/mafia-usage/SKILL.md` taught (lines 44-47, 193-195) that `/benchmark/report` "omits the mock-game count" — false since DF-41-R2 (2026-10-27T03:47Z). **Corrected in place this tick**; the row owns the missing guard so the next contract change reds a build instead of rotting the prose.

## Measured cost (Step 2b)

Warm, sequential, single client, host loadavg ≈ 23 (shared box — every number is an upper bound):

| route | server-side (own log) | curl-inclusive |
|---|---|---|
| `/health` | 0-2 ms | 0.010 s |
| `/api/v1/stats` | 784-849 ms ×5 | 0.79-0.86 s |
| `/api/v1/benchmark/compare` | 320-350 ms ×5 | 0.35 s (2.69 MB body) |
| `/api/v1/benchmark/report` | 295-324 ms ×5 | 0.31-0.35 s |
| `/api/v1/games?limit=50` | 3-9 ms | 0.02 s |
| `/api/v1/models` | 843 ms first call | 0.89 s |

First request after the 21:15:05Z container recreate (same routes, cold): `stats 2518 ms`, `report 3785 ms`, `compare 5786 ms`. So the steady state is comfortably sub-second but the **first hit per process pays 2.5-5.8 s**, and the product's own `deploy-refresh` recreates the container on every stamp drift — i.e. each deploy re-pays it once per endpoint (the browser's `/stats` load after warm-up still paid `compare 1189 ms`, consistent with the memo being keyed per query shape).

**No PERF row filed:** nothing here is slow in steady state (`compare` 0.35 s, `report` 0.32 s, `stats` 0.83 s warm) and the cold cost is one hit per process, not a recurring per-request cost. Numbers recorded here for the maintainer; `PERF-MAFIA-3`'s warm bound of 0.300 s is met only up to 0.35 s at this larger corpus (5077 vs 4284 games) — still not user-felt.

Browser-side (headless Chrome, cold `/stats`): **5 API calls** (`/games` ×2, `/stats`, `/stats/matchups`, `/benchmark/compare`) — `PERF-MAFIA-4`'s "5 requests, was 39-43" holds. DOM nav 75 ms.

## Friction log (this tick)

1. `pnpm --filter @mafia/cli dev -- init --default` is documented as "Create the nested default configuration **without prompts**" (README:194) but on a tree where `./mafia.config.json` already exists it prints `⚠️ Configuration already exists at: ./mafia.config.json … Use --force to overwrite` **and a `? Overwrite existing configuration? (y/N)` prompt**, then exits **0 having changed nothing**. `--force` appears nowhere in README (README-12 already owns that for `config reset`; corroboration event appended there rather than a duplicate row).
2. The documented commands operate on **`apps/cli/mafia.config.json`** (pnpm runs the script in the package directory), while README:187-190 says the file is "in the current directory". Evidence: `config show` reports `Night Duration: N/A` on this box even though a repo-root `mafia.config.json` (residue, 2026-10-06) sets `nightDuration: 60`; `config set numPlayers 8` updated `apps/cli/mafia.config.json` (mtime 2026-10-27 16:43). Self-consistent under the documented pnpm form, so **not filed** — recorded here for the record.
3. The Games page's card field `players` disagrees with the store: cards for the 12 ghosts print `1 Players` while the store has **0 `players` rows** for every one of them (config says `numPlayers: 5`). Folded into finding 1 as evidence.
4. Third-party noise: 3 unrelated bunker agents and many unrelated containers on the box; loadavg 23 during every measurement.

## Install leg (fresh machine, `bunker-qa.sh`)

`bunker-qa.sh launch /home/kara/wojons/mafia-ai-benchmark` on `bunker-mvp` (bunkerd 0.2.1, ONLINE, 4/50 agents, disk 39%): fence-check `35 intended substitutions / 0 violations`, `agent=cfa91552`, `QA HEAD=1c3e8f7 (ff-only ok)`, evidence `/tmp/bunker-qa-evidence-20261027T214911Z-2065047.jsonl`, cells queued (`repo-head OK`, `launch OK`, `fresh-install` sync + `upgrade-prep` v1.0.0 tree started). Battery runs detached on the agent; this lane did not spawn a second leg and did not touch the designated-host SKIPPED case already filed as `DF-MAFIA-AI-BENCHMARK-44`.

## Not done on purpose

- **No benchmark campaign re-driven** (real LLM spend, ~4 min/run): the money-bearing path was verified on 2026-10-20/23 and its report/compare/summary surfaces were re-read live here instead.
- **No container restart for a cold-cache A/B**: 12 persisted IN_PROGRESS rows were present and a recreate is the known game-killer (DF-47) — the cold numbers were taken from the product's own recreate at 21:15:05Z instead.
- **No scheduler state touched** (read-only lane): the foreman was not woken.
