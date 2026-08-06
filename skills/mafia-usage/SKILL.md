---
name: mafia-usage
description: How to USE the Mafia AI Benchmark (mafia-ai-benchmark) for real — working entry points (HTTP API :3004, web :5174), the currently-broken CLI surfaces, verified commands, common pitfalls, and where the real game loop lives. Load this before running or evaluating anything in this repo.
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
Benchmark games — based on a real dogfood session (2026-08-06), not on the
docs. The docs promise a CLI (`mafiactl`) that is currently a silent no-op
shell; the HTTP API is the only fully working surface.

## The truth in one paragraph

The **HTTP API on host `:3004`** (docker compose; container port `:3000` is
NOT the mafia API — host `:3000` belongs to another fleet daemon) works:
create a game and it auto-runs a REAL 5-agent Mafia game with live LLM calls
(~2 min, full THINK/SAYS split-pane dialogue, votes, night actions, winner).
The **CLI** (`pnpm --filter @mafia/cli dev -- <cmd>`) is a no-op shell for
run-game/list-games/stats/init/benchmark/watch-game (missing `.action()`
wiring — MAF-GAP-009); only `config` works. The CLI `benchmark` command
fabricates results with `Math.random()` (MAF-GAP-010). `POST
/api/v1/benchmark` creates games that never progress (MAF-GAP-011). The
stats report can show fabricated "100% win rate" numbers when stats tables
are empty (MAF-GAP-012).

## Entry points

| Surface | URL / command | Status |
|---------|---------------|--------|
| REST API | `http://localhost:3004` | ✅ works |
| SSE stream | `GET /api/v1/games/<id>/events` with `Accept: text/event-stream` | ✅ works |
| WebSocket | `ws://localhost:3004/ws` | ✅ connects (handshake only) |
| Web dashboard | `http://localhost:5174` | ✅ serves; API proxied at `/api/v1` |
| CLI | `pnpm --filter @mafia/cli dev -- <cmd>` | 🔴 no-op except `config`/`help` |
| CLI benchmark | `... -- benchmark` | 🔴 fake numbers |

## Verified working recipe (real game in ~2 min)

```bash
# Create (auto-starts; players auto-join with generated personas)
GID=$(curl -s -X POST http://localhost:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"config":{"numPlayers":5}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['gameId'])")

# Watch live
curl -N -H 'Accept: text/event-stream' http://localhost:3004/api/v1/games/$GID/events

# Poll until ENDED (~2 min); winner in config.winner
curl -s http://localhost:3004/api/v1/games/$GID
```

Event lifecycle to expect: `GAME_STARTED → PHASE_CHANGED →
NIGHT_ACTION_SUBMITTED → AGENT_SAYS_BROADCASTED → VOTE_CAST →
MORNING_REVEAL → GAME_ENDED`.

Stats: `GET /api/v1/stats` (counters real), `GET
/api/v1/benchmark/report?format=json|csv` (model stats currently
untrustworthy — MAF-GAP-012).

## Pitfalls

- **Never trust the CLI for real use yet.** If a CLI command "works", check
  that it printed output AND exited — silent exit 0 means the no-op bug.
- **Default `--server` is `:3000`** (wrong host daemon) — always pass
  `--server http://localhost:3004` or set `MAFIA_SERVER_URL` if you must use
  the CLI (MAF-GAP-008).
- **`pnpm --filter @mafia/cli dev -- ...` uses `tsx watch`** — it does not
  exit after the command; wrap in `timeout` or use
  `pnpm --filter @mafia/cli exec tsx src/index.ts <cmd>` (but the documented
  `--` before the command breaks subcommand options).
- **`POST /api/v1/games/:id/run` and `.../players` don't exist** (404) —
  games auto-start and auto-join players.
- **A benchmark run (POST /api/v1/benchmark) will hang forever** — the new
  GameEngine has no game loop; there is no run-status endpoint. Don't start
  runs expecting results (MAF-GAP-011).
- **Server logs show repeated `API 400 ... rejected response_format —
  retrying WITHOUT structured output`** for some models — expected, harmless,
  the game still completes (but slowly).
- **5-player games show 2 players with role `UNASSIGNED`** — those are the
  plain villagers; the API role mapping is incomplete (MAF-GAP-013). They
  still play as villagers.
- **Real games cost real tokens** — a 5-player game uses the OpenRouter key
  in `.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL`). Prefer cheap
  models (e.g. `qwen3.6-35b-fast`) for probing. Nothing records the cost
  (MAF-GAP-012), so you cannot audit spend via the API.

## Where the real game loop lives

- Legacy engine: `game-engine.js` (root) + `apps/server/src/services/legacy-*
  ` — THE engine that actually plays (real LLM calls, ~2 min/game).
- New engine shell: `apps/server/src/services/game-engine.ts` — create/join/
  roles only, NO loop (this is why benchmark games stick).
- Pairing runner: `apps/server/src/services/benchmark-runner.ts` (drives the
  shell; stuck).
- Stats: `apps/server/src/services/stats-collector/` (fallback-heavy; the
  hardcoded model fallback in `models.ts` fabricates 100% win rates).

## If asked "does this project work?"

Answer honestly, with the caveats above: the simulation itself works
beautifully via the API/web; the benchmark and CLI surfaces are broken
(MAF-GAP-009..013 on the board); the project is PROMISING-BUT-ROUGH as of
2026-08-06. Point to `docs/dogfood/2026-08-06-integration.md` for the
working recipe and `docs/dogfood/diagnostics.md` for the full trail.
