# Mafia AI Benchmark — End-to-End Work Plan

> Generated: 2025-06-09 | Status: DRAFT
> Branch: `main` | 139/140 tests pass | Legacy engine: ✅ running

## Current State Summary

| System | Status | Lines | Tests |
|--------|--------|-------|-------|
| Legacy game engine | ✅ Working | 5,236 | ~400+ |
| Shared package (FSM, events, types, roles, providers) | ✅ 97% pass | ~4,500 | 139/140 |
| Server (Express + WS + SSE) | ⚠️ Needs build | 1,700+ | Not verified |
| React web app (14 components) | ⚠️ Needs build | ~2,000 | 0 |
| CLI (8 commands) | ⚠️ Needs build | ~1,000 | Not verified |
| Dashboard (standalone HTML) | ✅ Standalone | ~500 | N/A |
| 3D Visualization (standalone HTML) | ✅ Standalone | ~600 | N/A |
| Docker | ❌ Not built | — | — |
| Logging system | ❌ Missing | — | — |
| Benchmark pipeline | ⚠️ Partial | 528 (stats) | Not verified |

---

## Phase 1: Build Infrastructure (2 items)

### WI-001: Create turbo.json for monorepo build
**Priority:** P0 — blocks all package builds
**Current:** `turbo.json` missing, `pnpm run build` fails with "Could not find turbo.json"
**Fix:** Create `turbo.json` at repo root with pipeline config for build, test, dev, lint tasks
**Depends on:** Nothing
**Verification:** `pnpm run build` exits 0, all packages compile

### WI-002: Fix integration test import path
**Priority:** P1 — blocks real-game test
**Current:** `real-game.test.ts` imports `../src/index.js` which doesn't exist
**Fix:** Fix the import to reference the correct shared package entry point. Or generate a proper barrel export at `packages/shared/src/index.ts` that re-exports all public APIs.
**Depends on:** WI-001 (needs build to verify)
**Verification:** `npx vitest run src/__tests__/integration/real-game.test.ts` passes (at minimum compiles)

---

## Phase 2: Server & API Verification (3 items)

### WI-003: Verify server starts and health endpoint responds
**Priority:** P0 — blocks web UI and CLI integration
**Current:** Server code exists (Express + WS + SSE, 181 lines main, 616 routes, 371 WS) but untested in current env
**Fix:** Build the server package, start it, verify GET /api/v1/health returns 200, verify WebSocket accepts connections on :3001
**Depends on:** WI-001
**Verification:** `curl http://localhost:3000/api/v1/health` → 200, `wscat -c ws://localhost:3001/ws` connects

### WI-004: Wire legacy game engine events to server event bus
**Priority:** P0 — the legacy engine works but doesn't emit through the server
**Current:** Legacy `game-engine.js` runs standalone with console.log. Server has EventBus + WebSocket broadcasting but the legacy engine doesn't plug into it.
**Fix:** Create an adapter that wraps the legacy engine's output and publishes events through the server's EventBus. OR port the legacy engine's game loop into the server's GameEngine service.
**Depends on:** WI-003
**Verification:** Start server, create game via API, connect WebSocket, see real-time events stream

### WI-005: API endpoints for game replay
**Priority:** P1
**Current:** Events are stored in the legacy engine's event array. No API to query past game events.
**Fix:** GET /api/v1/games/:id/events returns all events with visibility filtering (admin sees THINK, public sees SAYS). GET /api/v1/games/:id/replay returns the full game timeline.
**Depends on:** WI-004
**Verification:** Create game → query events → verify THINK events require admin, SAYS events are public

---

## Phase 3: Logging System (3 items)

### WI-006: Spec out logging architecture
**Priority:** P0 — blocking all logging implementation
**Current:** No logging spec exists. Console.log scattered throughout legacy engine.
**Fix:** Write spec `specs/logging-system.md` covering:
- Log levels (DEBUG, INFO, WARN, ERROR)
- Structured JSON logging format
- Log destinations (stdout, file, DB)
- Per-component log filtering
- Log rotation and retention
- Game event log vs system log separation
- Correlation IDs (gameId, playerId, turnNumber)
**Depends on:** Nothing
**Verification:** Spec reviewed and committed

### WI-007: Implement structured logging service
**Priority:** P0
**Current:** No logging infrastructure. Console.log everywhere.
**Fix:** Implement `packages/shared/src/logging/index.ts`:
- Logger class with level filtering
- JSON structured output: `{timestamp, level, component, gameId?, playerId?, message, data?}`
- File transport with rotation (Winston or pino)
- DB transport for queryable game event logs
- Integration with EventBus so every game event is also logged
**Depends on:** WI-006
**Verification:** Start server → check log output is structured JSON → query DB for logged events

### WI-008: Retrofit legacy engine with structured logging
**Priority:** P1
**Current:** Legacy engine uses console.log with emoji prefixes
**Fix:** Replace all console.log calls with structured logger calls. Preserve human-readable format for stdout but also emit JSON to file/DB.
**Depends on:** WI-007
**Verification:** Run a full game → verify structured logs in file and DB → verify all phases logged with correlation IDs

---

## Phase 4: Web UI — Live Game Monitoring (4 items)

