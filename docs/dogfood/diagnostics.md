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

---

# 2026-08-15 — Second dogfood run: what changed, what broke, the right way

## How the system is actually built (verified by use, not by reading)

- **Game loop**: `POST /api/v1/games` creates a game that auto-starts on the
  **legacy engine** (`game-engine.js`, ~5,300 lines, run as a child process).
  The `LegacyAdapter` bridges the engine's stdout to persisted events
  (AGENT_SAYS_BROADCASTED, NIGHT_ACTION_SUBMITTED, MORNING_REVEAL,
  VOTE_CAST, PHASE_CHANGED, GAME_ENDED...). Real LLM calls happen inside the
  engine via the configured provider (`openai/gpt-4o-mini` default).
- **CLI**: `mafiactl run-game` only CREATES the game (exits immediately;
  watch with `mafiactl watch-game`). `mafiactl benchmark` POSTs a run
  (`/api/v1/benchmark`) and polls `/api/v1/benchmark/runs` until COMPLETED.
- **Stats/report**: `GET /api/v1/benchmark/report` aggregates real
  token/cost rows (works now) and derives `wins` from `players.won` — a
  field the write path never populates, so wins are structurally 0
  (MAF-GAP-043). Summary `mafiaWinRate` comes from `games.winner` and IS real.

## Errors hit today and their causes

| Error / symptom | Cause | Right way |
|---|---|---|
| `Night: undefineds` in run-game | CLI reads `nightDuration` from the create-game response; API never returns it (run-game.ts:64-66) | Read `config` fields that exist, or drop the line (MAF-GAP-046) |
| `Phase: undefined` in watch-game | initial WS state payload has no `phase` at the path read (watch-game.ts:117) | Map `currentState.phase` or omit (MAF-GAP-046) |
| `Benchmark requires at least 2 models, got 1.` | benchmark command validates pairwise runs; error gives no hint | State the pairwise design in the error/help (MAF-GAP-047) |
| 0 stdout for ~9.5 min during benchmark | CLI only prints at completion; no progress lines | Poll + print run status periodically (MAF-GAP-047) |
| `JSON parse failed for <player>, retrying (1..3/3)...` + `Unknown message type: undefined` (server log spam), empty SAYS `""`, canned `I think we should target someone suspicious.` | LLM output degenerates in long games (Day 6, compressed context); the bridge's parse retry crawls per player; the MAF-GAP-004 quality gate does not cover this path | Sanitize non-JSON output (skip player message after N retries), apply the SAYS gate in the bridge, cap retry storms (MAF-GAP-042) |
| `players.won` = null on every player of ENDED games | write path never records side/winner per player | Persist won at game end; wins then become real (MAF-GAP-043) |
| Lynched player `isAlive:true`, `eliminatedPlayers:[]`, no death event | adapter maps no elimination event; detail/currentState not updated post-game | Emit elimination events; derive isAlive/eliminated from them (MAF-GAP-044) |
| Report: `gpt-4o-mini` / `openai` / `openai/gpt-4o-mini` / `openai/gpt-4o` rows for the same models | aggregation keys on the raw model string; provider-only and provider-prefixed spellings never merged | Normalize keys; fix the api-specs.md claim (MAF-GAP-045) |

## The right way to verify a fix (from this session)

1. Create a game: `mafiactl run-game --players 5 --yes` (or curl POST).
2. Poll `GET /api/v1/games/:id` until `status=ENDED`; check
   `config.winner` and per-player `tokensUsed` (real usage ⇒ LLM path worked).
3. Check `GET /api/v1/games/:id/events` — expect 20+ events incl.
   AGENT_SAYS_BROADCASTED with non-empty `says`.
4. Run one benchmark pairing (≥2 models) and poll `/api/v1/benchmark/runs`
   — a 10p game takes ~7-10 min; verify run → COMPLETED and the game ENDED.
5. Snapshot `/api/v1/benchmark/report` before/after — rows must gain
   games and tokens; wins should become non-zero after MAF-GAP-043 lands.

## Bottom line (2026-08-15)

The CLI and benchmark paths — completely broken on 2026-08-06 — now work
end-to-end: real games, real personas, real tokens/cost, real run tracking.
What still blocks honest benchmarking: per-model win rates are structurally
0 (MAF-GAP-043), eliminations are invisible (MAF-GAP-044), and long
benchmark games can degenerate into empty-SAYS crawls (MAF-GAP-042).
Verdict stays **PROMISING-BUT-ROUGH** — the value is real and much closer
to the door, but the headline benchmark output is still not trustworthy.
