# Acceptance Criteria for Mafia AI Benchmark
**Cron Run #29:** 2026-07-07 13:12 UTC — Maintenance mode: all-clear. Server healthy (uptime 12.4d, 57MB RSS). Tests: 150/150 (1.09s). Benchmark: 54 games, 39 ended, 14 cancelled, 5 stale. Winners: 22 TOWN, 9 MAFIA (29.0% mafia win rate). opencode-mafia container absent (15th consecutive wake). /tmp 60% — healthy. No new commits since 06-25. Status: all-clear. 6th consecutive all-clear wake.

## Demo Infrastructure

| Service | Port | Language | What it provides |
|---------|------|----------|-----------------|
| `mafia-server` | 3000 | TypeScript/Express | REST API (games, events, replay, models, benchmark), WebSocket (:3001), SSE |
| `legacy-engine` | — | Node.js | Game engine spawned as bridge child process from server |

## Active Criteria

### Layer 0 — Toolchain & Infrastructure

### AC-000: Build & dependency resolution
**Goal:** pnpm install resolves all deps and TypeScript builds succeed
**How to verify:** `cd ~/mafia-ai-benchmark && pnpm install` exits 0, `cd packages/shared && npx tsc` exits 0
**Status:** passed ✅
**Verification date:** 2026-06-30
**Evidence:** pnpm 11.5.2, tsc --noEmit exit 0, turbo build 4/4 all cached. Build clean across 5 consecutive wakes.

### AC-001: API key available
**Goal:** OpenRouter API key is configured and reachable
**How to verify:** Legacy engine calls OpenRouter API with configured key
**Status:** passed ✅
**Verification date:** 2026-06-10
**Evidence:** API key verified working. Server running with OpenRouter integration for real-LLM games.

### Layer 1 — Unit Tests

### AC-010: FSM state machine tests pass (33 tests)
**Goal:** All FSM tests pass under vitest
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/fsm/`
**Status:** passed ✅
**Verification date:** 2026-06-30
**Evidence:** 33/33 FSM tests pass (8ms). Total: 150/150 tests across 6 test files.

### AC-011: Types tests pass (14 tests)
**Goal:** All 14 type tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/types/`
**Status:** passed ✅
**Verification date:** 2026-06-30

### AC-012: Events tests pass (21 tests)
**Goal:** All 21 event tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/events/`
**Status:** passed ✅
**Verification date:** 2026-06-30

### AC-013: Roles tests pass (36 tests)
**Goal:** All 36 role tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/roles/`
**Status:** passed ✅
**Verification date:** 2026-06-30

### AC-014: Providers tests pass (35 tests)
**Goal:** All 35 provider tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/providers/`
**Status:** passed ✅
**Verification date:** 2026-06-30
**Evidence:** 35/35 pass (373ms). `applyCapabilityOverrides()` forces `functionCalling: true` for gemini models.

### AC-015: Logging tests pass (11 tests)
**Goal:** All 11 logging tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/logging/`
**Status:** passed ✅
**Verification date:** 2026-06-30

### AC-016: Integration test excluded from vitest
**Goal:** Integration test is script-style (not vitest suite) — excluded to keep test suite clean
**How to verify:** `npx vitest run` in packages/shared doesn't include integration tests
**Status:** deferred
**Notes:** 519-line script tests real LLM games. Excluded via `exclude: ['**/integration/**']` in vitest.config.ts.

### Layer 2 — Real LLM Connectivity

### AC-020: Provider factory creates working client
**Goal:** Provider factory connects to OpenRouter and receives a valid response
**How to verify:** Legacy engine bridge spawns and completes real-LLM games
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-021: Single agent produces THINK/SAYS split-pane output
**Goal:** One AI agent produces both a THINK (private reasoning) and SAYS (public statement) from a single prompt
**How to verify:** Integration test or direct script calling the split-pane provider.
**Status:** passed ✅
**Verification date:** 2026-06-10

### Layer 3 — Game Engine

