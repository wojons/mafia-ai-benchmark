# Mafia AI Benchmark - Project Memory

## Quick Reference

**Project**: AI-powered social deduction game where multiple LLMs play Mafia
**Stack**: Node.js, Express, WebSocket, SQLite, TypeScript
**Location**: `/config/workspace/mafia`
**Repository**: github.com:wojons/mafia-ai-benchmark.git
**Status**: REAL LLM CALLS WORKING ✅ ALL CRITICAL + QUALITY + ULTRATHINK FEATURES COMPLETE ✅
**Version**: 4.3
**Last Commit**: a8cfb35 - "feat: ULTRATHINK analysis - 4 major enhancements"

## Current Status (Dec 28, 2025)

### 🎉 FULLY PRODUCTION READY

**BLOCKER + QUALITY (8 tasks):** Completed via commits 98fa51d + fddbdd7
**ULTRATHINK FEATURES (4 tasks):** Completed via commit a8cfb35

✅ **BLOCKER-1: Seeds Now Optional** - LLM chooses freely when no seed provided
✅ **BLOCKER-2: Persona First, Role After** - Personas generated before knowing role
✅ **CRITICAL-3: Win Condition at Start of Night** - Game can end during night phase
✅ **CRITICAL-4: Vigilante One-Shot Working** - Flag checked and enforced
✅ **CRITICAL-5: Multiple Doctors/Sheriffs** - All act independently
✅ **QUALITY-6: Think→Speak Pattern Complete** - All phases show reasoning (voting was missing)
✅ **QUALITY-7: Mafia Memory Complete** - Shows ALL messages (was only last 3)
✅ **QUALITY-8: Villager Base Prompt Added** - Everyone gets villager behavior foundation

### 🚀 ULTRATHINK Enhancements (COMMIT: a8cfb35)

Deep multi-dimensional analysis of 4 major features:

**ULTRA-1: Sheriff Self-Verification Fix + Multi-Role Configuration**

- Sheriff skips self-investigation (auto-selects different target)
- Game configuration system with options parameter
- Experimental multi-role support (`allowMultiRole`)
- Enables "mole" scenarios: Sheriff+Mafia, Doctor+Mafia, etc.
- Anti-stacking rules: multiple mafia can't all be doctor/sheriff
- Full documentation in `specs/role-mechanics.md`

**ULTRA-2: JSON Parse Retry Logic (No Mock Fallback)**

- parseJSONResponse returns `{valid: true/false, ...}` struct
- getAIResponse retries on parse failures (not just network errors)
- Configurable maxRetries (3) and retryDelay (1000ms)
- Progressive retry with warning messages
- Prevents mock data from ruining real games
- Handles both parse errors and network failures

**ULTRA-3: Configurable Context Window Management**

- `maxContextChars` setting (default: 100,000 characters)
- gameHistory tracks all events with intelligent trimming
- trimGameHistory() removes oldest COMPLETE messages (never splits partial messages)
- Maintains most recent context by removing from beginning
- Prevents context overflow during long games
- Preserves message integrity (incomplete messages dropped entirely)

**ULTRA-4: Persona Generation Diversity Fix**

- `personaTemperature` config (default: 1.0, higher = more diverse)
- Enhanced LLM prompt with explicit diversity instructions
- Fixed identical "Logical-Sequential" issue
- generateProceduralPersona() now creates diverse personas:
  - 10 cognitive styles: Visual-Spatial, Intuitive-Holistic, Emotional-Expressive, etc.
  - 10 communication cadences: Direct, Eloquent, Whimsical, Diplomatic, etc.
  - 3 social tendencies, 3 conflict styles, 4 primary goals, 4 key memories
  - Random verbal tics, dynamic states (happiness, stress, curiosity, anger)

### 🔮 Remaining Future Improvements (Lower Priority)

The game engine has 3 remaining items from `specs/AUDIT_RESULTS.md`:

1. **Sequential API Calls With Artificial Delays** - Could use parallel calls for efficiency (minor optimization)
2. **No Statistics Tracking** - Stats collection for winners, model performance, costs (nice-to-have feature)
3. **Monolithic 2100+ Line File** - Split into modules for better maintainability (architectural improvement)

### 🔍 Implementation Specs

- `specs/game-flow-and-rules.md` - Complete game flow specification
- `specs/AUDIT_RESULTS.md` - 11 critical issues with detailed analysis
- `specs/IMPLEMENTATION_PLAN.md` - Step-by-step fix instructions with line numbers

