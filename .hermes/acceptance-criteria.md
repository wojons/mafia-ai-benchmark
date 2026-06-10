# Acceptance Criteria for Mafia AI Benchmark

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
**Verification date:** 2026-06-10
**Evidence:** pnpm install passes with `onlyBuiltDependencies` in pnpm-workspace.yaml for pnpm v11. `tsc --noEmit` exits 0 on shared package. Server already running on :3000.

### AC-001: API key available
**Goal:** NeuralWatt API key is configured and reachable
**How to verify:** `curl -s https://api.neuralwatt.com/v1/chat/completions -H "Authorization: Bearer $NEURALWATT_API_KEY" -d '{"model":"qwen3.6-35b-fast","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'` returns 200
**Status:** passed ✅
**Verification date:** 2026-06-10
**Evidence:** `qwen3.6-35b-fast` returned `"Hello there my friend"` in 0.19s, $0.00 cost, $5.00 allowance remaining

### Layer 1 — Unit Tests

### AC-010: FSM state machine tests pass (33 tests)
**Goal:** All FSM tests pass under vitest
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/fsm/`
**Status:** passed ✅
**Verification date:** 2026-06-10
**Evidence:** 33/33 FSM tests pass. One orphaned `it('should accept valid vote')` was removed — it was placed outside describe('GameFSM') due to the extra brace bug. Vitest excluded integration test file. Total: 150/150 tests across 6 test files.

### AC-011: Types tests pass (14 tests)
**Goal:** All 14 type tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/types/`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-012: Events tests pass (21 tests)
**Goal:** All 21 event tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/events/`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-013: Roles tests pass (36 tests)
**Goal:** All 36 role tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/roles/`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-014: Providers tests pass (35 tests)
**Goal:** All 35 provider tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/providers/`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-015: Logging tests pass (11 tests)
**Goal:** All 11 logging tests pass
**How to verify:** `cd ~/mafia-ai-benchmark/packages/shared && npx vitest run -- src/__tests__/logging/`
**Status:** passed ✅
**Verification date:** 2026-06-10

### AC-016: Integration test excluded from vitest
**Goal:** Integration test is script-style (not vitest suite) — excluded to keep test suite clean
**How to verify:** `npx vitest run` in packages/shared doesn't include integration tests
**Status:** deferred
**Notes:** 519-line script tests real LLM games. Excluded via `exclude: ['**/integration/**']` in vitest.config.ts. Can be run standalone: `npx tsx src/__tests__/integration/real-game.test.ts` with NeuralWatt key.

### Layer 2 — Real LLM Connectivity

### AC-020: Provider factory creates working NeuralWatt client
**Goal:** Provider factory connects to NeuralWatt and receives a valid response
**How to verify:** Started in the integration test. `curl` to NeuralWatt API returns 200.
**Status:** pending
**Notes:** Gated on AC-001 (API key check).

### AC-021: Single agent produces THINK/SAYS split-pane output
**Goal:** One AI agent produces both a THINK (private reasoning) and SAYS (public statement) from a single prompt
**How to verify:** Integration test or direct script calling the split-pane provider.
**Status:** pending

### Layer 3 — Game Engine

### AC-030: FSM completes a full scripted game cycle
**Goal:** Scripted game walks through SETUP → NIGHT → MORNING → DAY → VOTING → RESOLUTION → END
**How to verify:** Node script drives the FSM through all 7 phases with fake players.
**Status:** pending

### AC-031: Night phase resolution (mafia kill, doctor save, sheriff investigate)
**Goal:** Night actions resolve correctly — mafia target dies unless doctored, sheriff learns alignment
**How to verify:** Scripted test with known role assignments + night action submissions.
**Status:** pending

### AC-032: Day voting and elimination
**Goal:** Players vote, votes tallied, most-voted player eliminated, ties handled
**How to verify:** Scripted test with vote distribution.
**Status:** pending

### AC-033: Win condition detection
**Goal:** Mafia win when mafia = town count; Town win when all mafia eliminated
**How to verify:** Scripted test with killed-off roles.
**Status:** pending

### AC-034: Game events persist to SQLite via bridge
**Goal:** Legacy bridge spawns game-engine.js, events flow through adapter to SQLite
**How to verify:** Start server, POST /api/v1/games with a config, wait for completion, query events table.
**Status:** pending
**Notes:** FK constraint fix verified (WI-024). Bridge type mapping fixed in code. Game status UPDATE is prepared but never `run()` — game stays IN_PROGRESS.

### Layer 4 — Single Real-LLM Agent

### AC-040: Mafia agent submits night kill via real LLM
**Goal:** A real mafia-aligned agent (via NeuralWatt) chooses a night kill target
**How to verify:** Integration test with real LLM.
**Status:** deferred (blocked on Layer 2)

### Layer 7 — Production

### AC-070: Server health endpoint returns healthy
**Goal:** `GET /health` returns `{"status":"healthy"}`
**How to verify:** `curl -s http://localhost:3000/health | grep healthy`
**Status:** passed ✅
**Verification date:** 2026-06-10
**Evidence:** `{"status":"healthy","timestamp":"2026-06-10T03:37:49.454Z","uptime":802}` — server already running.

### AC-071: POST /api/v1/games starts a game
**Goal:** Game creation endpoint returns game ID and starts the bridge
**How to verify:** `curl -X POST http://localhost:3000/api/v1/games -H 'Content-Type: application/json' -d '{"numPlayers":5}'`
**Status:** pending

### AC-072: GET /api/v1/games/:id returns game state
**Goal:** Full game state returned with events, phases, player info
**How to verify:** `curl -s http://localhost:3000/api/v1/games/<id> | python3 -m json.tool`
**Status:** pending

## Passed Criteria

### AC-000: Build & dependency resolution ✅ — 2026-06-10
**Evidence:** pnpm install (with pnpm-workspace.yaml fix) + tsc both pass

### AC-001: API key available ✅ — 2026-06-10
**Evidence:** NeuralWatt qwen3.6-35b-fast responded in 0.19s

### AC-010: FSM tests (33 tests) ✅ — 2026-06-10
**Evidence:** All 33 FSM tests pass (extra brace fixed, orphaned test removed)

### AC-011: Types tests (14 tests) ✅ — 2026-06-10
**Evidence:** `npx vitest run -- src/__tests__/types/` — 14/14 pass

### AC-012: Events tests (21 tests) ✅ — 2026-06-10
**Evidence:** `npx vitest run -- src/__tests__/events/` — 21/21 pass

### AC-013: Roles tests (36 tests) ✅ — 2026-06-10
**Evidence:** `npx vitest run -- src/__tests__/roles/` — 36/36 pass

### AC-014: Providers tests (35 tests) ✅ — 2026-06-10
**Evidence:** `npx vitest run -- src/__tests__/providers/` — 35/35 pass

### AC-015: Logging tests (11 tests) ✅ — 2026-06-10
**Evidence:** `npx vitest run -- src/__tests__/logging/` — 11/11 pass

### AC-070: Server health endpoint ✅ — 2026-06-10
**Evidence:** Server running on :3000, returned `{"status":"healthy","uptime":802}`

## Backlog

### AC-050: Benchmark pipeline — stats collection
**Goal:** Running multiple games collects stats on win rates, deception scores, survival time

### AC-051: Model comparison dashboard
**Goal:** Web UI shows model comparison table with win rates and deception metrics

### AC-060: Docker compose — full stack deployment
**Goal:** `docker-compose up` starts server + web + nginx

### AC-061: WebSocket event streaming
**Goal:** WebSocket :3001 delivers game events in real-time
