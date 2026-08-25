---
name: mafia-usage
description: How to USE the Mafia AI Benchmark (mafia-ai-benchmark) for real — working entry points (HTTP API :3004, web :5174, CLI mafiactl), verified commands, benchmark/report caveats, common pitfalls, and where the real game loop lives. Load this before running or evaluating anything in this repo. Last verified: 2026-08-24 dogfood run.
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
Benchmark games — based on real dogfood sessions (2026-08-06, 2026-08-15,
2026-08-24). The game loop, CLI, API, web, per-model wins, elimination
events, and cost recording all work. The remaining caveats are (a) the game
DETAIL response hides the result (winner/won/eliminatedPlayers — MAF-GAP-056),
(b) the second benchmark model's usage is mis-attributed to a phantom
`openai` row (MAF-GAP-057), and (c) spec drift on the game-object shape
(MAF-GAP-058). See the board in `.coding-hermes/board/tasks.jsonl` for the
live list.

## The truth in one paragraph

The **HTTP API on host `:3004`** (docker compose; container port `:3000` is
NOT the mafia API — host `:3000` belongs to another fleet daemon) works:
create a game and it auto-runs a REAL 5-10 agent Mafia game with live LLM
calls (~2-4 min, THINK/SAYS dialogue, votes, night actions, lynches,
winner). The **CLI** (`node apps/cli/dist/index.js`) works end-to-end:
`run-game --players 5 --yes` creates a game that completes in ~100-200 s;
`benchmark --games 1 --models A,B` POSTs a real run, prints progress lines
("⏳ [RUNNING] 0/1 games completed (elapsed 194s)"), and exits 0. The
**benchmark REPORT is real**: summary buckets reconcile, per-model wins are
attributed from `players.won` (gpt-4o-mini 370/1025 ≈ 36%), tokens/cost are
recorded. Caveats: the gpt-4o row shows 0 tokens (its usage lands on a bare
`openai` row — MAF-GAP-057), and game detail does not expose winner/won
(MAF-GAP-056).

## Entry points

| Surface | URL / command | Status |
|---------|---------------|--------|
| REST API | `http://localhost:3004` | ✅ works |
| SSE stream | `GET /api/v1/games/<id>/events` with `Accept: text/event-stream` | ✅ works |
| WebSocket | `ws://localhost:3004/ws` — protocol is `JOIN_GAME` (no `subscribe`) | ✅ works |
| Web dashboard | `http://localhost:5174` | ✅ serves; API+WS proxied at `/api/v1` and `/ws` |
| CLI run-game | `node apps/cli/dist/index.js run-game --players 5 --yes` | ✅ works |
| CLI watch-game | `node apps/cli/dist/index.js watch-game <gid>` | ✅ works (no more "Phase: undefined") |
| CLI benchmark | `node apps/cli/dist/index.js benchmark --games 1 --models openai/gpt-4o-mini,openai/gpt-4o` | ✅ works (≥2 models; progress lines print) |
| CLI report/stats | `benchmark --quick`, `stats` | ✅ works |

## Verified working recipe (real game in ~2 min)

```bash
# Option A — CLI (recommended)
node apps/cli/dist/index.js run-game --players 5 --yes
# → Game ID: <gid>; auto-plays on the server (~100-200 s for 5p)

# Option B — API (equivalent)
GID=$(curl -s -X POST http://localhost:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"config":{"numPlayers":5}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['gameId'])")

# Watch live
node apps/cli/dist/index.js watch-game $GID        # WS (JOIN_GAME protocol)
curl -N -H 'Accept: text/event-stream' http://localhost:3004/api/v1/games/$GID/events  # SSE

# Poll until ENDED. NOTE: winner is NOT in the detail body (MAF-GAP-056):
# read config.winner or parse the GAME_ENDED event (data.winner).
curl -s http://localhost:3004/api/v1/games/$GID

# Real benchmark run (pairwise; ~3.5 min for 1 game of 10p)
node apps/cli/dist/index.js benchmark --games 1 \
  --models openai/gpt-4o-mini,openai/gpt-4o --server http://localhost:3004
```

