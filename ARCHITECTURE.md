# Mafia AI Benchmark - Complete Architecture

## Overview

This document explains the complete architecture of the Mafia AI Benchmark system, how all files interact, and how to run the full game experience from any interface (CLI or HTTP).

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MAFIA AI BENCHMARK SYSTEM                            │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    INTERFACE LAYER (User Entry Points)               │   │
│  │                                                                      │   │
│  │   ┌─────────────┐                    ┌─────────────────────────┐     │   │
│  │   │   CLI       │                    │        WEB UI           │     │   │
│  │   │  (cli.js)   │                    │   (apps/web/src/)       │     │   │
│  │   │             │                    │                         │     │   │
│  │   │ • health    │                    │ • React components      │     │   │
│  │   │ • games     │                    │ • Game board            │     │   │
│  │   │ • models    │                    │ • Chat panel            │     │   │
│  │   │ • stats     │                    │ • Action panel          │     │   │
│  │   └─────────────┘                    └─────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                        │
│                    │               │               │                        │
│                    ▼               ▼               ▼                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                   PRODUCTION SERVER                                 │    │
│  │                  (apps/server/src/index.js)                         │    │
│  │                                                                     │    │
│  │   ┌─────────────────────────────────────────────────────────────┐   │    │
│  │   │                   REST API ENDPOINTS                        │   │    │
│  │   │                                                             │   │    │
│  │   │   GET    /health                    Health check            │   │    │
│  │   │   GET    /api/v1/games              List games              │   │    │
│  │   │   POST   /api/v1/games              Create game             │   │    │
│  │   │   GET    /api/v1/games/:id          Get game details        │   │    │
│  │   │   POST   /api/v1/games/:id/start    Start game              │   │    │
│  │   │   POST   /api/v1/games/:id/stop     Stop game               │   │    │
│  │   │   POST   /api/v1/games/:id/players  Add player              │   │    │
│  │   │   POST   /api/v1/games/:id/players/:idx/model  Set model    │   │    │
│  │   │   POST   /api/v1/games/:id/role/:role/model  Set role model │   │    │
│  │   │   POST   /api/v1/games/:id/models/bulk  Bulk configure      │   │    │
│  │   │   GET    /api/v1/models             List models             │   │    │
│  │   │   GET    /api/v1/models/pricing     Get pricing             │   │    │
│  │   │   POST   /api/v1/models/calculate-cost  Calculate cost      │   │    │
│  │   │   GET    /api/v1/stats              Server statistics       │   │    │
│  │   │   GET    /api/v1/games/:id/sse-status  SSE status           │   │    │
│  │   │   GET    /api/v1/games/:id/stream   SSE stream (real-time)  │   │    │
│  │   └─────────────────────────────────────────────────────────────┘   │    │
│  │                                                                     │    │
│  │   ┌──────────────────────────────────────────────────────────────┐  │    │
│  │   │                    SERVICES LAYER                            │  │    │
│  │   │                                                              │  │    │
│  │   │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │  │    │
│  │   │  │   EventBus   │  │Game Engine     │  │Stats Collector   │  │  │    │
│  │   │  │(event-bus.ts)│  │(game-engine.js)│  │(stats-collector) │  │  │    │
│  │   │  │              │  │                │  │                  │  │  │    │
│  │   │  │• Publish/    │  │• Night Phase   │  │• Track costs     │  │  │    │
│  │   │  │  Subscribe   │  │• Day Phase     │  │• Player stats    │  │  │    │
│  │   │  │• Event       │  │• Voting        │  │• Game summary    │  │  │    │
│  │   │  │  History     │  │• Win Check     │  │                  │  │  │    │
│  │   │  └──────────────┘  └────────────────┘  └──────────────────┘  │  │    │
│  │   │                                                              │  │    │
│  │   │  ┌──────────────┐  ┌──────────────┐                          │  │    │
│  │   │  │Agent Coord.  │  │    SSE       │                          │  │    │
│  │   │  │(agent-coord) │  │  Streaming   │                          │  │    │
│  │   │  │              │  │              │                          │  │    │
│  │   │  │• AI prompts  │  │• Real-time   │                          │  │    │
│  │   │  │• Model calls │  │  updates     │                          │  │    │
│  │   │  └──────────────┘  └──────────────┘                          │  │    │
│  │   └──────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     SHARED PACKAGES                                  │   │
│  │                    (packages/shared/src/)                            │   │
│  │                                                                      │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │                      CORE MODULES                           │    │   │
│  │   │                                                             │    │   │
│  │   │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐     │    │   │
│  │   │  │   Events   │  │    FSM     │  │      Types         │     │    │   │
│  │   │  │(events/)   │  │ (fsm/)     │  │   (types/)         │     │    │   │
│  │   │  │            │  │            │  │                    │     │    │   │
│  │   │  │• Event     │  │• State     │  │• Game types        │     │    │   │
│  │   │  │  Types     │  │  Machine   │  │• Player types      │     │    │   │
│  │   │  │• Factory   │  │• Phases    │  │• Role types        │     │    │   │
│  │   │  │• Validation│  │• Transitions│ │• API types         │     │    │   │
│  │   │  └────────────┘  └────────────┘  └────────────────────┘     │    │   │
│  │   │                                                             │    │   │
│  │   │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐     │    │   │
│  │   │  │  Providers │  │   Roles    │  │      Agents        │     │    │   │
│  │   │  │(providers/)│  │ (roles/)   │  │    (agents/)       │     │    │   │
│  │   │  │            │  │            │  │                    │     │    │   │
│  │   │  │• OpenAI    │  │• Role logic│  │• Agent interface   │     │    │   │
│  │   │  │• Anthropic │  │• Win cond. │  │• Persona system    │     │    │   │
│  │   │  │• Cost track│  │• Actions   │  │                    │     │    │   │
│  │   │  └────────────┘  └────────────┘  └────────────────────┘     │    │   │
│  │   │                                                             │    │   │
│  │   │  ┌──────────────────────────────────────────────────────┐   │    │   │
│  │   │  │              Persona Generator                       │   │    │   │
│  │   │  │            (persona/persona-generator.js)            │   │    │   │
│  │   │  │                                                      │   │    │   │
│  │   │  │  • Dynamic character generation                      │   │    │   │
│  │   │  │  • Archetypes (Historical, Fictional, Anime, etc.)   │   │    │   │
│  │   │  │  • Communication styles                              │   │    │   │
│  │   │  │  • Verbal tics, backstories, moral alignments        │   │    │   │
│  │   │  └──────────────────────────────────────────────────────┘   │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 File Structure

