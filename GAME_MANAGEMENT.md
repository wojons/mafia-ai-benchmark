# 🎮 Mafia AI Benchmark - Game Management Guide

## Overview

This guide explains how to create, manage, and play Mafia games with the AI Benchmark system.

---

## Quick Start

### Option 1: One-off Demo Game (Easiest)

```bash
cd /config/workspace/mafia
node demo-game-correct-flow-v2.js
```

**Result**: Creates a new game from start to finish. Each run is completely independent.

---

### Option 2: Using the Game Manager

```bash
# Create a new game
./mafia.sh new              # 10 players (default)
./mafia.sh new 8            # 8 players
./mafia.sh new 6            # 6 players

# List all games
./mafia.sh list

# Run demo (one-off)
./mafia.sh demo

# Delete a game
./mafia.sh delete [gameId]
```

---

## Game Session Types

### 🔹 Type 1: One-off Games (Ephemeral)

**Command**: `node demo-game-correct-flow-v2.js`

**Characteristics**:
- ✅ Quick and simple
- ✅ Each run is completely new
- ✅ Different role assignments each time
- ❌ Not saved between sessions
- ❌ Can't resume later

**Use Case**: Testing, quick demos,每次运行都是独立的游戏演示

**Example Session**:
```bash
$ node demo-game-correct-flow-v2.js
🎮 Mafia AI Benchmark - CORRECT MAFIA FLOW v2
...
🔒 Game ID: 9a999998-9bb9-4bbb-cb8b-a9aabb9aa8aa
🔒 ADMIN PANEL - Role Assignment (Secret!):
  👱 Alice: VILLAGER
  💉 Bob: DOCTOR
  ...
🎮 Starting Mafia Game v2

[Game runs to completion...]

📋 GAME EVENT LOG (Event Sourcing):
Total events: 47
```

---

### 🔹 Type 2: Persistent Games (Saved)

**Command**: `./mafia.sh new` or `node game-manager.js new`

**Characteristics**:
- ✅ Games saved to disk
- ✅ Can resume later
- ✅ Track multiple games
- ✅ Complete game history
- ❌ Requires management

**Use Case**: Long-running campaigns, comparing different strategies

**Example Session**:
```bash
$ ./mafia.sh new 8
🎮 Game created: game-1735384000000-abc123
   Players: 8
   Run: ./mafia.sh continue game-1735384000000-abc123

👥 Players:
  DOCTOR Alice
  VIGILANTE Bob
  SHERIFF Charlie
  VILLAGER Diana
  MAFIA Eve [MAFIA]
  MAFIA Frank [MAFIA]
  VILLAGER Grace
  VILLAGER Henry

$ ./mafia.sh list
📋 Saved Games:
------------------------------------------------------------
  game-1735384000000-abc123
     Round: 0 | Phase: LOBBY | Players: 8/8
     Created: 12/28/2025, 2:05:20 AM
```

---

## File Structure

```
/config/workspace/mafia/
├── demo-game-correct-flow-v2.js   # Main game engine (one-off)
├── game-manager.js                 # Game save/load system
├── mafia.sh                        # Easy-to-use wrapper script
├── saved-games/                    # Directory for saved games
│   ├── game-abc123.json           # Saved game state
│   ├── game-def456.json           # Another saved game
│   └── ...
└── ...
```

---

## Saved Game Format

Each saved game contains complete state:

```json
{
  "id": "game-1735384000000-abc123",
  "createdAt": "2025-12-28T01:05:20.254Z",
  "round": 0,
  "phase": "LOBBY",
  "players": [
    {
      "id": "player-1",
      "name": "Alice",
      "role": "DOCTOR",
      "isMafia": false,
      "isAlive": true,
      "nightTarget": null
    },
    ...
  ],
  "gameEvents": [],
  "metadata": {
    "lastDoctorProtection": null,
    "vigilanteShotUsed": false,
    "mafiaKillTarget": null
  }
}
```

---

## Game Commands Reference

### One-off Demo Games

```bash
# Run a complete game from start to finish
node demo-game-correct-flow-v2.js

# Run with custom player count
PLAYERS=8 node demo-game-correct-flow-v2.js
```

### Persistent Game Management

```bash
# Create new game
./mafia.sh new              # 10 players
./mafia.sh new 8            # 8 players
./mafia.sh new 6            # 6 players
./mafia.sh new 12           # 12 players

# List all saved games
./mafia.sh list

# Continue a game
./mafia.sh continue                     # Most recent game
./mafia.sh continue game-id-here        # Specific game

# Delete a game
./mafia.sh delete game-id-here

# Show help
./mafia.sh help
```

