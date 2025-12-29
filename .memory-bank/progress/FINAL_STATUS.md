# 🎯 Mafia AI Benchmark - Summary & Fixes

## ✅ EVIDENCE & CASE BUILDING SYSTEM - COMPLETE (Dec 29, 2025)

### What Was Implemented

#### Evidence System Components

1. **EvidenceRecord** - Single piece of observed evidence
   - Tracks type (observation, deduction, suspicion, contradiction)
   - Confidence score (0-100%) - how certain observer is
   - Strength score (0-100%) - how impactful evidence should be
   - Manipulable flag - can this evidence be faked?
   - Suspicion delta - +/- adjustment to suspicion score

2. **PlayerCaseFile** - All evidence about one player
   - Auto-calculates suggested suspicion (75% confidence = 75 points)
   - Suggests alignment (town/mafia/unknown) based on evidence
   - Provides top N most suspicious evidence (prevents overload)
   - Generates prompt summaries (disclaimer: agents can disagree!)

3. **EvidenceManager** - All evidence for one agent
   - Personal biases (trustsLateVoters, skepticalOfRoleClaims, etc.)
   - Auto-generates evidence from game events based on persona traits
   - Gets most suspicious player (suggestion, not command)
   - Generates comprehensive prompt summaries

4. **SuspectMeter** - Scoring algorithm with 10 configurable rules
   - Voting patterns (late vote, vote switch, bandwagon, self-preservation)
   - Behavioral analysis (aggression, consistency)
   - Information-based (sheriff confirmation, doctor patterns)
   - Meta factors (death, survival, early mafia votes)

### Evidence Philosophy (FUN & FLEXIBLE)

**Key Design Principles**:

- ✅ **Evidence is SUGGESTION, not absolute truth** - agents can override
- ✅ **Agents can RATIONALIZE suspicious behavior**
- ✅ **Gaslighting IS supported** (manipulable flag on evidence)
- ✅ **Evidence can be CHALLENGED and DEBATED**
- ✅ **Personality affects what agents notice**
- ✅ **Confidence varies** (60-90%, not 100%)

**Prompt Summaries Include**:

- ⚠️ "IMPORTANT: The evidence and suggestions below are HINTS, not absolute truth"
- 💡 "You are free to: Dismiss weak evidence, Find contradictions, Provide alternative explanations"
- 🧠 "Remember: Good liars can fool anyone. This is a GUIDE, not a RULEBOOK!"

### Voting System Updated

- ✅ Players can **ABSTAIN** from voting if unsure
- ✅ Abstention triggers: "abstain", "not sure", "unsure", "skip" in SAY or THINK
- ✅ Tie handling with insufficient votes
- ✅ Role instructions updated to mention abstention option

---

## ✅ CRITICAL BUG FIXED

### ✅ USE THESE:

| Script                             | Purpose          | Status         |
| ---------------------------------- | ---------------- | -------------- |
| **`demo-game-correct-flow-v2.js`** | Main game engine | ✅ MAIN SCRIPT |
| `./mafia.sh`                       | CLI wrapper      | ✅ Use this    |
| `game-manager.js`                  | Save/load system | ✅ Working     |
| `saved-games/`                     | Game storage     | ✅ Active      |

### ❌ OLD/LEGACY (can be removed):

- `demo-game-correct-flow.js` - Old version
- `demo-game.js` - Broken/legacy
- `demo-game-split-pane.js` - Duplicate
- `demo-game-correct-flow.js` - Legacy

---

## 🚀 How to Play

### Quick Demo (One-off Game)

```bash
cd /config/workspace/mafia
node demo-game-correct-flow-v2.js
```

**Each run = completely new, independent game**

---

### Managed Games (Save/Resume)

```bash
# Create game
./mafia.sh new              # 10 players
./mafia.sh new 8            # 8 players

# List games
./mafia.sh list

# Continue later
./mafia.sh continue [gameId]
```

---

## 📖 Documentation

| Document                   | Purpose                   |
| -------------------------- | ------------------------- |
| `README.md`                | Main documentation        |
| `QUICK_REFERENCE.md`       | Command cheat sheet       |
| `GAME_MANAGEMENT.md`       | Detailed management guide |
| `ARCHITECTURE.md`          | System design & flow      |
| `IMPLEMENTATION_STATUS.md` | Current status            |

---

## 🎮 Game Flow (Corrected)

