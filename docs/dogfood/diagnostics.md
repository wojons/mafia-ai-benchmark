# Mafia AI Benchmark — Diagnostics Trail

> How the system is actually built, why it has the shape it has, the errors
> encountered on the way (ours AND the project's own history), and the right
> way to do things. This is the "is this project worth anything" record —
> read this before judging by test colors.

## 1. The architecture in one picture

```
CLI (apps/cli, mafiactl, commander)   — SHELL, mostly non-functional (see §3)
Web (apps/web, React+Vite, :5174)     — SPA proxying /api/v1 through nginx
Server (apps/server, Express, :3004)  — the ONLY working surface
  ├─ routes/games.ts        — CRUD + SSE streaming
  ├─ routes/benchmark.ts    — POST /api/v1/benchmark (broken loop, §4)
  ├─ routes/stats.ts        — counters (real) + report (fabricated fallback, §5)
  ├─ services/legacy-game-adapter.ts — wraps game-engine.js (THE engine that plays)
  ├─ services/legacy-bridge.js       — spawns the legacy engine, parses output
  ├─ services/game-engine.ts         — NEW engine: create/join/assign-role shell, NO LOOP
  ├─ services/benchmark-runner.ts    — pairings → new GameEngine (→ stuck games)
  ├─ services/agent-coordinator.ts   — new-engine agent registry (unused by legacy)
  └─ services/stats-collector/       — wins/models/matchups/players (fallback-heavy)
Shared (packages/shared) — Game FSM, roles, providers, response parser, personas
Legacy engine (game-engine.js, ~5.3k lines) — the ACTUAL game loop, real LLM calls
```

**The core insight:** there are TWO engines. The legacy engine
(`game-engine.js` + `legacy-game-adapter.ts` + `legacy-bridge.js`) is the one
that actually plays games — it makes real LLM calls, emits THINK/SAYS events,
votes, night actions, and finishes in ~2 min. The NEW `GameEngine`
(`services/game-engine.ts`) is a lifecycle shell: it creates games, joins
players, assigns roles, flips status to IN_PROGRESS — and then **nothing
happens** (there is no game loop, no LLM calls). The benchmark runner drives
the NEW engine, which is why benchmark games never progress.

## 2. Why the architecture is the way it is

- The project grew from a single-file demo (`game-engine.js`, root) into a
  pnpm monorepo (server/web/cli/shared). The legacy engine was kept as the
  working core; the new engine was started as a "proper" TypeScript
  replacement but only the lifecycle part was built (create/join/roles). The
  game loop port never happened — the premature-completion pattern: the shell
  "looks complete", tests pass, but nothing runs.
- The stats collector has **fallbacks everywhere** because the legacy engine
  never writes to the new tables (`token_usage`, `api_calls`,
  `agent_sessions`, `player_game_stats`, `model_aggregate_stats` are all 0
  rows after 411+ games). The fallback in `getModelComparison()`
  (stats-collector/models.ts:38-63) hardcodes `neuralwatt/qwen3.6-35b-fast`
  and counts ANY ended game with a winner as a win — producing the absurd
  "411 games, 411 wins, 100% win rate, $0 cost" report.
- Cost tracking ("💰 Cost Tracking: Track API costs per game and player" in
  the README) exists as tables + collector methods but the legacy bridge
  never records usage, so it is hollow. The `[API] 400 ... rejected
  response_format` retry path in the legacy engine shows LLM calls do happen,
  but nothing tallies them.

## 3. The CLI: why "20/20 tests pass" and yet nothing works

`apps/cli/src/index.ts` registers command CLASSES (`program.addCommand(new
RunGameCommand())`). Each class defines `run()` but never calls
`this.action(...)`. Commander only executes a command through its action
handler — with no handler, parsing succeeds, nothing runs, exit 0. Only
`config.ts` wires `cmd.action(...)` (its subcommands work).

The tests (e.g. `__tests__/list-games.test.ts:51`) call `await cmd.run()`
DIRECTLY — they bypass `program.parseAsync()` entirely, so the dead wiring is
invisible to the suite. **This is the canonical "tests green ≠ works" case in
this repo: the fix (MAF-GAP-009) must include a parse-level test that runs
real argv through `program.parseAsync()`.**

Additional CLI warts found during the run:
- `--server` defaults to `http://localhost:3000` in 5 commands — on this
  host that is another fleet daemon (DuckBrain), not the mafia server
  (MAF-GAP-008, already on the board; verified: default `list-games` hangs).
- `benchmark.ts runBenchmark()` fakes everything with `Math.random()`
  (MAF-GAP-010) and has no `--server` flag at all.
- The `dev` script is `tsx watch` — it never exits after a command finishes.
- The documented `pnpm --filter @mafia/cli exec tsx src/index.ts -- <cmd>`
  invocation pattern mangles subcommand options (`benchmark --quick` →
  `error: unknown command '--quick'`).

## 4. The benchmark: promise vs reality

- **CLI** (`mafiactl benchmark`): fabricated numbers. Never touches a server.
- **API** (`POST /api/v1/benchmark`): real pairing infrastructure exists
  (`benchmark_runs`, `benchmark_games` tables, `BenchmarkRunner` class) —
  BUT the games it creates are driven by the new GameEngine shell and never
  advance past GAME_STARTED. My live run (a437f937) produced one game stuck
  at 8 events for 10+ minutes while a same-size legacy game completed in
  ~2 minutes. There is also no way to observe a run: `GET
  /api/v1/benchmark/runs` and `/api/v1/benchmark/:id` both 404.
- Before my run, `benchmark_games` contained ZERO rows despite 411 completed
  games — the benchmark infrastructure had never been exercised end-to-end.

## 5. The right way (verified working)

1. **To play/benchmark for real TODAY:** use the HTTP API on `:3004`
   (`POST /api/v1/games` auto-starts a real legacy-engine game; stream
   `/api/v1/games/:id/events` with `Accept: text/event-stream`). The web
   dashboard on `:5174` proxies the same API. See
   `docs/dogfood/2026-08-06-integration.md` for the full working recipe.
2. **To fix the benchmark:** make `BenchmarkRunner` drive the legacy engine
   (the path that plays) or finish the new GameEngine's loop; expose run
   status (`GET /api/v1/benchmark/runs`, `GET /api/v1/benchmark/:id`) — the
   `BenchmarkRunStatus`/`BenchmarkProgress` types already exist.
3. **To fix stats:** record token/cost usage in `legacy-bridge.js` (the
   `token_usage`/`api_calls` tables and collector methods already exist),
   and make `getModelComparison` return an honest empty result instead of
   the hardcoded fallback.
4. **To fix the CLI:** wire actions, then add parse-level tests; make
   `--server` default to `http://localhost:3004` (or read `MAFIA_SERVER_URL`).

## 6. Errors encountered during the dogfood run (with fixes when known)

| Error | Where | Fix direction |
|-------|-------|---------------|
| `mafiactl run-game` silent exit 0 | apps/cli commands | `.action()` wiring (MAF-GAP-009) |
| CLI default `:3000` hang | 5 CLI commands | default `:3004` (MAF-GAP-008) |
| `unknown command '--quick'` | docs' `exec ... --` pattern | fix docs or CLI arg handling |
| `Route POST .../run not found` | QUICK_START vs routes | doc alignment (MAF-GAP-013) |
| `Route POST .../players not found` | SYSTEM_STATUS vs routes | doc alignment (MAF-GAP-013) |
| Benchmark game stuck at GAME_STARTED | new GameEngine | loop or legacy bridge (MAF-GAP-011) |
| Report: 411/411 wins, 0 cost | stats fallback | honest fallback + usage recording (MAF-GAP-012) |
| `API 400 rejected response_format` (retry works) | legacy engine vs OpenRouter | pre-detect model support or skip response_format |
| Villagers shown as `UNASSIGNED` | legacy parser role mapping | map VILLAGER in adapter (MAF-GAP-013) |
| `?limit=2` returns 29 games | games list route | honor limit param (MAF-GAP-013) |

## 7. Bottom line

The **simulation is real and delightful** — watching five LLM personas with
distinct backstories discuss, scheme, and vote with private THINK vs public
SAYS is genuinely impressive, and it works end-to-end via the API. But the
project's three outward-facing doors (CLI, CLI benchmark, API benchmark) are
broken, and its statistics layer actively fabricates data. It is
PROMISING-BUT-ROUGH: real value underneath, usability and honesty are the
blockers. MAF-GAP-009 is the P0 — a user following QUICK_START today gets
nothing.
