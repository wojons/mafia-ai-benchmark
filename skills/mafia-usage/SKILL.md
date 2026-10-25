---
name: mafia-usage
description: How to USE the Mafia AI Benchmark (mafia-ai-benchmark) for real — working HTTP API :3004, web :5174, CLI mafiactl, verified commands, benchmark/report caveats, current ghost-game traps, and where the real game loop lives. Load this before running or evaluating anything in this repo. Last verified: 2026-10-23 dogfood run.
license: MIT
compatibility: opencode
metadata:
  workflow: usage
  outputs: "games, events, stats"
tags:
  vertical: [mafia, benchmark, llm-games]
  category: usage
  core: false
---

## What I do

I teach agents (and humans) how to actually run and observe Mafia AI
Benchmark games. The game loop, CLI, API, web, elimination events, and cost
recording work on the current stack. The historical defects below are closed:

- DF-MAFIA-AI-BENCHMARK-10: web create-game responses are normalized from
  `gameId` to `id`, and creation failures are visible in the modal.
- DF-MAFIA-AI-BENCHMARK-11: `/watch/:gameId` hydrates recorded history, then
  merges live WebSocket events without duplicate rows.
- DF-MAFIA-AI-BENCHMARK-34: `ADMIN_AUTH_TOKEN` is enforced on WebSocket
  delivery as well as HTTP; anonymous clients receive public frames only.
- DF-MAFIA-AI-BENCHMARK-35: `POST /api/v1/games` accepts and validates the
  documented nested `config.numPlayers` shape.

Current operational caveats matter more than those old reports: persisted
`IN_PROGRESS` rows can be corpses after a restart, report summary population
needs an explicit mock-game census, and blended model win rates are dominated
by seat and player-count assignment. The live board is in
`.coding-hermes/board/tasks.jsonl`.

## The truth in one paragraph

The HTTP API on host `:3004` (Docker Compose; container port `:3000` is
internal and host `:3000` belongs to another fleet daemon) creates and runs
real 5–10-agent Mafia games with live LLM calls. The CLI built binary works
end-to-end for `run-game`, `watch-game`, and pairwise `benchmark` runs. The
web dashboard serves the game list, create flow, and `/watch/:gameId`
spectator route; the watcher replays recorded events and can receive live
frames. `/api/v1/benchmark/report` contains useful per-model results, but its
summary does not state the full mock-game population; compare publishes that
population separately. Never treat a blended win rate as model skill without
splitting it by role and player count.

## Entry points

| Surface | URL / command | Status |
|---------|---------------|--------|
| REST API | `http://localhost:3004` | ✅ works (`/health` and `/api/v1/health`) |
| SSE stream | `GET /api/v1/games/<id>/events` with `Accept: text/event-stream` | ✅ works; completed games return their full event list |
| WebSocket | `ws://localhost:3004/ws` — send `{type:'JOIN_GAME', payload:{gameId}}` | ✅ `CONNECTED` → `GAME_JOINED` → live `GAME_EVENT` frames |
| Web dashboard | `http://localhost:5174` | ✅ API and WS are proxied; `/watch/:gameId` replays history |
| CLI run-game | `node apps/cli/dist/index.js run-game --players 5 --yes` | ✅ works |
| CLI watch-game | `node apps/cli/dist/index.js watch-game <gid>` | ✅ works |
| CLI benchmark | `node apps/cli/dist/index.js benchmark --games 1 --models A,B` | ✅ works; requires at least two models |
| CLI report/stats | `benchmark --quick`, `stats` | ✅ works; inspect population and attribution caveats |

## Verified working recipe

```bash
# Build first from the repository root.
pnpm install
pnpm build

# Option A — CLI (recommended on a running stack)
node apps/cli/dist/index.js run-game --players 5 --yes
# → Game ID: <gid>; the server runs the game asynchronously

# Option B — API (equivalent)
GID=$(curl -s -X POST http://localhost:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"config":{"numPlayers":5}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['gameId'])")

# Watch live through the CLI and inspect both event transports.
node apps/cli/dist/index.js watch-game "$GID"
curl -N -H 'Accept: text/event-stream' \
  "http://localhost:3004/api/v1/games/$GID/events"

# Poll the result after the game ends.
curl -s "http://localhost:3004/api/v1/games/$GID" | jq '.data | {status, winner, players}'

# Pairwise benchmark run.
node apps/cli/dist/index.js benchmark --games 1 \
  --models openai/gpt-4o-mini,openai/gpt-4o --server http://localhost:3004
```

The event lifecycle includes `GAME_STARTED`, `PHASE_CHANGED`,
`NIGHT_ACTION_SUBMITTED`, `AGENT_SAYS_BROADCASTED`, `VOTE_CAST`,
`MORNING_REVEAL`, `PLAYER_LYNCHED`, and `GAME_ENDED`. Dialogue is under
`event.data.{think,says}`; a probe that reads a nonexistent `payload` field is
reading the wrong shape.

## Fresh-install recipe

For a fresh clone, use the Docker path when Docker and Compose are available:

```bash
git clone https://github.com/wojons/mafia-ai-benchmark.git
cd mafia-ai-benchmark
cp .env.sample .env
# Put a real provider key in .env before collecting benchmark statistics.
docker compose up -d --build
curl -fsS http://localhost:3004/health
```

The non-Docker path needs Node 20+, pnpm, a real `.env`, the shared package
build, and the server data directory:

```bash
pnpm install
pnpm build
mkdir -p apps/server/data
pnpm run server
node apps/cli/dist/index.js run-game --players 5 --yes
```

A placeholder key can produce canned mock games in the same persistence and
statistics tables. Do not use those rows as model evidence.

## Pitfalls and verification rules

- **A placeholder key pollutes statistics.** The canned-mock fallback can
  complete games in seconds. Use a real key and record the served model before
  treating a run as benchmark data.
- **A blended win rate is not skill.** Split `/api/v1/benchmark/compare`
  or `/api/v1/benchmark/report` by `rolePerformance` and `byNumPlayers`.
  A corpus dominated by five-player games or favorable seats can make a weak
  model look excellent.
- **The report and compare population surfaces differ.** The report summary
  publishes completed/failed totals but omits the mock-game count; compare
  publishes `mockGames`. Account for both before claiming that totals explain
  the database census.
- **`IN_PROGRESS` is not proof that a game is running.** This is the ghost
  `IN_PROGRESS` trap: persisted rows can survive a container restart without
  a live owner, and `/watch/<id>` may render a LIVE badge over a frozen
  snapshot. `/api/v1/stats.activeGames` is an in-memory owner count, while
  `GET /api/v1/games?status=IN_PROGRESS` reads persisted rows. Before calling
  a game live, poll `GET /api/v1/games/<id>/state` more than once and confirm
  that `turnNumber` advances and new events arrive. Reconciliation log counts
  benchmark runs, not every persisted game row.
- **The documented nested create shape is supported.**
  `POST /api/v1/games` with `{"config":{"numPlayers":10}}` resolves and
  validates the nested value. MAF-REV-001 covers the documented request
  validation surface, including malformed player counts, engine types, and
  role-model entries with named `400` errors.
- **ADMIN visibility is opt-in and per client.** MAF-REV-004 governs HTTP
  ADMIN reads and the WebSocket path. With `ADMIN_AUTH_TOKEN` enabled, an
  anonymous socket receives public frames only; a valid Bearer token,
  `X-Admin-Token`, or browser `?token=` upgrade parameter can receive the
  full feed. The dashboard's optional `VITE_ADMIN_TOKEN` supplies that query
  parameter. Do not expose ADMIN/private frames in a public capture.
- **WebSocket frame shape is exact.** Send
  `{type:'JOIN_GAME', payload:{gameId}}`; a bare top-level `{gameId}` is
  rejected. `SUBSCRIBE {gameId}` is an alias accepted by the server. The
  `GAME_EVENT` event row is in the envelope's `payload`.
- **Prefer the built CLI binary for live probes.** It avoids package-manager
  lifecycle noise and makes the command's server target explicit.
- **Run-scoped benchmark truth beats the closing banner.** Read
  `GET /api/v1/benchmark/<runId>` and its `benchmark_games` rows. A global
  report or a CLI winner banner can include historical games unrelated to the
  run you just started.
- **Event pagination is part of the served API contract.** Use the documented
  `events?limit=N` query and verify the returned slice when a smaller view is
  needed; do not infer route behavior from an old full-list observation.
- **Real games cost real tokens.** Use cheap models for probes and preserve
  model/provider names plus usage output with the run evidence.

## Where the real game loop lives

- Legacy engine: `game-engine.js` plus
  `apps/server/src/services/legacy-game-adapter.ts`; this is the live game
  path and records events, results, and provider usage.
- New engine shell: `apps/server/src/services/game-engine.ts`; it supplies
  create/join/role mechanics but live benchmark games use the legacy adapter.
- Benchmark runner: `apps/server/src/services/benchmark-runner.ts`; it drives
  legacy games and tracks benchmark runs and pairings.
- Stats: `apps/server/src/services/stats-collector/` and
  `apps/server/src/db/repository.ts`; inspect the raw census alongside the
  report and compare projections.
- CLI flag plumbing: `apps/cli/src/index.ts` strips the pnpm separator and
  `apps/cli/src/commands/benchmark.ts` resolves timeout values.

## If asked “does this project work?”

Answer: the core game loop, API, CLI, web create flow, spectator history, live
WS delivery, elimination events, and cost recording work end-to-end. The
closed defects DF-MAFIA-AI-BENCHMARK-10, -11, -34, and -35 must not be
reported as open. Qualify any broader verdict with the current caveats:
mock-game contamination, ghost persisted `IN_PROGRESS` rows, incomplete
report population disclosure, and seat/player-count confounding in blended
win rates. Use `docs/dogfood/2026-10-23-integration.md` and the live board for
current evidence; do not infer runtime truth from a stale skill copy.
