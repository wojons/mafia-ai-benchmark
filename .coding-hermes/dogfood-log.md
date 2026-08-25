# Dogfood Log

| Date | Verdict | Promise | Top findings | Time-to-first-success |
|------|---------|---------|--------------|----------------------|
| 2026-08-06 | 🟡 PROMISING-BUT-ROUGH | "AI-powered Mafia game simulation that benchmarks different AI models' ability to play social deduction" | (1) CLI is a silent no-op shell — 6/7 commands never wire commander `.action()`, `mafiactl run-game` prints nothing and exits 0; (2) CLI `benchmark` fabricates results with `Math.random()` — never calls the server; (3) POST /api/v1/benchmark creates permanently STUCK games (new GameEngine has no game loop) + stats report fabricates a 100%-win-rate model from an empty-tables fallback; (4) cost tracking is hollow — 0 rows in token_usage/api_calls/agent_sessions after 411 games. | API: ~1 min (POST /api/v1/games → SSE). Documented CLI path: NEVER (silent no-op). |

## 2026-08-06 — Full dogfood run (cron)

**Promise statement (null hypothesis):** A user can benchmark AI models' Mafia-playing ability by running `mafiactl run-game` / `mafiactl benchmark` against the local server (or the HTTP API / web dashboard at :3004/:5174), and get real games with split-pane THINK/SAYS plus per-model win/cost statistics.

**What was actually done (real use, not tests):**
- Ran the documented CLI paths (`pnpm --filter @mafia/cli dev -- run-game --players 5 --auto`, `list-games`, `stats`, `init`, `benchmark --quick`, `watch-game`) — all silent no-ops except `config`/`help`/`version`. Exit code 0, zero output. Read source to find why: no `.action()` wiring.
- Hit the HTTP API at :3004 (docker compose, host port): created a 5-player game, it auto-ran on the legacy engine with REAL LLM calls (12 AGENT_SAYS_BROADCASTED with genuine THINK/SAYS persona dialogue, 5 VOTE_CAST, night actions, morning reveal, GAME_ENDED winner TOWN in ~2 min). SSE streaming verified live.
- Started a real API benchmark (run a437f937, 1 pairing qwen3.6-35b-fast vs openai/gpt-4o-mini, 1 game): the game stuck at GAME_STARTED (8 events, zero progress in 10+ min). BenchmarkRunner → GameEngine.startGame() only assigns roles and flips IN_PROGRESS; no game loop. No run-status endpoint exists (404s).
- Verified the stats report: model_aggregate_stats empty → hardcoded fallback reports qwen3.6-35b-fast 411 games / 411 wins / 100% win rate / 0 tokens / 0 cost. token_usage/api_calls/agent_sessions/player_game_stats: 0 rows.
- Verified persistence: named docker volume (`mafia-ai-benchmark_data` → /app/data/mafia.db, 10MB) — data survives container recreation.
- Ran full test suite: 8/8 turbo tasks pass (144 server tests pass, 8 skipped) — tests are green while real user paths are broken (tests call `cmd.run()` directly, never the argv/parse path).
- Verified MAF-GAP-008 (already on board): CLI `--server` defaults to :3000 which hosts DuckBrain's daemon, not the mafia server — default CLI invocations hang against it.

**Friction count: 13** (CLI no-op; CLI :3000 default hang; fake CLI benchmark; stuck API benchmark; no run-status endpoint; fabricated report; hollow cost tracking; `/run` 404 vs docs; `/players` 404 vs docs; `?limit=` ignored; villagers reported as UNASSIGNED; documented `exec tsx ... --` pattern breaks options; `dev` script (tsx watch) never exits after a command).

**Tasks written:** MAF-GAP-009 (P0 CLI no-op), MAF-GAP-010 (P1 fake CLI benchmark), MAF-GAP-011 (P1 stuck API benchmark), MAF-GAP-012 (P1 fabricated stats/hollow cost tracking), MAF-GAP-013 (P2 doc/API drift). See `.coding-hermes/board/tasks.jsonl`.