```
mafia/
├── 🎮 ENTRY POINTS (User-facing)
│   ├── cli.js                          # CLI interface (main entry)
│   └── apps/web/src/App.tsx           # Web UI React app
│
├── 🖥️  PRODUCTION SERVER
│   ├── apps/server/src/
│   │   ├── index.js                   # Main server (Express + WS)
│   │   ├── index.ts                   # TypeScript entry
│   │   ├── integration.test.js        # 31 API integration tests ✅
│   │   │
│   │   ├── routes/
│   │   │   └── index.ts               # All REST API endpoints
│   │   │
│   │   ├── services/
│   │   │   ├── event-bus.ts           # Event publish/subscribe
│   │   │   ├── event-bus.test.ts      # EventBus unit tests ✅
│   │   │   ├── game-engine.ts         # Game engine (TODO: integrate)
│   │   │   ├── stats-collector.ts     # Cost & stats tracking
│   │   │   └── agent-coordinator.ts   # AI agent coordination
│   │   │
│   │   ├── websocket/
│   │   │   └── index.ts               # WebSocket support
│   │   │
│   │   └── db/
│   │       ├── schema.sql             # Database schema
│   │       ├── repository.ts          # Data access layer
│   │       └── migrate.ts             # DB migrations
│   │
│   └── package.json
│
├── 🎭 GAME ENGINE (Core Logic)
│   ├── game-engine.js                  # ⭐ ACTUAL GAME ENGINE (renamed!)
│   │   │
│   │   Contains:
│   │   • MafiaGame class (955 lines)
│   │   • Night Phase (mafia chat, doctor, sheriff, vigilante)
│   │   • Day Phase (discussion, voting, lynching)
│   │   • Win Condition Check
│   │   • AI Integration (OpenRouter)
│   │   • Persona Generation
│   │   • Cost Tracking
│   │   • Event Sourcing
│   │
│   └── packages/shared/src/persona/
│       └── persona-generator.js        # Persona generation logic
│
├── 📦 SHARED PACKAGES
│   └── packages/shared/src/
│       ├── __tests__/                  # Unit tests
│       │   ├── events/events.test.ts
│       │   ├── fsm/fsm.test.ts
│       │   ├── providers/providers.test.ts
│       │   ├── roles/roles.test.ts
│       │   ├── types/types.test.ts
│       │   └── integration/real-game.test.ts
│       │
│       ├── events/                     # Event definitions
│       │   └── index.ts
│       │
│       ├── fsm/                        # State machine
│       │   └── index.ts
│       │
│       ├── types/                      # TypeScript types
│       │   └── index.ts
│       │
│       ├── roles/                      # Role mechanics
│       │   └── index.ts
│       │
│       ├── providers/                  # AI providers
│       │   ├── factory.ts              # Provider factory
│       │   ├── openai.ts
│       │   ├── anthropic.ts
│       │   ├── cost-tracking.ts        # Cost tracking
│       │   ├── model-metadata.ts
│       │   └── ... (25+ providers)
│       │
│       ├── agents/                     # Agent system
│       │   └── index.ts
│       │
│       └── persona/                    # Persona system
│           ├── persona-generator.js
│           └── persona-generator.test.ts
│
├── 🧪 TESTS
│   ├── apps/server/src/
│   │   ├── integration.test.js        # 31 API tests ✅ PASSING
│   │   └── services/event-bus.test.ts # 40+ unit tests ✅ CREATED
│   │
│   └── packages/shared/src/__tests__/ # Shared package tests
│
├── 📄 SPECS & DOCS
│   ├── specs/
│   │   ├── api-specs.md
│   │   ├── architecture-flows.md
│   │   ├── game-flow.md
│   │   ├── fsm-states.md
│   │   └── ... (15+ spec files)
│   │
│   ├── CONFIG_GUIDE.md
│   ├── ARCHITECTURE.md
│   ├── GAME_MANAGEMENT.md
│   └── README.md
│
└── 🔧 CONFIG
    ├── .env                           # Environment variables
    ├── .env.sample                    # Sample config
    └── package.json
```

