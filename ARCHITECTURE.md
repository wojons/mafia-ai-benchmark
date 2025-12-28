# Mafia AI Benchmark - Architecture & Game Flow

## 🎮 System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MAFIA AI BENCHMARK SYSTEM                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     CORE GAME ENGINE                             │   │
│  │  demo-game-correct-flow-v2.js                                   │   │
│  │  - Main game logic                                              │   │
│  │  - Night/Day phases                                             │   │
│  │  - Role actions (Doctor, Sheriff, Vigilante)                    │   │
│  │  - AI agent coordination                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                         │
│              ┌───────────────┼───────────────┐                         │
│              ▼               ▼               ▼                         │
│     ┌────────────────┐ ┌──────────────┐ ┌────────────────┐             │
│     │ GAME MANAGER   │ │   HTTP API   │ │   WEB UI       │             │
│     │ game-manager.js│ │  (server/)   │ │   (web/)       │             │
│     │ - Save/Load    │ │  - REST API  │ │  - React App   │             │
│     │ - List games   │ │  - WebSocket │ │  - Real-time   │             │
│     └────────────────┘ └──────────────┘ └────────────────┘             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🎯 Game Flow (Corrected)

```
🌙 NIGHT PHASE (Sequential Actions)
│
├── 😈 STEP 1: MAFIA TEAM CHAT
│   ├── Mafia members discuss privately (2-3 messages each)
│   ├── Build consensus on kill target
│   └── Vote on final target
│
├── 💉 STEP 2: DOCTOR ACTION
│   ├── Doctor chooses someone to protect
│   ├── Cannot protect same person twice
│   └── Does NOT know mafia's target ❌ (FIXED!)
│
├── 👮 STEP 3: SHERIFF INVESTIGATION
│   ├── Sheriff investigates one person
│   ├── Learns exact role (Mafia, Doctor, etc.)
│   └── Does NOT know mafia's target or doctor's choice ❌ (FIXED!)
│
├── 🔫 STEP 4: VIGILANTE ACTION
│   ├── Choose to SHOOT or PASS (one-time only)
│   └── Does NOT know others' plans ❌ (FIXED!)
│
└── 🌅 STEP 5: NIGHT RESOLUTION
    ├── Apply vigilante shot (if any)
    ├── Apply mafia kill (unless protected)
    ├── Reveal deaths
    └── Proceed to day

☀️ DAY PHASE
│
├── 💬 STEP 1: DISCUSSION
│   └── All players discuss (2 messages each)
│
├── 🗳️ STEP 2: VOTING
│   └── Players vote to lynch someone
│
└── 🏆 STEP 3: WIN CHECK
    ├── Mafia wins: mafia ≥ town
    └── Town wins: all mafia eliminated
```

## 🔒 Information Flow Rules

### What Each Role Knows

**Mafia:**
- ✅ Own team members' identities
- ✅ Private team chat history
- ❌ Town players' roles
- ❌ Doctor/Sheriff/Vigilante choices

**Doctor:**
- ✅ Who they protected
- ✅ Previous night's deaths (public)
- ❌ Mafia's target ❌ (now fixed!)
- ❌ Others' night actions

**Sheriff:**
- ✅ Person they investigated (exact role)
- ✅ Previous night's deaths (public)
- ❌ Mafia's target ❌ (now fixed!)
- ❌ Doctor/Vigilante choices

**Vigilante:**
- ✅ Whether they've shot before
- ✅ Previous night's deaths (public)
- ❌ Others' plans ❌ (now fixed!)

**Villager:**
- ✅ Previous night's deaths (public)
- ✅ Investigation results (announced publicly)
- ❌ Everything else

## 📁 File Structure

