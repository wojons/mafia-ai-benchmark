---
name: mafia-usage
description: How to USE the Mafia AI Benchmark (mafia-ai-benchmark) for real — working entry points (HTTP API :3004, web :5174, CLI mafiactl), the fresh-install recipe that actually works, benchmark/report caveats (compare winRate bug!), common pitfalls, and where the real game loop lives. Load this before running or evaluating anything in this repo. Last verified: 2026-09-09 dogfood run.
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
Benchmark games — based on real dogfood sessions (2026-08-06, 08-15,
08-24, 09-01/04, 09-09). The game loop, CLI, API, web, per-player
results, and elimination events all work. The two defects that matter
right now: (a) **`/api/v1/benchmark/compare` reports winRate > 1**
(e.g. 3.82 = 382%) because wins are summed over player rows — never
quote those numbers (DF-MAFIA-AI-BENCHMARK-2); (b) benchmark **runs**
can be stuck `RUNNING` forever after a server restart — no startup
sweep exists (DF-MAFIA-AI-BENCHMARK-3). Live list:
`.coding-hermes/board/tasks.jsonl`.

## The truth in one paragraph

The **HTTP API on host `:3004`** (docker compose; container port `:3000`
is internal only — host `:3000` belongs to another fleet daemon) works:
create a game and it auto-runs a REAL 5-10 agent Mafia game with live LLM
calls (~100 s for 5p, 3.5-10 min for 10p; THINK/SAYS dialogue, votes,
night actions, lynches, winner). The **CLI** (`pnpm --filter @mafia/cli
dev -- …` or `node apps/cli/dist/index.js …`) works end-to-end including
flag passthrough (`--server`, `--timeout`, `--models`) since dd63a31.
Game detail NOW returns `winner` + per-player `role`/`won` (old
MAF-GAP-056 caveat is fixed — don't repeat it). The per-model **report**
(`/api/v1/benchmark/report`) attributes wins correctly from `players.won`;
**the `compare` endpoint is the broken one** — wins/wonRows inflated
~4×, winRate 3-4.5 observed 2026-09-09.

## Entry points

| Surface | URL / command | Status |
|---------|---------------|--------|
| REST API | `http://localhost:3004` | ✅ works (`/health` and `/api/v1/health` both live) |
| SSE stream | `GET /api/v1/games/<id>/events` with `Accept: text/event-stream` | ✅ works |
| WebSocket | `ws://localhost:3004/ws` — protocol is `JOIN_GAME` (no `subscribe`) | ✅ works |
| Web dashboard | `http://localhost:5174` | ✅ serves; API+WS proxied at `/api/v1` and `/ws` |
| CLI run-game | `pnpm --filter @mafia/cli dev -- run-game --players 5 --yes` | ✅ works (exit 0, ~1 s to create) |
| CLI watch-game | `… dev -- watch-game <gid>` | ✅ works |
| CLI benchmark | `… dev -- benchmark --games 1 --models openai/gpt-4o-mini,openai/gpt-4o` | ✅ works; `--timeout <min>` (default 30, 0=∞) |
| per-model report | `GET /api/v1/benchmark/report` | ✅ wins real |
| per-model compare | `GET /api/v1/benchmark/compare` | ❌ **winRate >1 bug** (DF-2) — read report instead |

## Fresh-install recipe (the one that actually works — bunker-verified 2026-09-09)

```bash
# Prereqs: Node ≥ 20, pnpm. Then:
git clone https://github.com/wojons/mafia-ai-benchmark.git && cd mafia-ai-benchmark
echo 'OPENAI_API_KEY=sk-or-v1-YOUR-KEY' >> .env
pnpm install                 # ~17 s
pnpm build                   # REQUIRED — QUICK_START omits this; server
                             # crashes without @mafia/shared/dist/**
mkdir -p apps/server/data    # REQUIRED — server crashes otherwise: the DB
                             # path is cwd-relative and the `server` script
                             # runs inside apps/server/ (root ./data is the
                             # WRONG dir — this trips everyone)
pnpm run server              # healthy on :3004
pnpm --filter @mafia/cli dev -- run-game --players 5 --yes   # first game
```

Or skip all repairs: `docker compose up -d --build` (server :3004, web
:5174) — the docs don't mention this path but it needs nothing else.
A bare Debian host needs the docker-compose plugin
(`~/.docker/cli-plugins/`) as a non-root user.

## Verified working recipe (game in ~2 min on a running stack)

```bash
GID=$(curl -s -X POST http://localhost:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"config":{"numPlayers":5}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['gameId'])")

# Watch live
pnpm --filter @mafia/cli dev -- watch-game $GID
curl -N -H 'Accept: text/event-stream' http://localhost:3004/api/v1/games/$GID/events  # SSE

# Result — detail now carries it directly:
curl -s http://localhost:3004/api/v1/games/$GID | jq '.data | {status, winner}'
```

Event lifecycle: `GAME_STARTED → PHASE_CHANGED → NIGHT_ACTION_SUBMITTED →
AGENT_SAYS_BROADCASTED → VOTE_CAST → MORNING_REVEAL → PLAYER_LYNCHED →
GAME_ENDED` (`data.winner`). Dialogue text lives in
`event.data.{think,says}` — **there is no `payload` key** on events
(a probe reading `payload` sees "empty" dialogue that is actually there).

## Pitfalls (verified 2026-09-09)

- **Never quote `/benchmark/compare` winRates** — wins=SUM over player
  rows (winning team members), gamesPlayed=COUNT(DISTINCT game_id):
  winRate 3.82 observed. Use `/benchmark/report` (correct attribution)
  or compute from `players.won` yourself: wins should be
  `COUNT(DISTINCT CASE WHEN won=1 THEN game_id END)`. DF-MAFIA-AI-BENCHMARK-2.
- **Benchmark runs are not durable** — server restart mid-run leaves the
  run `RUNNING` forever (18 such rows exist on the fleet stack). Check
  `updated_at` before trusting a RUNNING row; the run-detail endpoint
  will not correct itself. DF-MAFIA-AI-BENCHMARK-3.
- **`benchmark` needs ≥2 models**; 10p games average ~13-14 min; default
  CLI wait is now 30 min (`--timeout <min>`, 0 = wait forever).
- **`--timeout -5`** is rejected up front with a clear error (good).
- **Default `--server` is `http://localhost:3004`** (correct). Host
  `:3000` is a different fleet daemon — never point anything at it.
- **Flags DO survive `pnpm --filter @mafia/cli dev --` now** (the literal
  `--` separator is stripped in `apps/cli/src/index.ts`). Older notes
  claiming flags get swallowed are stale.
- **WS protocol**: `JOIN_GAME` with `{gameId}` — no `subscribe` type.
- **`events?limit=N` is ignored** — the endpoint returns everything.
- **Real games cost real tokens** — 5p gpt-4o-mini ~$0.01, 10p ~$0.07.
  Use cheap models for probing.
- **SSE on a completed game returns the full event list** (not a
  stream) — expected.

## Where the real game loop lives

- Legacy engine: `game-engine.js` (root) + `apps/server/src/services/
  legacy-game-adapter.ts` — THE engine that actually plays (real LLM
  calls). Persists status/ended_at/duration/config.winner +
  setPlayersWon + usage.
- New engine shell: `apps/server/src/services/game-engine.ts` —
  create/join/roles only; NOT the path live games use (all live games
  are `engineType:"legacy"`). It's the only writer of `games.winner`.
- Benchmark runner: `apps/server/src/services/benchmark-runner.ts`
  (drives legacy games; runs in `/api/v1/benchmark/runs`; completion is
  event-subscription bound — restart = orphaned RUNNING runs).
- Stats: `apps/server/src/services/stats-collector/` — `models.ts`
  `getCompareReport` is the compare endpoint (broken wins, DF-2);
  `getModelStats` path feeding `/benchmark/report` is correct.
- CLI flag plumbing: `apps/cli/src/index.ts` (`--` strip) +
  `apps/cli/src/commands/benchmark.ts` (timeout resolution).

## If asked "does this project work?"

Answer honestly: the core product — real AI Mafia games via API/CLI/web
with correct per-game results and a correct per-model REPORT — works
end-to-end, on a running stack AND from a fresh clone (after three
undocumented repairs; fresh-clone game 27ed9f46: ENDED winner=TOWN ~99 s,
12/12 non-empty dialogue). What does NOT work: the compare endpoint's
per-model winRates (>100%, P0, three runs old) and run durability across
restarts (18 orphaned RUNNING rows). Fresh-install docs (QUICK_START)
are wrong in two places (no `pnpm build`; wrong data dir).
Verdict as of 2026-09-09: **PROMISING-BUT-ROUGH** — the product works;
the install docs and two benchmark-data defects are the gap.
Point to `docs/dogfood/2026-09-09-integration.md` for the fresh recipe
and `docs/dogfood/diagnostics.md` for the full trail.
