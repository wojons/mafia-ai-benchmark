---
name: mafia-usage
description: How to USE the Mafia AI Benchmark (mafia-ai-benchmark) for real — working entry points (HTTP API :3004, web :5174, CLI mafiactl), the fresh-install recipe that actually works (docker compose path verified 2026-09-24), benchmark caveats (mock-key games pollute stats), web UI broken flows, and common pitfalls. Load this before running or evaluating anything in this repo. Last verified: 2026-09-24 dogfood run.
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
08-24, 09-01/04, 09-09, 09-24). The game loop, CLI, API, per-player
results, and elimination events all work. State as of 2026-09-24:
(a) the old compare winRate>1 bug is FIXED (tick 199, commit 7fba228 —
winRate ≤1 verified live); (b) startup reconciliation now exists for
benchmark runs, but truly-abandoned runs stay RUNNING until you POST
`/api/v1/benchmark/<runId>/cancel` (undocumented but it works);
(c) the **web dashboard's two flagship flows are broken** (DF-10 P0,
DF-11 P1 — see Entry points). Live list:
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
**the `compare` endpoint is FIXED as of 2026-09-24** (7fba228 — distinct
won-game count; winRate ≤1 verified live; token/cost fields still 0).

## Entry points

| Surface | URL / command | Status |
|---------|---------------|--------|
| REST API | `http://localhost:3004` | ✅ works (`/health` and `/api/v1/health` both live) |
| SSE stream | `GET /api/v1/games/<id>/events` with `Accept: text/event-stream` | ✅ works |
| WebSocket | `ws://localhost:3004/ws` — protocol is `JOIN_GAME` (no `subscribe`) | ❌ DF-16 P0 (2026-09-25): connects + acks but delivers ZERO game events server-side — join registers a `game:<id>` EventBus topic nothing publishes to (EventBus is event-type-keyed) and broadcasts with `excludeClientId` on the joiner (websocket/index.ts:186). Poll REST/SSE instead. SUBSCRIBE {gameId} silently no-ops too (DF-19) |
| Web dashboard | `http://localhost:5174` | ⚠️ serves, but STALE as of 2026-09-25: container still runs the Aug-10 bundle — all tick-202 fixes (DF-11/13/14) + DF-10 fix are merged-but-undeployed (DF-17); symptoms below persist until `docker compose build web server && docker compose up -d web server` |
| CLI run-game | `pnpm --filter @mafia/cli dev -- run-game --players 5 --yes` | ✅ works (exit 0, ~1 s to create) |
| CLI watch-game | `… dev -- watch-game <gid>` | ✅ works |
| CLI benchmark | `… dev -- benchmark --games 1 --models openai/gpt-4o-mini,openai/gpt-4o` | ✅ works; `--timeout <min>` (default 30, 0=∞) |
| per-model report | `GET /api/v1/benchmark/report` | ✅ wins real |
| per-model compare | `GET /api/v1/benchmark/compare` | ✅ FIXED 2026-09-24 (7fba228): winRate ≤1 verified live |
| run cleanup | `POST /api/v1/benchmark/<runId>/cancel` | ✅ works; UNDOCUMENTED — retires stale RUNNING runs |
| Web: create game | :5174 header `New Game` → modal → Create | ❌ DF-10 P0: navigates `/game/undefined`, hangs on Loading (store casts `{gameId}` payload as `Game`) — use `POST /api/v1/games` or CLI instead |
| Web: spectate a FINISHED game | :5174 Games → View | ❌ DF-11 P1: votes/discussion/events show placeholders despite recorded events (GameWatcher never fetches history) — read `/api/v1/games/<id>/events` directly |
| Web: Stats page | :5174/stats | ⚠️ DF-14: leaderboard empty, per-game Duration '—'; headline tiles fine |
| Web: sidebar `New Game` | `/?action=new` | ❌ dead link (no consumer); only the header button opens the modal |

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

Or skip all repairs: `cp .env.sample .env && docker compose up -d --build`
(server :3004, web :5174) — documented in README "Docker Quick Path" and
bunker-verified 2026-09-24 on a bare Debian agent (Docker 29.8.1, compose
v5.5.0 preinstalled): build EXIT=0 in 167s, health + dashboard + a real
game lifecycle all green. The compose-plugin caveat above is stale on
current fleet bunker hosts. Note: with the placeholder key the engine
plays canned-MOCK games in seconds — put a real key in before benching.

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

## Pitfalls (verified 2026-09-25 unless noted)

- **Placeholder API key = canned-mock games in your stats (DF-12)** — a fresh
  install with `.env.sample`'s `sk-or-...HERE` key plays complete games in
  seconds via the engine's canned-mock fallback (game-engine.js:714). They land
  in the same games/players/events tables and feed /benchmark/compare. Put a
  REAL key in `.env` before generating any stats you care about.
- **A REAL key does not save the default model (DF-18, 2026-09-25)** — with the
  real key, the create-modal default `deepseek-v4-flash` still played a FULL
  canned-mock game (every THINK canned, every SAYS empty, 85 parse-retries
  across 3 games) that completed ENDED in 81s and fed real stats unmarked.
  Pass explicit `roleModels` (e.g. `qwen/qwen3-coder-next`) — and even that
  "✅ Reliable" model hit a parse retry on EVERY turn this tick (real dialogue,
  degraded; docs' reliability table is stale).
- **`/benchmark/compare` winRates are now trustworthy** (fix 7fba228, deployed
  2026-09-24): winRate ≤1, wins=COUNT(DISTINCT won game). The old "never quote
  compare" advice is retired. Note `avgTokensPerGame=0` — token/cost fields are
  not populated on the compare payload (DF-12 second half).
- **Stale RUNNING benchmark runs don't self-heal** — startup reconciliation
  (apps/server/src/index.ts:84) only recovers runs with terminal game proof;
  abandoned runs stay RUNNING forever. Cleanup: `POST /api/v1/benchmark/<runId>/cancel`.
  (2026-09-24: two 32/35-day-old zombies retired this way.) DF-MAFIA-AI-BENCHMARK-15.
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

Answer honestly: the core product — real AI Mafia games via API/CLI with
correct per-game results and correct per-model stats (report AND compare,
fixed 2026-09-24) — works end-to-end, on a running stack AND from a fresh
clone via the documented docker compose path (bunker-verified 2026-09-24:
build EXIT=0 in 167s, smoke + real game lifecycle on a bare agent). What
does NOT work: the web dashboard's two flagship flows (create →
/game/undefined DF-10; finished-game spectate shows placeholders DF-11),
web Stats leaderboard (DF-14), and mock-key games silently pollute stats
(DF-12). Verdict as of 2026-09-24: **PROMISING-BUT-ROUGH** — backend solid,
web UI is the gap. Point to `docs/dogfood/2026-09-24-integration.md` for
this run's evidence and `docs/dogfood/diagnostics.md` for the full trail.