```
/config/workspace/mafia/
│
├── 🎮 CORE GAME ENGINE
│   ├── demo-game-correct-flow-v2.js   ✅ MAIN SCRIPT (use this!)
│   ├── demo-game-correct-flow.js      ⚠️  Old version
│   └── demo-game.js                   ❌ Legacy (broken)
│
├── 📋 GAME MANAGEMENT
│   ├── game-manager.js                ✅ Save/load games
│   ├── mafia.sh                       ✅ CLI wrapper
│   └── saved-games/                   ✅ Game storage
│
├── 🌐 API & WEB
│   ├── apps/server/src/index.ts       HTTP API server
│   ├── apps/web/src/App.tsx           Web interface
│   └── apps/cli/src/commands/         CLI commands
│
├── 📖 DOCUMENTATION
│   ├── README.md                      Main documentation
│   ├── GAME_MANAGEMENT.md             Game manager guide
│   ├── QUICK_REFERENCE.md             Command reference
│   ├── IMPLEMENTATION_STATUS.md       Current status
│   └── specs/                         Technical specs
│
└── 🧪 TESTING
    ├── packages/shared/src/__tests__/ Unit tests
    └── run-real-game.ts               Real game runner
```

## 🚀 How to Play

### Option 1: Quick Demo (Recommended for Testing)

```bash
cd /config/workspace/mafia
node demo-game-correct-flow-v2.js
```

**Use this for:**
- Testing the game mechanics
- Quick demos
- Each run = new independent game

---

### Option 2: Managed Games (Save/Resume)

```bash
# Create a game
./mafia.sh new 10

# List games
./mafia.sh list

# Continue a game
./mafia.sh continue [gameId]
```

**Use this for:**
- Long-running campaigns
- Tracking multiple games
- Saving game state

---

### Option 3: Using Game Manager Directly

```bash
# Create game
node game-manager.js new 10

# List games
node game-manager.js list

# Continue game
node game-manager.js continue [gameId]
```

## 🔧 For Developers

### Architecture Principles

1. **Event Sourcing**: All game events stored with visibility levels
2. **Role Isolation**: Each role has limited information (now fixed!)
3. **State Management**: Clean separation between phases
4. **AI Coordination**: Split-pane consciousness (THINK vs SAYS)

### API Design

```typescript
// HTTP API (coming soon)
POST /api/games              // Create new game
GET  /api/games              // List all games
GET  /api/games/:id          // Get game state
POST /api/games/:id/action   // Take an action
GET  /api/games/:id/events   // Get game events
```

### Key Classes

```typescript
class MafiaGame {
  players: Player[];
  round: number;
  gameEvents: GameEvent[];
  
  async runNightPhase(gameId)
  async runDayPhase(gameId)
  async getAIResponse(player, gameState)
}

class GameManager {
  createGame(numPlayers): Game
  saveGame(game): void
  loadGame(gameId): Game
  listGames(): Game[]
}
```

## 🐛 Bug Fixes Applied

### ✅ FIXED: Information Leakage

**Problem**: Doctor/Sheriff/Vigilante were told mafia's target in their prompts

**Solution**: Remove mafia target from their `previousPhaseData`

**Before (WRONG):**
```javascript
previousPhaseData: `Mafia kill target: ${this.mafiaKillTarget?.name}`
```

**After (CORRECT):**
```javascript
previousPhaseData: `Previous night: ${deaths || 'No deaths'}`
```

### ✅ FIXED: Variable Scope

**Problem**: `mafiaKillTarget` not accessible in later phases

**Solution**: Declare at class level: `this.mafiaKillTarget = null`

## 📊 Test Coverage

- ✅ 22 FSM tests (game state transitions)
- ✅ 13 Role tests (role mechanics)
- ✅ 35 Provider tests (AI integration)
- **Total: 70+ passing tests**

## 🎯 Next Steps

1. **Consolidate Scripts**
   - Keep only `demo-game-correct-flow-v2.js` as main script
   - Remove/merge old versions
   - Update all documentation

2. **Build HTTP API**
   - REST endpoints for game management
   - WebSocket for real-time updates
   - Integration with web UI

3. **Add Pre-made Scenarios**
   - Test specific game states
   - Reproduce edge cases
   - Benchmark AI performance

4. **Enhance Documentation**
   - Complete README
   - API documentation
   - Game state examples

---

*Last Updated: December 28, 2025*
*Status: ✅ Bug Fixed | ✅ Tests Passing | 🎮 Games Running*