---

## Multiple Games Scenario

Here's how you might run multiple concurrent games:

```bash
# Session 1: Create a competitive game
./mafia.sh new 10
# Output: game-abc123

# Session 2: Create a test game
./mafia.sh new 6
# Output: game-def456

# Session 3: Create another game
./mafia.sh new 8
# Output: game-ghi789

# List all games
./mafia.sh list
# Output:
#   game-abc123  (Round 0, LOBBY, 10/10 alive)
#   game-def456  (Round 0, LOBBY, 6/6 alive)
#   game-ghi789  (Round 0, LOBBY, 8/8 alive)

# Continue a specific game
./mafia.sh continue game-abc123

# Compare results later
./mafia.sh list
# Output:
#   game-abc123  (Round 3, DAY 3, 5/10 alive)
#   game-def456  (Round 1, NIGHT 1, 5/6 alive)
#   game-ghi789  (Round 0, LOBBY, 8/8 alive)
```

---

## Player Count Recommendations

| Players | Mafia | Doctor | Sheriff | Vigilante | Villagers | Recommended For |
|---------|-------|--------|---------|-----------|-----------|-----------------|
| 6       | 1     | 1      | 1       | 1         | 2         | Quick games     |
| 8       | 2     | 1      | 1       | 1         | 3         | Standard        |
| 10      | 2     | 1      | 1       | 1         | 5         | Better balance  |
| 12      | 3     | 1      | 1       | 1         | 6         | Long games      |

---

## What Happens in a Game

### Game Phases

1. **🌙 Night Phase**
   - 😈 Mafia Team Discussion (multiple messages)
   - 🎯 Mafia Consensus/Vote
   - 💉 Doctor Protection
   - 👮 Sheriff Investigation
   - 🔫 Vigilante Action
   - 🌅 Resolution

2. **☀️ Day Phase**
   - 💬 Discussion
   - 🗳️ Voting
   - 🏆 Win Check

3. **🔄 Loop** until game ends

### Win Conditions

- **Town Wins**: All mafia eliminated
- **Mafia Wins**: Mafia count ≥ Town count

---

## Tips & Best Practices

### For Testing
```bash
# Run multiple quick games to test
for i in {1..5}; do
  echo "=== Game $i ==="
  node demo-game-correct-flow-v2.js | tail -20
done
```

### For Comparing Strategies
```bash
# Create and save games
./mafia.sh new 10   # Game 1
./mafia.sh new 10   # Game 2
./mafia.sh new 10   # Game 3

# Run each to completion
node demo-game-correct-flow-v2.js   # First config
# ... modify AI parameters ...
node demo-game-correct-flow-v2.js   # Second config
```

### For Long Campaigns
```bash
# Create game
./mafia.sh new 10
# Note the game ID: game-abc123

# Play through multiple sessions
./mafia.sh continue game-abc123
./mafia.sh continue game-abc123
./mafia.sh continue game-abc123

# Check status anytime
./mafia.sh list
```

---

## Troubleshooting

### "No saved games found"
```bash
$ ./mafia.sh continue
❌ No saved games found. Create one first with: ./mafia.sh new
```
**Fix**: Run `./mafia.sh new` first.

### "Game not found"
```bash
$ ./mafia.sh continue game-xyz
❌ Game not found: game-xyz
```
**Fix**: Run `./mafia.sh list` to see valid game IDs.

### Clear all games
```bash
rm -rf /config/workspace/mafia/saved-games/*
./mafia.sh list
# Output: No saved games
```

---

## Advanced: Direct Node Usage

For more control, use the Node.js APIs directly:

```javascript
// In game-manager.js
const manager = new GameManager();

// Create game
const game = manager.createGame(10);

// Load game
const savedGame = manager.games[gameId];

// Save game
manager.saveGame(game);

// Delete game
manager.deleteGame(gameId);

// List games
const games = manager.listGames();
```

---

## Summary

| Task | Command |
|------|---------|
| Quick demo | `node demo-game-correct-flow-v2.js` |
| New game | `./mafia.sh new` or `./mafia.sh new 8` |
| List games | `./mafia.sh list` |
| Continue game | `./mafia.sh continue` or `./mafia.sh continue [id]` |
| Delete game | `./mafia.sh delete [id]` |
| Get help | `./mafia.sh help` |

---

*Last Updated: December 28, 2025*
*Version: 1.0*