**Artifacts left:** docs/dogfood/2026-08-06-integration.md, docs/dogfood/diagnostics.md, .opencode/skills/mafia-usage/SKILL.md.

**Foreman:** already at CooldownS=900, Enabled=true — no wake-up needed.

| 2026-08-15 | 🟡 PROMISING-BUT-ROUGH | "Benchmark AI models' Mafia-playing ability via `mafiactl run-game`/`mafiactl benchmark`, HTTP API :3004, or web :5174, with per-model win/cost stats" | (1) per-model wins structurally 0 after 1083 games (players.won never populated — MAF-GAP-043); (2) eliminations invisible — lynched mafia has isAlive:true, no death event (MAF-GAP-044); (3) benchmark 10p game degenerated at Day 6 (empty/canned SAYS, JSON-parse retry crawl, ~2 min zero events; completed after ~9.5 min — MAF-GAP-042); (4) model keys fragmented (gpt-4o-mini/openai/openai/gpt-4o-mini) + CLI display warts (MAF-GAP-045/046/047) | CLI: ~1 min (run-game → game created; ENDED in 98 s). API: <30 s. |

## 2026-08-15 — Second full dogfood run (cron)

**Promise statement (null hypothesis):** A user can benchmark AI models'
Mafia-playing ability by running `mafiactl run-game` / `mafiactl benchmark`
against the local server (or the HTTP API / web dashboard at :3004/:5174),
and get real games with split-pane THINK/SAYS plus per-model win/cost
statistics.

**What was done (real use, not tests):**
- `mafiactl run-game --players 5 --yes` (live server :3004): game created,
  auto-played with real LLM calls, ENDED in ~98 s. Verified: roles
  (MAFIA/DOCTOR/SHERIFF/VILLAGER x2), per-player tokensUsed 6.0-11.4k,
  winner TOWN in config.winner, 26 events, rich persona SAYS. MAF-GAP-009
  (silent no-op CLI) is genuinely fixed.
- `mafiactl watch-game <gid>`: WS connect + stream works; prints
  "Phase: undefined" (MAF-GAP-046).
- `mafiactl benchmark --games 1 --models openai/gpt-4o-mini,openai/gpt-4o`:
  POSTs real run (bd6b1df3), server plays a 10p game (110 events, winner
  MAFIA), run COMPLETED. MAF-GAP-010/015 (fake benchmark) genuinely fixed.
  BUT: zero stdout for the whole ~9.5 min (MAF-GAP-047) and a Day-6
  degenerate-output crawl in server logs (MAF-GAP-042).
- HTTP API verified: /api/v1/health, games?limit=2 (honored), game detail
  (roles + per-player model/tokens), events + SSE, /api/v1/stats
  (avgDuration 197 s sane), /api/v1/benchmark/runs (COMPLETED rows).
- Report: summary real (1083 completed, mafiaWinRate 0.141, avgTokens
  46.9k/$0.0096 per gpt-4o-mini game) but EVERY modelPerformance row
  wins:0/winRate:0 and 3 spellings of the same model (MAF-GAP-043/045).
- Web dashboard :5174 serves; nginx proxy to API confirmed; no
  localhost:3000 hardcodes in the bundle.
- Friction count: 10. Time-to-first-success: ~1 min.

**Tasks written:** MAF-GAP-042 (P1 degenerate benchmark output),
MAF-GAP-043 (P1 wins structurally 0), MAF-GAP-044 (P1 eliminations
invisible), MAF-GAP-045 (P2 model key fragmentation), MAF-GAP-046 (P2 CLI
display undefineds), MAF-GAP-047 (P2 benchmark CLI UX). See
.coding-hermes/board/tasks.jsonl.

**Artifacts left:** docs/dogfood/2026-08-15-integration.md (new),
docs/dogfood/diagnostics.md (appended), .opencode/skills/mafia-usage/
SKILL.md (refreshed — was stale re: CLI).

**Foreman:** NOT woken — cooldown 21600 s is an operator pin in fleet.toml
(fleet convention: stand-in cycles skip G5 for this project); foreman
ticked PRODUCTIVE today at 13:18 and will pick the tasks up next tick.

