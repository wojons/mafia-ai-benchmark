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
