# Mafia AI Benchmark - Project Memory

## Quick Reference

**Project**: AI-powered social deduction game where multiple LLMs play Mafia
**Stack**: Node.js, Express, WebSocket, SQLite, TypeScript
**Location**: `/config/workspace/mafia`
**Repository**: github.com:wojons/mafia-ai-benchmark.git

## Current Status (Dec 28, 2025)

### ✅ Working Features

- Game creation and player management
- Role assignment (MAFIA, DOCTOR, SHERIFF, VIGILANTE, VILLAGER)
- Game start/stop transitions
- Night action submission endpoints
- Voting endpoints
- Accusation and role claim endpoints
- Model configuration (per-player, per-role, bulk)
- Cost tracking and model pricing
- SSE event streaming
- Server stats endpoint

### ✅ Test Suites (138 tests passing)

1. `games/run-tests.js` - 21 tests (basic mechanics)
2. `games/test-phases-cost.js` - 31 tests (FSM phases, cost tracking)
3. `games/test-game-mechanics-real.js` - 43 tests (API coverage)
4. `games/test-full-integration.js` - 43 tests (full integration)

### 🔄 In Progress

- Persona generation integration with game engine
- Complete multi-round game simulation
- Win condition verification

### 🔜 Future

- WebSocket support for real-time game events
- Full web UI integration
- Advanced persona traits system

## Core Architecture

### Game Flow

```
SETUP → NIGHT_ACTIONS → MORNING_REVEAL → DAY_DISCUSSION → DAY_VOTING → RESOLUTION
        (repeat)                                          (check win)
```

### Roles

- **MAFIA**: Can kill one player per night, knows other mafia
- **DOCTOR**: Can protect one player per night (can't self-protect twice)
- **SHERIFF**: Investigation reveals exact role
- **VIGILANTE**: Can kill once per game (not at night 1)
- **VILLAGER**: Can vote, no special abilities

### Win Conditions

- **MAFIA wins**: When mafia >= town (alive players)
- **TOWN wins**: When all mafia are eliminated

## API Endpoints

### Games

- `POST /api/v1/games` - Create game
- `GET /api/v1/games` - List games
- `GET /api/v1/games/:id` - Get game
- `POST /api/v1/games/:id/start` - Start game
- `POST /api/v1/games/:id/stop` - Stop game
- `POST /api/v1/games/:id/players` - Add player
- `GET /api/v1/games/:id/players` - List players

### Game Actions

- `POST /api/v1/games/:id/night-action` - Submit night action
- `POST /api/v1/games/:id/vote` - Submit vote
- `POST /api/v1/games/:id/accusation` - Make accusation
- `POST /api/v1/games/:id/claim-role` - Claim role

### Model Configuration

- `POST /api/v1/games/:id/players/:idx/model` - Set player model
- `POST /api/v1/games/:id/role/:role/model` - Set role model
- `POST /api/v1/games/:id/models/bulk` - Bulk update

### Stats & Costs

- `GET /api/v1/stats` - Server stats
- `GET /api/v1/models` - List models
- `GET /api/v1/models/pricing?model=` - Get pricing
- `POST /api/v1/models/calculate-cost` - Calculate cost

### Streaming

- `GET /api/v1/games/:id/events` - SSE events
- `GET /api/v1/games/:id/sse-status` - SSE status

## Key Files

### Server

- `apps/server/src/index.js` - Main HTTP server (497 lines)
- `apps/server/src/services/server-game-engine.js` - Game engine bridge
- `apps/server/src/routes/index.ts` - API routes
- `apps/server/src/db/repository.ts` - Database operations

### Game Engine

- `game-engine.js` - Standalone game engine
- `packages/shared/src/` - Shared packages (roles, events, providers)

### Tests

- `games/run-tests.js` - Basic test suite
- `games/test-phases-cost.js` - Phase & cost tests
- `games/test-game-mechanics-real.js` - Real mechanics tests
- `games/test-full-integration.js` - Full integration tests

## Configuration

### Environment Variables

```
PORT=3000                    # HTTP server port
DB_PATH=./data/mafia.db     # SQLite database path
MAFIA_SERVER_URL=http://localhost:3000
```

### Game Config

```javascript
{
  numPlayers: 10,
  roles: [
    { role: 'MAFIA', count: 3 },
    { role: 'DOCTOR', count: 1 },
    { role: 'SHERIFF', count: 1 },
    { role: 'VIGILANTE', count: 1 },
    { role: 'VILLAGER', count: 4 },
  ],
  nightPhaseDuration: 60,
  dayPhaseDuration: 120,
  votingDuration: 30,
  minPlayers: 5,
  maxPlayers: 12,
}
```

## AI Providers Supported

OpenAI, Anthropic, Google, DeepSeek, Groq, Meta, Qwen, XAI, LM Studio, Ollama, OpenRouter, and 15+ more.

## Commands

```bash
# Run server
node apps/server/src/index.js

# Run all tests
node games/run-tests.js all
node games/test-phases-cost.js
node games/test-game-mechanics-real.js
node games/test-full-integration.js

# Run integration tests
node test-cross-interface.integration.js
```

## Important Notes

1. **Player IDs**: Generated with timestamp + counter to ensure uniqueness
2. **Game Status**: SETUP → IN_PROGRESS → ENDED
3. **Role Assignment**: Roles assigned when game starts
4. **SSE Streaming**: Real-time events for game phases, actions, eliminations
5. **Cost Tracking**: Per-game and per-player cost tracking with thresholds

## Git History

- `a051959` - Fix player ID uniqueness and test suite
- `5655dae` - Add comprehensive phase & cost tracking test suite
- `e837823` - Add real game mechanics test suite

## Next Steps

1. Implement full multi-round game simulation
2. Add win condition verification tests
3. Integrate persona generation with game start
4. Add WebSocket support for real-time play
5. Build web UI for game watching