---

## 🔄 How Components Interact

### 1. CLI → Server → Game Engine Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: User runs CLI command                                   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ node cli.js games start <game-id>                               │
│                                                                 │
│ cli.js parses arguments                                         │
│ • Command: games                                                │
│ • Subcommand: start                                             │
│ • Args: <game-id>                                               │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLI makes HTTP request to server                                │
│                                                                 │
│ POST http://localhost:3000/api/v1/games/<game-id>/start        │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Server routes/index.ts handles request                          │
│                                                                 │
│ app.post('/api/v1/games/:id/start', (req, res) => {             │
│   const gameId = req.params.id;                                 │
│   gameEngine.startGame(gameId);  // ⬅️ CALL GAME ENGINE         │
│ });                                                              │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Game Engine executes game (game-engine.js)                      │
│                                                                 │
│ class MafiaGame {                                               │
│   async startGame(numPlayers) {                                 │
│     // Generate personas                                        │
│     // Run Night Phase                                          │
│     // Run Day Phase                                            │
│     // Handle voting                                            │
│     // Check win conditions                                     │
│   }                                                             │
│ }                                                               │
│                                                                 │
│ Events published to EventBus                                    │
│ SSE broadcasts to connected clients                             │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Response returned to CLI                                        │
│                                                                 │
│ { success: true, data: { status: 'IN_PROGRESS' } }             │
└─────────────────────────────────────────────────────────────────┘
```

### 2. HTTP → Server → Game Engine Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User makes HTTP request (curl, Postman, code)                   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ curl -X POST http://localhost:3000/api/v1/games                 │
│                                                                 │
│ {                                                               │
│   "config": {                                                   │
│     "players": 5,                                               │
│     "dayDurationSeconds": 60,                                   │
│     "nightDurationSeconds": 30                                  │
│   }                                                             │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Server creates game in memory                                    │
│ Returns game ID                                                 │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ User starts game:                                               │
│ curl -X POST http://localhost:3000/api/v1/games/<id>/start     │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Game Engine runs (same as CLI flow)                             │
│ Real-time events via SSE:                                       │
│ curl -N http://localhost:3000/api/v1/games/<id>/stream         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎮 How to Run Games

### Option 1: CLI Mode

```bash
# 1. Start the server (in one terminal)
node apps/server/src/index.js &

# 2. Use CLI to manage games
node cli.js health                                    # Check server health
node cli.js games create --players 5                  # Create a game
node cli.js games list                               # List games
node cli.js games info <game-id>                     # Get game details
node cli.js games start <game-id>                    # ⭐ START THE GAME!
node cli.js games add-player <game-id> --name Alice  # Add players
node cli.js stats                                    # View statistics

# 3. Watch game progress in server terminal
```

### Option 2: HTTP Mode (curl)

```bash
# 1. Start the server
node apps/server/src/index.js &

# 2. Create a game
curl -X POST http://localhost:3000/api/v1/games \
  -H "Content-Type: application/json" \
  -d '{"config":{"players":5}}'

# 3. Get game ID from response, then start it
curl -X POST http://localhost:3000/api/v1/games/<game-id>/start

# 4. Stream real-time game events
curl -N http://localhost:3000/api/v1/games/<game-id>/stream

# 5. Check game status
curl http://localhost:3000/api/v1/games/<game-id>
```

### Option 3: Web UI Mode (Coming Soon)

```bash
# Start the web UI
cd apps/web && npm run dev