Event lifecycle: `GAME_STARTED → PHASE_CHANGED → NIGHT_ACTION_SUBMITTED →
AGENT_SAYS_BROADCASTED → VOTE_CAST → MORNING_REVEAL → PLAYER_LYNCHED →
GAME_ENDED` (with `data.winner`, `mafiaAlive`/`townAlive`).

Stats: `GET /api/v1/stats` (counters + avgDuration 174 s sane),
`GET /api/v1/benchmark/report` (summary reconciles: total == active +
completed + failed; per-model wins real), `GET /api/v1/benchmark/runs` +
`/runs/:id` (runId, status, config).

## Pitfalls (verified 2026-08-24)

- **Game detail hides the result**: `GET /api/v1/games/:id` returns NO
  `winner`, NO `won` per player, NO `eliminatedPlayers` — even though the
  DB has them and `config.winner` + the GAME_ENDED event carry the winner.
  Always read `config.winner` (list view) or the GAME_ENDED event. MAF-GAP-056.
- **Second-model usage is mislabeled**: benchmark runs with
  `openai/gpt-4o-mini,openai/gpt-4o` record gpt-4o's tokens under a bare
  `openai` row (provider CUSTOM) — the `openai/gpt-4o` row shows 0 tokens.
  Don't conclude gpt-4o is free; don't trust the `openai` row's 810K avg
  tokens as a real model. MAF-GAP-057.
- **wins:0 ≠ lost everything**: rows with `wins:0` can be "unattributable"
  (legacy usage-only rows with no side data). The CLI prints them as
  "Losses" (MAF-GAP-059) — read the API row + api-specs semantics instead.
- **`benchmark` needs ≥2 models**; a 10p pairing takes ~3.5-10 min —
  progress lines print every ~60 s now.
- **Default `--server` is `http://localhost:3004`** (correct). Host `:3000`
  is a different fleet daemon — never point anything at it.
- **WS protocol**: `JOIN_GAME` with `{gameId}` — there is no `subscribe`
  message type (sending one returns an ERROR message).
- **`events?limit=N` is ignored** — the events endpoint returns everything.
- **Real games cost real tokens** — 5p gpt-4o-mini ~$0.01, 10p benchmark
  game ~$0.07. Use cheap models for probing.
- **SSE on a completed game returns the full event list** (not a stream) —
  expected.

## Where the real game loop lives

- Legacy engine: `game-engine.js` (root) + `apps/server/src/services/
  legacy-game-adapter.ts` — THE engine that actually plays (real LLM calls).
  On `done` it persists status/ended_at/duration/config.winner +
  `setPlayersWon` + usage (legacy-game-adapter.ts:333-375).
- New engine shell: `apps/server/src/services/game-engine.ts` — create/join/
  roles only; NOT the path live games use (all live games are
  `engineType:"legacy"`). It's the only path that writes `games.winner`
  (updateGameResults) — which is why that column is NULL for all games.
- Benchmark runner: `apps/server/src/services/benchmark-runner.ts` (drives
  legacy games; runs tracked in `/api/v1/benchmark/runs`).
- Stats: `apps/server/src/services/stats-collector/` + `db/repository.ts`
  (getModelStats reads players.won for wins; token aggregates from
  token_usage).

## If asked "does this project work?"

Answer honestly: the game loop, CLI, API, web, per-model wins, eliminations,
and cost tracking all work end-to-end (verified 2026-08-24 with a live 10p
benchmark run that updated the report's win counters in seconds). What does
NOT work yet: the game detail endpoint hides the result (winner/won) and the
second model's usage is mis-attributed — MAF-GAP-056/057 on the board.
Verdict as of 2026-08-24: **PROMISING-BUT-ROUGH, trending SHIPPABLE**. Point
to `docs/dogfood/2026-08-24-integration.md` for the fresh recipe and
`docs/dogfood/diagnostics.md` for the full trail.
