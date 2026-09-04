
## Dogfood Findings (2026-09-01)
Verdict: PROMISING-BUT-ROUGH
Promise: {"entry_point":"CLI (mafiactl via apps/cli, e.g. `pnpm --filter @mafia/cli dev -- benchmark`), with a secondary HTTP entry point: Express REST API + WebSocket server (:3004, /ws) and React dashboard (:5174).","promise":"This project claims a user can benchmark the strategic-deception ability of any model head-to-head in a live Mafia game."}

- [P1] Documented benchmark command cannot complete in one invocation — `pnpm --filter @mafia/cli dev -- benchmark --models openai/gpt-4o-mini,openai/gpt-4o` (2 games x 10 players) hits the CLI's 600s RUN_TIMEOUT with 0/2 completed and exit 1; games actually average 13m42s each at 10 players.
- [P1] Model attribution silently contaminated by environment + roleModel gap — Engine reads DEFAULT_MODEL, not the .env's documented MODEL=qwen3.6-35b-fast, and inherits ambient env: the judge's exported DEFAULT_MODEL=moonshotai/Kimi-K2.6 became the model for every unassigned role.
- [P1] --server flag silently dropped through the documented pnpm invocation — `pnpm --filter @mafia/cli dev -- benchmark --server <url>` forwards a literal `--` so commander stops parsing and the flag is ignored — the CLI queried the default :3004 (the live fleet stack) instead.
- [P1] Live game state untruthful: phase frozen at SETUP for the entire game — currentState.phase reported SETUP for each game's whole life while real votes/lynchings happened, flipping only to GAME_OVER at the end — so watch-game and the dashboard's live view are frozen/mislead.
- [P2] Data/config polish: duplicated listings, dead WS_PORT, 500-vs-400, WS flake — GET /api/v1/games returns every legacy game twice (6 rows, 3 unique ids, duplicated createdAt) and CLI list-games mirrors it; WS_PORT=3001 in .env.sample is dead config (WS actually lives at /ws on the HTTP port).

## Dogfood Findings (2026-09-04)
Verdict: PROMISING-BUT-ROUGH
Promise: {"entry_point":"TypeScript CLI (mafiactl, via pnpm --filter @mafia/cli: game:run, benchmark, stats, list-games, config) driving an Express REST API + WebSocket game server (apps/server, host :3004, WS /ws) with a React/Vite dashboard (apps/web, :5174/benchmark); also usable via Docker Compose or as 
- [P0] CLI flag-swallowing silently queries the wrong server — 'pnpm --filter @mafia/cli dev -- benchmark --server <url>' drops every flag after '--' (commander end-of-options); negative control proved the CLI hit the live fleet server on :3004 instead of the tar
- [P0] Benchmark headline metric is broken: /benchmark/compare doubles wins — getCompareReport sums SUM(CASE WHEN p.won=1) over per-role player rows instead of counting distinct won games (gamesPlayed uses COUNT(DISTINCT game_id) but wins does not) — gpt-4o-mini reported gamesP
- [P0] In-flight benchmark work is not durable: SIGKILL leaves run RUNNING forever with no recovery — Benchmark runner registry is in-memory: SIGKILL mid-run left the run frozen RUNNING and its game's /events 404'd after restart (no stale-run cleanup, no server-side rehydration); the CLI runner would 
- [P1] Env contamination silently corrupts model attribution — Engine resolves unassigned roles from DEFAULT_MODEL, which dotenv does not override — an ambient exported DEFAULT_MODEL=moonshotai/Kimi-K2.6 silently replaced every unassigned role's model while the r
- [P2] Negative path, docs, and API-shape rough edges — Malformed JSON POST /api/v1/games returns 500 INTERNAL_ERROR (no body-validation error handler on express.json) instead of 400; GET /api/v1/games returned 7 rows for 5 unique active game IDs; WS proto