| 2026-08-24 | 🟡 PROMISING-BUT-ROUGH (trending SHIPPABLE) | "Benchmark AI models' Mafia-playing ability via `mafiactl run-game`/`mafiactl benchmark`, HTTP API :3004, or web :5174, with per-model win/cost stats" | (1) game detail API omits the result — no winner/won/eliminatedPlayers on ENDED games, and games.winner column NULL for ALL 1610 games (584/1495 completed winnerless; mafiaWinRate 0.0368 deflated) — MAF-GAP-056; (2) second-model (gpt-4o) usage recorded as phantom 'openai' — report shows gpt-4o with 0 tokens and a fake 810K-token model — MAF-GAP-057; (3) spec drift: api-specs.md documents winner/aliveCount/deadCount/startedAt/finishedAt never returned (MAF-GAP-058) + CLI presents unattributable as losses (MAF-GAP-059). FIXED SINCE 08-15: per-model wins REAL (gpt-4o-mini 370/1025), eliminations visible (PLAYER_LYNCHED + isAlive), benchmark CLI prints progress, watch-game no "Phase: undefined" | CLI: ~1 min; full loop (run → ENDED → report updated): ~6 min |

## 2026-08-24 — Third full dogfood run (cron)

**Promise statement (null hypothesis):** A user can benchmark AI models'
Mafia-playing ability by running `mafiactl run-game` / `mafiactl benchmark`
against the local server (or the HTTP API / web dashboard at :3004/:5174),
and get real games with split-pane THINK/SAYS plus per-model win/cost
statistics.

**What was done (real use, not tests):**
- Full API surface probed against the live stack (server :3004 healthy 5d,
  web :5174): health (bare + /api/v1), games list (limit honored, status
  filter validates → 400 on bogus), game detail, events, SSE, stats,
  benchmark report + runs + run detail, WS JOIN_GAME protocol.
- Real CLI benchmark run: `mafiactl benchmark --games 1 --models
  openai/gpt-4o-mini,openai/gpt-4o` → run d7647a7c, real 10p game
  d988b26f (79 events, 5 PLAYER_LYNCHED, winner TOWN), 210 s, CLI printed
  progress lines (MAF-GAP-047 fixed), exited 0. Report updated in seconds:
  gpt-4o-mini 1024→1025 games, wins 369→370; gpt-4o 54→55, wins 33→34.
- DB truth via container sqlite: players.won=1/0 persisted (setPlayersWon
  works — MAF-GAP-043 write path REAL), but games.winner NULL for ALL 1610
  games (adapter writes json_set(config,'$.winner') only); players.tokens_used
  = 0 everywhere (bridge backfill never fills it); token_usage for gpt-4o
  players carries model='openai' (phantom row: 207 games, ~810K avg tokens).
- Web dashboard serves; /api + /ws proxied through nginx; bundle has no
  :3000 hardcodes.
- WS: JOIN_GAME → GAME_JOINED → GAME_STATE + events (no 'subscribe' type).

**Friction count: 8** (detail hides winner/won/eliminatedPlayers; games.winner
column never written on legacy path; gpt-4o usage → phantom openai row; spec
documents fields API never returns; CLI shows unattributable as losses +
winner banner ignores sample size; events?limit ignored; WS GAME_STATE phase
lags; run config says numPlayers 10 while roster grows 5→10).

**Tasks written:** MAF-GAP-056 (P1 detail omits result), MAF-GAP-057 (P2
usage mis-attribution), MAF-GAP-058 (P2 spec shape drift), MAF-GAP-059 (P3
CLI report warts). See .coding-hermes/board/tasks.jsonl.

**Artifacts left:** docs/dogfood/2026-08-24-integration.md (new),
docs/dogfood/diagnostics.md (appended), .opencode/skills/mafia-usage/
SKILL.md (refreshed — was stale re: wins/eliminations).

**Foreman:** woken via scheduler PUT CooldownS=900 (was 21600 fleet.toml
pin) — board has fresh P1/P2 work; self-pause logic will slow it back down.