### WI-009: Build and serve web app connected to real server
**Priority:** P0
**Current:** React app exists but never built/verified against running server. Standalone HTML files (dashboard.html, visualization.html) are disconnected from the React app.
**Fix:** Build web app with Vite, verify it connects to server on :3000, verify all 14 components render. Fix any import path issues or missing dependencies.
**Depends on:** WI-003
**Verification:** Open browser → Create game → See live game board with player cards, phase display, chat panel

### WI-010: Implement THINK/SAYS split-pane in game viewer
**Priority:** P0 — core feature visibility
**Current:** ChatPanel component filters for `AGENT_SAYS_BROADCASTED` events only. No THINK stream visible.
**Fix:** Create a split-pane view:
- Left pane: Public feed (SAYS statements, votes, phase changes)
- Right pane: Private feed (THINK reasoning — admin only toggle)
- Color-coded: purple for THINK, cyan for SAYS
- Auto-scroll with live updates
**Depends on:** WI-009
**Verification:** Run game → See both THINK and SAYS streams → Verify THINK hidden in non-admin mode

### WI-011: Game event timeline / replay viewer
**Priority:** P1
**Current:** No replay capability beyond raw event list
**Fix:** Create a timeline component:
- Horizontal timeline with day/night phase blocks
- Clickable events showing detail popups
- Filter by event type (kill, investigation, vote, discussion)
- Play/pause/scrub through game history
- Speed controls (1x, 2x, 5x)
**Depends on:** WI-005, WI-009
**Verification:** Load completed game → Scrub timeline → See event details on click → Filter by event type

### WI-012: Integrate 3D visualization panel
**Priority:** P2
**Current:** Standalone visualization.html with Three.js — not connected to game state
**Fix:** Embed the 3D scene as a React component. Wire it to game state so players appear around a table, dead players fade out, and phase changes animate.
**Depends on:** WI-009
**Verification:** Open game → See 3D table with player avatars → Watch players get eliminated → Phase transitions animate

---

## Phase 5: Benchmark & Stats Pipeline (3 items)

### WI-013: Multi-model game configuration
**Priority:** P0
**Current:** Legacy engine supports per-role model config via env vars (MAFIA_MODEL, DOCTOR_MODEL, etc.) but not tested with multiple models simultaneously.
**Fix:** Verify the model routing works correctly. Add a game creation endpoint that accepts per-role model assignments. Track which model each player uses in the stats collector.
**Depends on:** WI-004
**Verification:** Create game with different models per role → verify each agent calls its assigned model → verify stats show correct models

### WI-014: Model comparison report
**Priority:** P1
**Current:** Stats collector tracks raw data but no comparison/aggregation.
**Fix:** GET /api/v1/benchmark/compare?models=X,Y,Z endpoint that returns:
- Win rate per model
- Token efficiency (tokens per game)
- Role-specific performance (mafia win rate, sheriff investigation accuracy)
- Head-to-head records
- Trend over multiple games
**Depends on:** WI-013
**Verification:** Run 3 games with 2 different models → compare endpoint shows statistically meaningful differences

### WI-015: Benchmark report export (JSON/CSV)
**Priority:** P2
**Current:** No export capability
**Fix:** CLI command `mafia benchmark export --format json|csv --games N` that exports:
- Per-game stats
- Per-model aggregates
- Game event logs
- Cost breakdown
**Depends on:** WI-014
**Verification:** Run export → verify valid JSON/CSV → verify all fields populated

---

## Phase 6: Production Deployment (2 items)

### WI-016: Docker multi-service setup
**Priority:** P0
**Current:** Dockerfile doesn't exist. Container for OpenCode exists (:4103) but not for the app itself.
**Fix:** Create Dockerfile and docker-compose.yml:
- Server container (Express + WS on :3000/:3001)
- Optional: Nginx reverse proxy
- Volume mounts for data/, .env
- Environment-based configuration
**Depends on:** WI-003
**Verification:** `docker compose up` → health endpoint responds → game runs inside container → web UI accessible

### WI-017: End-to-end CI smoke test
**Priority:** P1
**Current:** No CI pipeline
**Fix:** A single script that:
- Builds all packages
- Starts server
- Creates a game via API
- Runs a full game with 5 players (scripted or real LLM)
- Verifies events were emitted
- Checks stats were recorded
- Exits 0 on success
**Depends on:** WI-004, WI-016
**Verification:** `./scripts/e2e-smoke-test.sh` exits 0

---

## Phase 7: Specs & Documentation (3 items)

### WI-018: Spec: Logging System
**Priority:** P0
**Current:** No logging spec
**Fix:** WI-006 above covers this
**Depends on:** Nothing

### WI-019: Spec: Admin/Operator Dashboard UI
**Priority:** P1
**Current:** specs/ui-components.md exists but no admin-specific dashboard spec
**Fix:** Write spec covering:
- Admin view: all games, all events (including THINK), cost tracking
- Operator view: active games, pending actions, system health
- Player view: public events only
**Depends on:** Nothing
**Verification:** Spec committed to specs/admin-dashboard.md

### WI-020: Spec: Benchmark Methodology
**Priority:** P1
**Current:** stats-and-scoring-system.md exists (1749 lines) but no methodology spec
**Fix:** Write spec covering:
- How many games constitute a valid benchmark run
- Statistical significance calculation
- Role rotation (each model plays each role)
- Control variables (same seed, same personas)
- Comparison methodology
**Depends on:** Nothing
**Verification:** Spec committed to specs/benchmark-methodology.md
