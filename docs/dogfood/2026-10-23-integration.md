# Dogfood integration report — 2026-10-23 (tick `mafia-ai-benchmark-dogfood-2026-10-23-13-23-49`)

Target: `/home/kara/wojons/mafia-ai-benchmark` @ HEAD `c44f985`
(`board: tick 270 — close PERF-MAFIA-4`). Environment: the shipped compose stack on
this host — `mafia-ai-benchmark-server-1` started 2026-10-23T02:30:20Z and
`mafia-ai-benchmark-web-1` 02:30:25Z, `.deploy-stamp` == HEAD, so the running
deployment IS the checked-out commit (the DF-38 deploy-refresh mechanism is holding).

Promise under test (unchanged null hypothesis):
*"A user can benchmark AI models' Mafia-playing ability head-to-head through
`mafiactl` / API :3004 / web dashboard :5174, and the per-model win and cost
numbers they read are trustworthy."*

## What was actually driven (real use, not tests)

1. **Dashboard as a visitor** (headless chrome over CDP, 780x493 viewport):
   `/games` -> `Watch` on an IN_PROGRESS card -> `/watch/<id>`, then `/stats`,
   then `/benchmark`, then the New Game modal.
2. **API surface** with timings: `/health`, `/api/v1/stats`, `/api/v1/stats/matchups`,
   `/api/v1/games` (+`?status=`, `?limit=`), `/api/v1/games/:id`, `/api/v1/games/:id/state`,
   `/api/v1/games/:id/events`, `/api/v1/models`, `/api/v1/benchmark/report`,
   `/api/v1/benchmark/compare`.
3. **Store cross-examination** (read-only `better-sqlite3` inside the server
   container against `/app/data/mafia.db`): games by status, winner census,
   players by role/player-count, benchmark_games pairings, token_usage, model
   spellings, the 166 IN_PROGRESS rows and their event trails.
4. **Fresh-user install leg** on an ephemeral bunker agent (see below).

## What held up (verified live this tick)

| Claim | Evidence |
|---|---|
| Report and compare no longer contradict (DF-25) | both serve gpt-4o-mini 4133 games / 3478 wins / 84.2% in the same minute |
| One declared population for winners (DF-41) | `/api/v1/stats`: mafiaWins 88 + townWins 4052 = 4140 = completedGames; report `mafiaWinRate` 0.0212560 == 88/4140; `games.winner` NULL on 0 of 4623 ENDED rows |
| Role / player-count breakdown exposed (DF-39, API half) | `compare .data.models[0].rolePerformance` = DOCTOR 0.9994, MAFIA 0.0060 (21/3475), SHERIFF 0.9936, VIGILANTE 0.7938, VILLAGER 0.9985; `byNumPlayers` 5p 0.9997 (3382/3383), 10p 1.0 (91/91); `/benchmark/report` carries the same objects |
| Head-to-head derived (DF-40) | `/api/v1/stats/matchups` -> 1 matchup (openai/gpt-4o-mini vs openai/gpt-4o, 244 games, 19/71/154) reconciling with `benchmark_games` 265 rows = 244 ENDED + 19 IN_PROGRESS + 3 CANCELLED; the dashboard renders it as a chart canvas |
| New Game presets resolve against the catalog (DF-42) | modal has 5 role selects (Mafia, Sheriff, Doctor, **Vigilante**, Villager) populated from `GET /api/v1/models` (OPENAI/gpt-4o-mini … GROQ/llama-3.1-8b-instant); no phantom `openrouter` provider, no deepseek/qwen ids |
| Stats tab N+1 gone (PERF-MAFIA-4) | cold `/stats` load = **5** API requests (games x2, compare, stats, matchups); was 39-43 |
| Compare memoized (PERF-MAFIA-3) | warm 0.190-0.223 s x5 sequential; payload 2 511 240 B (192 KB encoded); single-client warm median 0.20 s |
| Documented install path | fresh user, clone -> build -> dev server -> 5 endpoints 200 with no `.env` (below) |

## What broke (filed this tick)

### 1. `DF-MAFIA-AI-BENCHMARK-23-R2` (P2) — 166 ghost IN_PROGRESS games, presented as LIVE