### AC-030: FSM completes a full scripted game cycle
**Goal:** Scripted game walks through SETUP → NIGHT → MORNING → DAY → VOTING → RESOLUTION → END
**How to verify:** Node script drives the FSM through all 7 phases with fake players.
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-031: Night phase resolution (mafia kill, doctor save, sheriff investigate)
**Goal:** Night actions resolve correctly — mafia target dies unless doctored, sheriff learns alignment
**How to verify:** Scripted test with known role assignments + night action submissions.
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-032: Day voting and elimination
**Goal:** Players vote, votes tallied, most-voted player eliminated, ties handled
**How to verify:** Scripted test with vote distribution.
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-033: Win condition detection
**Goal:** Mafia win when mafia = town count; Town win when all mafia eliminated
**How to verify:** Scripted test with killed-off roles.
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-034: Game events persist to SQLite via bridge
**Goal:** Legacy bridge spawns game-engine.js, events flow through adapter to SQLite
**How to verify:** Start server, POST /api/v1/games with a config, wait for completion, query events table.
**Status:** passed ✅
**Verification date:** 2026-06-10

### Layer 4 — Single Real-LLM Agent

### AC-040: Mafia agent submits night kill via real LLM ✅
**Goal:** A real mafia-aligned agent chooses a night kill target
**How to verify:** Integration test with real LLM.
**Verified:** 2026-06-10

### Layer 7 — Production

### AC-070: Server health endpoint returns healthy
**Goal:** `GET /health` returns `{"status":"healthy"}`
**How to verify:** `curl -s http://localhost:3000/health | grep healthy`
**Status:** passed ✅
**Verification date:** 2026-07-07
**Evidence:** `{"status":"healthy","uptime":1068628}` — 12.4d uptime, 57MB RSS.

### AC-071: POST /api/v1/games starts a game
**Goal:** Game creation endpoint returns game ID and starts the bridge
**How to verify:** `curl -X POST http://localhost:3000/api/v1/games -H 'Content-Type: application/json' -d '{"numPlayers":5}'`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-072: GET /api/v1/games/:id returns game state
**Goal:** Full game state returned with events, phases, player info
**How to verify:** `curl -s http://localhost:3000/api/v1/games/<id>`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-073: WebSocket event streaming ✅
**Goal:** WebSocket delivers game events in real-time to clients
**How to verify:** Connect to `ws://localhost:3000/ws`, verify CONNECTED → PING/PONG → SUBSCRIBE → JOIN_GAME → GAME_STATE flow
**Status:** passed ✅
**Verification date:** 2026-06-11

## Passed Criteria

### AC-000: Build & dependency resolution ✅ — 2026-06-30
**Evidence:** pnpm 11.5.2 + tsc clean + turbo build 4/4 all cached

### AC-001: API key available ✅ — 2026-06-10
**Evidence:** OpenRouter key configured and verified

### AC-010: FSM tests (33 tests) ✅ — 2026-06-30
**Evidence:** All 33 FSM tests pass (8ms)

### AC-011: Types tests (14 tests) ✅ — 2026-06-30
**Evidence:** 14/14 pass

### AC-012: Events tests (21 tests) ✅ — 2026-06-30
**Evidence:** 21/21 pass

### AC-013: Roles tests (36 tests) ✅ — 2026-06-30
**Evidence:** 36/36 pass

### AC-014: Providers tests (35 tests) ✅ — 2026-06-30
**Evidence:** 35/35 pass

### AC-015: Logging tests (11 tests) ✅ — 2026-06-30
**Evidence:** 11/11 pass

### AC-060: Docker compose — full stack deployment ✅ — 2026-06-30
**Evidence:** server-1 (Up 8d, healthy, :3000) + web-1 (Up 8d, :5174). Both ports listening.

### AC-070: Server health endpoint ✅ — 2026-07-04
**Evidence:** healthy, 8.9d uptime, 52MB RSS

### AC-050: Benchmark pipeline — stats collection ✅ — 2026-06-10
**Evidence:** 54 total games, 39 ended, mafiaWinRate 34.3%. All 3 benchmark endpoints return real data.

### AC-051: Model comparison dashboard ✅ — 2026-06-11
**Evidence:** StatsPanel.tsx with 8-column model comparison table, fetching /stats/models and /benchmark/report.

## Backlog

### AC-074: Player array populated in game response ✅
**Goal:** GET /api/v1/games/:id returns populated `players` array
**Status:** passed ✅
**Verification date:** 2026-06-11