```
🌙 NIGHT PHASE
├── 😈 Mafia Chat (multiple messages, build consensus)
├── 💉 Doctor → Protects someone (no repeat)
├── 👮 Sheriff → Investigates (learns exact role)
├── 🔫 Vigilante → Shoots once (or passes)
└── 🌅 Resolution → Deaths revealed

☀️ DAY PHASE
├── 💬 Discussion (multiple messages)
├── 🗳️ Voting (lynch someone)
└── 🏆 Win check
```

---

## 🔒 Information Rules (Now Fixed!)

### What Each Role Knows

| Role      | Knows Mafia's Target? | Can See Private Chat? | Info Level  |
| --------- | --------------------- | --------------------- | ----------- |
| Mafia     | ❌ No                 | ✅ Yes (own team)     | Private     |
| Doctor    | ❌ No (FIXED!)        | ❌ No                 | Limited     |
| Sheriff   | ❌ No (FIXED!)        | ❌ No                 | Limited     |
| Vigilante | ❌ No (FIXED!)        | ❌ No                 | Limited     |
| Villager  | ❌ No                 | ❌ No                 | Public only |

---

## 📊 Test Results

```
✅ 22 FSM tests passing
✅ 13 Role tests passing
✅ 35 Provider tests passing
━━━━━━━━━━━━━━━━━━━━
✅ 70+ total tests passing
```

---

## 🚀 Next Steps

### 1. Consolidate Scripts (Optional)

```bash
# Remove old scripts
rm demo-game.js demo-game-correct-flow.js demo-game-split-pane.js

# Keep only main script
ls demo-game*.js
# Output: demo-game-correct-flow-v2.js
```

### 2. Build HTTP API (Coming Soon)

```typescript
// Planned API
POST /api/games          // Create game
GET  /api/games          // List games
GET  /api/games/:id      // Get state
POST /api/games/:id/action  // Take action
```

### 3. Add Pre-made Scenarios

```bash
# Future: Test specific situations
node run-scenario.js mafia-majority    # Mafia has advantage
node run-scenario.js town-advantage    # Town has advantage
node run-scenario.js edge-case         # Edge case test
```

---

## 🎯 User Guide

### For Players

1. **Run a game**:

   ```bash
   node demo-game-correct-flow-v2.js
   ```

2. **Watch the output**:
   - 🔒 ADMIN PANEL shows secret role assignments
   - 🌙 NIGHT PHASE shows private discussions
   - ☀️ DAY PHASE shows public debate
   - 📊 EVENT LOG shows complete history

3. **Understanding output**:
   ```
   🔒 THINK: [Private reasoning - admin only]
   📢 SAYS:  [Public statement - all players see]
   ```

### For Developers

1. **Add features** to `demo-game-correct-flow-v2.js`

2. **Add tests** to `packages/shared/src/__tests__/`

3. **Read specs** in `specs/` directory

4. **Run tests**:
   ```bash
   cd packages/shared
   npm test
   ```

---

## 🐛 Issues Fixed

| Issue                            | Status        | Fix                              |
| -------------------------------- | ------------- | -------------------------------- |
| Information leakage to Doctor    | ✅ Fixed      | Removed mafia target from prompt |
| Information leakage to Sheriff   | ✅ Fixed      | Removed mafia target from prompt |
| Information leakage to Vigilante | ✅ Fixed      | Removed mafia target from prompt |
| Variable scope (mafiaKillTarget) | ✅ Fixed      | Declared at class level          |
| Too many demo scripts            | ⚠️ Identified | Use v2 only                      |

---

## 📈 What Works

✅ Complete game flow (Night → Day → Win)  
✅ Mafia team discussion & consensus  
✅ Role abilities (Doctor, Sheriff, Vigilante)  
✅ Event sourcing with visibility levels  
✅ Save/load games  
✅ Unit tests (70+ passing)  
✅ Split-pane consciousness (THINK vs SAYS)  
✅ Multiple AI agents coordinating  
✅ Random role assignment  
✅ Win condition detection

---

## 🎉 Summary

**The Mafia AI Benchmark is fully functional!**

- ✅ **Bug Fixed**: Information leakage resolved
- ✅ **Tests Passing**: 70+ unit tests
- ✅ **Games Running**: Complete with all phases
- ✅ **Documentation**: Complete guides available
- ✅ **Save System**: Persistent games

**Main Script**: `node demo-game-correct-flow-v2.js`

---

_Last Updated: December 28, 2025_
_Status: ✅ PRODUCTION READY_