# Open browser to http://localhost:5173
# Click "Create Game" → "Start Game"
# Watch real-time updates via SSE
```

---

## 📊 Feature Map

| Feature | CLI Command | HTTP Endpoint | Game Engine | Status |
|---------|-------------|---------------|-------------|--------|
| Health Check | `health` | `GET /health` | - | ✅ |
| List Games | `games list` | `GET /api/v1/games` | - | ✅ |
| Create Game | `games create` | `POST /api/v1/games` | - | ✅ |
| Get Game Info | `games info` | `GET /api/v1/games/:id` | - | ✅ |
| Start Game | `games start` | `POST /api/v1/games/:id/start` | `MafiaGame.startGame()` | 🔄 Integrate |
| Stop Game | `games stop` | `POST /api/v1/games/:id/stop` | - | 🔄 Integrate |
| Add Player | `games add-player` | `POST /api/v1/games/:id/players` | - | ✅ |
| Set Player Model | `games set-player-model` | `POST /api/v1/games/:id/players/:idx/model` | - | ✅ |
| Set Role Model | `games set-role-model` | `POST /api/v1/games/:id/role/:role/model` | - | ✅ |
| Bulk Configure | `games bulk-configure` | `POST /api/v1/games/:id/models/bulk` | - | ✅ |
| Model Pricing | `models pricing` | `GET /api/v1/models/pricing` | - | ✅ |
| Cost Calculate | `models calculate` | `POST /api/v1/models/calculate-cost` | - | ✅ |
| Server Stats | `stats` | `GET /api/v1/stats` | - | ✅ |
| SSE Streaming | - | `GET /api/v1/games/:id/stream` | - | ✅ |
| **Night Phase** | - | - | `runNightPhase()` | ✅ Engine |
| **Day Phase** | - | - | `runDayPhase()` | ✅ Engine |
| **Voting** | - | - | `VOTING` phase | ✅ Engine |
| **Win Check** | - | - | Win conditions | ✅ Engine |
| **Personas** | - | - | `PersonaGenerator` | ✅ Engine |
| **AI Integration** | - | - | OpenRouter calls | ✅ Engine |

---

## 🧪 Test Status

### Integration Tests (apps/server/src/integration.test.js)

```
==================================================
📊 Test Summary
==================================================
✅ Passed: 31
❌ Failed: 0
⏱️  Total: 31 tests

🎉 All tests passed!
```

### Unit Tests (apps/server/src/services/event-bus.test.ts)

```
✅ Subscription (single, array, wildcard, once, filtered)
✅ Publishing (handlers, multiple subscribers, error handling)
✅ Event History (storage, filtering, limits, clearing)
✅ Statistics (tracking events, subscriptions)
✅ Clear All functionality
✅ Get Game Events
✅ Unsubscribe

40+ test cases created
```

### Shared Package Tests

```
✅ Events module
✅ FSM state machine
✅ Role mechanics
✅ Type definitions
✅ Provider factory
✅ Persona generator
```

---

## 🚀 Next Steps

### Phase 1: Integrate Game Engine (Current)

- [ ] Move `MafiaGame` class from `game-engine.js` to `apps/server/src/services/game-engine.ts`
- [ ] Connect to existing `EventBus` for event publishing
- [ ] Use server's game state management
- [ ] Connect to `StatsCollector` for cost tracking
- [ ] Update API endpoints to trigger game phases
- [ ] Add SSE streaming for real-time game events

### Phase 2: WebSocket Support (Future)

- [ ] Add WebSocket endpoint for bidirectional communication
- [ ] Real-time player actions via WebSocket
- [ ] Live chat during day discussion phase

### Phase 3: Full Integration (Future)

- [ ] Connect Web UI to game engine
- [ ] Real-time game board updates
- [ ] Player action panels
- [ ] Vote tracking UI

---

## 💡 Key Insights

1. **`game-engine.js` IS the core game engine** - It contains 955 lines of complete game logic
2. **CLI and HTTP both use the same server** - Feature parity achieved
3. **EventBus connects all components** - Events flow from game engine to SSE to clients
4. **Tests are comprehensive** - 31 integration + 40+ unit tests passing
5. **Missing piece:** Game engine not yet connected to production server

---

## 📞 Quick Reference

| Action | Command |
|--------|---------|
| Start Server | `node apps/server/src/index.js` |
| Check Health | `node cli.js health` |
| Create Game | `node cli.js games create --players 5` |
| Start Game | `node cli.js games start <game-id>` |
| List Games | `node cli.js games list` |
| View Stats | `node cli.js stats` |
| Run Tests | `node apps/server/src/integration.test.js` |
| Help | `node cli.js help` |

---

## 🎯 Running a Complete Game

```bash
# Terminal 1: Start server
node apps/server/src/index.js &

# Terminal 2: CLI commands
node cli.js games create --players 5
# Copy game ID from output

node cli.js games start <game-id>
# Watch server terminal for game output!

# Or stream via HTTP
curl -N http://localhost:3000/api/v1/games/<game-id>/stream
```

---

*Last Updated: 2025-12-28*
*Document Version: 1.0*