### ✅ Test Suites (409+ API tests passing)

1. `packages/shared/src/__tests__/fsm/fsm.test.ts` - 51 tests
2. `packages/shared/src/__tests__/roles/roles.test.ts` - 58 tests
3. `packages/shared/src/__tests__/providers/providers.test.ts` - 59 tests
4. `packages/shared/src/__tests__/personas/persona.test.js` - 45 tests
5. `packages/shared/src/__tests__/events/events.test.ts` - 28 tests
6. `packages/shared/src/__tests__/types/types.test.ts` - 24 tests
7. `packages/shared/src/__tests__/integration/real-game.test.ts` - 7 tests
8. `packages/shared/src/__tests__/personas/persona-generator.test.js` - 13 tests ⭐ **NEW**
9. `apps/server/src/services/event-bus.test.ts` - 30 tests ⭐ **NEW**
10. `apps/server/src/integration.test.js` - 63 tests ⭐ **NEW**
11. `apps/cli/src/integration.test.js` - 31 tests ⭐ **NEW**

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

## Critical Issues Requiring Immediate Attention

### BLOCKER Issues (Cannot proceed without these)

1. ❌ **Remove Seeds from Persona Generation**
   - Current: `generatePersonaFromSeed(seedDescription, role)` at line 72
   - Should be: `generatePersona()` with NO parameters
   - Prompt should say "Choose ANY character" (no seed description)
   - Remove all seed arrays from startGame (lines 885-919)

2. ❌ **Separate Persona Generation from Role Assignment**
   - Current: Persona generated WITH role info in same call
   - Should be: Generate ALL personas first (parallel), THEN assign roles
   - Personas generated without any game context
   - Roles assigned randomly AFTER personas created

### CRITICAL Issues (Game-Breaking Bugs)

3. ⏳ **Win Condition Check at Start of Night**
   - Location: `runNightPhase()` function, line 1005+
   - Add check BEFORE night phase starts (after this.round++)
   - Should check: `mafia >= town` and `mafia == 0`

4. ⏳ **Vigilante One-Shot Enforcement**
   - Location: `runNightPhase()` vigilante section around line 1005-1106
   - `this.vigilanteShotUsed` is created but NEVER checked
   - Add `&& !this.vigilanteShotUsed` to filtering logic
   - Set to true after actually shooting

5. ⏳ **Multiple Doctors/Sheriffs Support**
   - Doctor: Line 1430-1475 currently only uses `aliveDoctor[0]`
   - Sheriff: Line 1493-1537 currently only uses `aliveSheriff[0]`
   - Change from single doctor/sheriff to `for (const doctor of aliveDoctors)`

### HIGH QUALITY Issues (Spec Compliance)

6. ⏳ **Think→Speak Pattern in All Prompts**
   - Working: Mafia chat, Day discussion
   - Missing: Doctor action, Sheriff investigation, Vigilante action, Voting
   - Add to `createPrompt()` function for each role

7. ⏳ **Mafia Full Memory**
   - Current: `mafiaMessages.slice(-3)` (line 1169) - only last 3 messages
   - Should be: `mafiaMessages` (ALL messages)

8. ⏳ **Villager Base Prompt for Everyone**
   - Should be first thing in ALL prompts (before role-specific)
   - Mafia gets this + secret mafia instructions
   - Other roles get this + their role instructions

9. ⏳ **Remove Artificial API Delays**
   - Current: `setTimeout(100)` between calls (line 952)
   - Should use `Promise.all()` for parallel persona generation

10. ⏳ **Statistics Tracking**
    - Zero implementation currently
    - Need: winner tracking, per-model win rates, per-role win rates
    - Need: token usage, cost per game, store to database

11. ⏳ **Split Monolithic File**
    - Current: `game-engine.js` is 2100+ lines
    - Should split into:
      - `engine/game.js` - Main game loop
      - `engine/roles/*.js` - Role-specific logic
      - `engine/phases/*.js` - Phase handlers
      - `engine/persona.js` - Persona generation
      - `engine/memory.js` - Memory management
      - `engine/stats.js` - Statistics tracking

## Next Steps

### Priority 1: Fix Critical Issues (ULTRATHINK execution in progress)

See `specs/IMPLEMENTATION_PLAN.md` for detailed fix instructions.

### Priority 2: Mafia Consensus Logic

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