- Store: ENDED 4623, **IN_PROGRESS 166**, CANCELLED 22 (4811 total). Oldest 2026-06-19;
  still being added in batches: 2026-10-21 = 19, 2026-10-22 = 16, and 6 more at the
  02:30:20Z deploy (created 02:20:02-02:27:27Z, last events 02:20:54-02:30:16Z —
  the container was recreated 4 s after the newest game's last event).
- One screen, two answers: `/games` header reads **4811 Total Games / 0 Active /
  0 Setup / 4140 Completed** while the card directly below it reads
  **IN PROGRESS b70c44e6… Phase: In Progress [Watch]**. `/api/v1/stats.activeGames`
  = 0 (in-memory adapter map) vs `GET /api/v1/games?status=IN_PROGRESS&limit=1000`
  = 166 rows (DB status). Page 1 of the default list carries 11 such cards.
- Watch presents a corpse as live: `/watch/b70c44e6-…` shows **LIVE**, "Phase DAY
  DISCUSSION / Day 2 / Time 0s / Alive 5" and votes stamped "about 11 hours ago".
  `GET /api/v1/games/<id>/state` serves the frozen snapshot in 1.9 ms, so nothing
  in the payload says the engine is gone.
- Nothing retires them: boot logs `Benchmark run reconciliation: 0 recovered,
  0 left active, 0 inspected` — the reconciler inspects RUNS, not games.
- DF-23 was closed by making `/stats` honest (stop counting the ghosts); the rows,
  the list endpoint and the watch view were left alone, and the population grew
  97 -> 166.

### 2. `DF-MAFIA-AI-BENCHMARK-39-R2` (P2) — the leaderboard still sells seat assignment as skill

- API has the breakdown (above). The dashboard does not render it:
  `Model | Games | Wins | Win Rate | Avg Tokens/Game | Avg Cost/Game`, rows
  `openai/gpt-4o-mini 4133 3478 84.2% 72851 $0.0140` and
  `openai/gpt-4o 92 71 77.2% 524 $0.0186`; `BenchmarkLeaderboard.tsx` types the row
  with `winRate` only (line 8) and renders the column set at lines 126-162.
- Store truth for the same corpus: 5-player games are 4375 of 4623 ENDED, the mafia
  side wins 3.4% of them (147/4375), 10-player games are sane (84/243 = 34.6%).
  The 84.2% headline is the chance of being dealt town seats — the exact reading
  DF-39 was filed to stop.

### 3. `DF-MAFIA-AI-BENCHMARK-41-R2` (P3) — the report still does not declare its population

- `/benchmark/report .data.summary` = totalGames 4811, completedGames 4140,
  failedGames 188, **no mockGames**; 4811 - 4140 - 188 = 483 unexplained.
  `/benchmark/compare` publishes `mockGames: 483`. Store: 4140 non-mock + 483 mock
  = 4623 ENDED, + 166 IN_PROGRESS + 22 CANCELLED = 4811.

## Performance (Step 2b) — measured, nothing fileable

- `GET /api/v1/benchmark/compare`: 8 sequential, 1 s apart: 0.941 / 0.205 / 0.223 /
  0.192 / 0.810 / 0.190 / 0.192 / 0.198 s. Three concurrent (`xargs -P3`):
  0.409 / 0.635 / 0.636 s. Payload 2 511 240 B.
- The 0.8-0.9 s outliers coincide with a **second client**: a headless-chrome
  dashboard tab open on this host polls `/games`, `/stats`, `/stats/matchups` and
  `/benchmark/compare` every ~4 s (11 037 compare requests in 11 h; 304 responses
  still cost ~210-220 ms each). That is the dogfood harness's own browser, i.e.
  probe-rig load, not a product defect — and it is worth knowing that a conditional
  request pays full recompute to produce the ETag.
- User-visible page loads: `/stats` wall ~0.72 s to last response (DCL 10 ms);
  `/benchmark` renders leaderboard + chart + 40 history rows in the same window.
  **Verdict: fast enough — no PERF row filed.** PERF-MAFIA-3's AC (<0.300 s x3 warm)
  passes on a single client.

## Install leg (fresh user, ephemeral bunker agent)

- Designated host `bunker-las-03` remains unreachable (no route; carried by
  DF-MAFIA-AI-BENCHMARK-44). Substitute host **bunker-mvp** (daemon online) was used,
  exactly as on 2026-10-20; agent `df-mafia-1023` spawned and **destroyed** (a first
  destroy was correctly REFUSED because the dev server's tsx/esbuild children were
  still alive — killed, then destroy clean, key removed).
- Fresh user `bunker-df-mafia-1023`, 8 cpu: `git clone` (https, public) rc=0 **1 s** at
  HEAD `c44f985`; `node` **MISSING**, `pnpm` **MISSING** on a bare box (QUICK_START
  names them as prerequisites with no sudo-less recipe — carried by the README rows);
  user-space node v22.14.0 tarball 3 s; `npm i -g pnpm` 2 s (11.13.1);
  `CI=true pnpm install --frozen-lockfile` rc=0 **12 s**;
  `CI=true pnpm build` rc=0 **36 s** (dist/index.js emitted, 6261 B);
  documented start `pnpm --filter @mafia/server dev` with **no `.env`** -> healthy in 2 s:
  `/health` 200 (2.5 ms), `/api/v1/health` 200, `/api/v1/games` 200, `/api/v1/stats` 200,
  `/api/v1/benchmark/report` 200 (8.5 ms); `GAMES_HEAD={"success":true,"data":[],"count":0}`.
- **install ≈ 54 s** excluding the node bootstrap (clone 1 + node 3 + pnpm 2 + install 12 + build 36),
  plus 2 s to a healthy server. No residue: agent destroyed, key removed.

## Artefacts

- Board rows: `DF-MAFIA-AI-BENCHMARK-23-R2`, `DF-MAFIA-AI-BENCHMARK-39-R2`,
  `DF-MAFIA-AI-BENCHMARK-41-R2` (minted via `board_next_id.py --recur`,
  `boardctl validate` OK at the same 327-warning baseline).
- Evidence events: 713 (DF-47 recurrence + guard gap), 714 (PERF-MAFIA-3 numbers),
  715 (PERF-MAFIA-4 live proof), 716 (DF-42/DF-40 live proof).
- Coaching corrected in place: `.opencode/skills/mafia-usage/SKILL.md` — the
  "report summary reconciles" claim was false, the DF-25/DF-26 pitfalls were stale
  (both fixed), and the ghost-IN_PROGRESS trap is now documented. NOTE: `.opencode/`
  is gitignored, so this correction is local to this checkout and does not travel
  with a clone; the durable form of the same lesson is in the board rows above.
- Foreman NOT woken (read-only dogfood lane; cooldown/enablement untouched).

## Verdict

**PROMISING-BUT-ROUGH.** The benchmark machinery is honest end-to-end and the fixes
from the 10-20..10-22 wave are real and live (population identity, head-to-head
derivation, catalog-driven presets, Stats N+1 gone, compare memoized, install 54 s).
The two things a visitor meets first are still wrong: the product advertises 166
games as in progress that no process is playing, and its flagship leaderboard number
is a seat-assignment artifact with the corrective data sitting unrendered in the API.
