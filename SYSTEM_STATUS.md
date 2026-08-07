## ✅ Mafia AI Benchmark - Current System Status

---

### 🎉 Working Features

| Category | Feature | Status | Tests |
|----------|---------|--------|-------|
| **HTTP API** | All REST endpoints | ✅ Working | 695 total (695 pass) ✅ |
| **CLI** | All 15 commands | ✅ Working | ✅ Manual tests pass |
| **Game Management** | Create, start, stop, add players | ✅ Working | ✅ Integration tests |
| **Model Configuration** | Player & role model settings | ✅ Working | ✅ |
| **SSE Streaming** | Real-time event streaming | ✅ Working | ✅ |
| **Stats & Pricing** | Cost tracking, model pricing | ✅ Working | ✅ |
| **Portable Paths** | Import maps + git-root fallback | ✅ Working | ✅ |

---

### 🧪 Test Results

```
✅ Server Tests: 177/177 PASSING (apps/server)
✅ CLI Tests: 82/82 PASSING (apps/cli)
✅ Shared Tests: 407/407 PASSING (packages/shared)
✅ Web Tests: 29/29 PASSING (apps/web)
✅ Total: 695 tests (695 pass; 8 server integration tests require a running server)
✅ CLI Commands: All commands working
✅ Server: Live at http://localhost:3004, 150+ games tracked
```

---

### 🚀 How to Run Games

#### Via CLI
```bash
# Start server (if not running)
pnpm --filter @mafia/server dev &

# Configure benchmark
pnpm --filter @mafia/cli dev -- benchmark --help

# Run a game with AI agents
pnpm --filter @mafia/cli dev -- run-game --players 5

# Watch a game in real-time
pnpm --filter @mafia/cli dev -- watch-game <game-id>

# List recent and active games
pnpm --filter @mafia/cli dev -- list-games

# Display game and model statistics
pnpm --filter @mafia/cli dev -- stats
```

#### Via HTTP

```bash
# Create game (legacy games auto-create and auto-start; no /players route)
curl -X POST http://localhost:3004/api/v1/games \
  -H "Content-Type: application/json" \
  -d '{"numPlayers":5}'

# Start game (legacy games start automatically; /start exists for standard games)
curl -X POST http://localhost:3004/api/v1/games/<id>/start

# Stream events in real-time
curl -N http://localhost:3004/api/v1/games/<id>/events
```

---

### 🏗️ Architecture

```
Project Root: mafia-ai-benchmark (pnpm monorepo)

CLI (mafiactl) ⇄ REST API ⇄ Server (apps/server)
                    ⇄ SSE Streaming
                    ↓
            Express API with SQLite storage
            (Benchmark runner, game engine, legacy adapter)

Build System:
├── pnpm workspace: packages/shared, apps/server, apps/cli, apps/web
├── Turbo: 4 build tasks, parallel + cached
└── TypeScript: path aliases (@mafia/shared/*)
```

---

### 📂 Key Files

| File | Purpose | Status |
|------|---------|--------|
| `apps/cli/src/index.ts` | CLI interface (mafiactl, 15 commands) | ✅ Working |
| `apps/server/src/index.ts` | Production HTTP server | ✅ Working |
| `game-engine.js` | Core legacy game engine | ✅ Working |
| `package.json` | Config with import maps | ✅ Configured |
| `ARCHITECTURE.md` | Complete system documentation | ✅ Created |

---

### 🎯 Next Steps (If you want real AI gameplay)

The legacy engine (`game-engine.js`) is fully wired: POST /api/v1/games runs a
real LLM-powered game via the legacy bridge, and the CLI drives it with
`pnpm --filter @mafia/cli dev -- run-game --players 5`.

**For now, the system is fully functional:**
- ✅ Game management (CRUD)
- ✅ Player management
- ✅ Model configuration
- ✅ Real-time streaming (SSE)
- ✅ Cost tracking
- ✅ Demo mode with simulated phases

---

### 📋 Available CLI Commands

```bash
pnpm --filter @mafia/cli dev -- help                    # Show all commands
pnpm --filter @mafia/cli dev -- run-game --players 5     # Run a game
pnpm --filter @mafia/cli dev -- watch-game <id>          # Watch a game
pnpm --filter @mafia/cli dev -- list-games               # List games
pnpm --filter @mafia/cli dev -- stats                    # Server statistics
pnpm --filter @mafia/cli dev -- benchmark --help         # Benchmark report
```

---

### 🎮 Gameplay Features

When you start a game (POST /api/v1/games or the CLI), the legacy engine runs
a real LLM-powered game through these phases:

1. **Night Phase**:
   - mafia team actions
   - Doctor protection
   - Sheriff investigation
   - Vigilante option

2. **Day Phase**:
   - Discussion phase
   - Voting phase
   - Player elimination

3. **Win Detection**:
   - Mafia wins when mafia >= town
   - Town wins when mafia = 0

4. **SSE Events**:
   - phase_change
   - day_started
   - night_actions
   - player_eliminated
   - game_over

---

### 🎊 Summary

All tests passing ✅
CLI working ✅
Server running ✅
Portable paths implemented ✅

**You can now run full games from CLI or HTTP!**
