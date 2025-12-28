# Mafia AI Benchmark - Project Memory

## Quick Reference

**Project**: AI-powered social deduction game where multiple LLMs play Mafia
**Stack**: Node.js, Express, WebSocket, SQLite, TypeScript
**Location**: `/config/workspace/mafia`
**Repository**: github.com:wojons/mafia-ai-benchmark.git
**Status**: REAL LLM CALLS WORKING ✅
**Version**: 4.0
**Last Commit**: b4e706e - "feat: Game engine now runs real LLM calls"

## Current Status (Dec 28, 2025)

### ✅ Working Features

- Game creation and player management
- Role assignment (MAFIA, DOCTOR, SHERIFF, VIGILANTE, VILLAGER)
- Game start/stop transitions
- Night action submission endpoints
- Voting endpoints
- Model configuration (per-player, per-role, bulk)
- Cost tracking and model pricing
- SSE event streaming
- Server stats endpoint
- **REAL LLM CALLS via OpenRouter** ✅
- **Server loads game engine module** ✅

### ✅ Test Suites (272+ API tests passing)

1. `packages/shared/src/__tests__/fsm/fsm.test.ts` - 51 tests
2. `packages/shared/src/__tests__/roles/roles.test.ts` - 58 tests
3. `packages/shared/src/__tests__/providers/providers.test.ts` - 59 tests
4. `packages/shared/src/__tests__/personas/persona.test.js` - 45 tests
5. `packages/shared/src/__tests__/events/events.test.ts` - 28 tests
6. `packages/shared/src/__tests__/types/types.test.ts` - 24 tests
7. `packages/shared/src/__tests__/integration/real-game.test.ts` - 7 tests

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
- `GET /api/v1/games/:id/engine-status` - Game engine status

## Key Files

### Server

- `apps/server/src/index.js` - Main HTTP server (1400+ lines)
- `apps/server/src/services/server-game-engine.js` - Game engine bridge
- `apps/server/src/db/repository.ts` - Database operations

### Game Engine

- `game-engine.js` - Game engine (773 lines) - **MAKES REAL LLM CALLS**
- `packages/shared/src/` - Shared packages (roles, events, providers)

## Configuration

### Environment Variables

```
PORT=3000                    # HTTP server port
DB_PATH=./data/mafia.db     # SQLite database path
OPENAI_API_KEY=sk-or-v1-...  # OpenRouter API key
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
}
```

## AI Providers Supported

OpenAI, Anthropic, Google, DeepSeek, Groq, Meta, and 15+ more via OpenRouter.

## Commands

```bash
# Run game with real LLM calls
node game-engine.js

# Run server with game engine loaded
node apps/server/src/index.js

# Run CLI
./mafia.sh demo
./mafia.sh config --show

# Run tests
cd packages/shared && npm test
```

## Git History

- `b4e706e` - feat: Game engine now runs real LLM calls
- `fb45919` - Add game logic test suite
- `a051959` - Fix player ID uniqueness and test suite
- `5655dae` - Add comprehensive phase & cost tracking test suite
- `e837823` - Add real game mechanics test suite

## Important Notes

1. **Player IDs**: Generated with timestamp + counter to ensure uniqueness
2. **Game Status**: SETUP → IN_PROGRESS → ENDED
3. **Role Assignment**: Roles assigned when game starts
4. **SSE Streaming**: Real-time events for game phases, actions, eliminations
5. **Cost Tracking**: Per-game and per-player cost tracking with thresholds
6. **Real LLM Calls**: Game engine now makes real API calls to OpenRouter

## Next Steps

### Priority 1: Mafia Consensus Logic

- Fix mafia kill voting (currently 3-way tie, need consensus)
- Add persuasion in mafia chat
- Track mafia discussion history

### Priority 2: Server Game Management

- Connect API endpoints to game engine
- Add game creation via POST /api/v1/games
- Implement start/stop game via API
- Connect night-action endpoint to real processing

### Priority 3: WebSocket Support

- Real-time game events via WebSocket
- Live game watching
- Spectator mode
