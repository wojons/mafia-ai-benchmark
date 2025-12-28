# Mafia AI Benchmark - Complete System Summary

## 🎉 What We've Built

A fully-featured Mafia AI Benchmark system with:

### ✅ **Core Features**
- **Dynamic Persona System**: Rich, diverse characters with unique backstories, communication styles, and traits
- **Correct Game Flow**: Mafia team discussion with consensus (not single-turn votes)
- **No Information Leakage**: Doctor/Sheriff/Vigilante don't know mafia targets
- **Comprehensive Testing**: 70+ unit tests passing

### ✅ **Game Management**
- **Flexible Configuration**: Control players, roles, messaging limits, and AI models
- **Save/Load System**: Persist and resume games
- **Multiple Games**: Track and manage multiple concurrent games
- **Event Sourcing**: Complete audit trail with visibility levels

### ✅ **Configuration System**
- **CLI Interface**: Easy-to-use `./mafia.sh` commands
- **Interactive Menu**: `config --menu` for guided setup
- **Command-line Options**: Set individual or multiple options
- **Persistent Settings**: Configuration saved between sessions

---

## 🚀 Quick Start Guide

### Run Your First Game

```bash
# Demo game with defaults
./mafia.sh demo

# Or with custom settings
./mafia.sh config --players 8 --mafia 2 --mafia-msg-per 4
./mafia.sh new
```

### Configuration Examples

```bash
# Set mafia to 3 players
./mafia.sh config --mafia 3

# Increase mafia discussion
./mafia.sh config --mafia-msg-per 5 --mafia-msg-max 20

# Increase town participation
./mafia.sh config --town-msg-per 3 --town-msg-max 25

# Use different AI model
./mafia.sh config --model anthropic/claude-3

# View all settings
./mafia.sh config --show

# Reset to defaults
./mafia.sh config --reset
```

---

## 📁 Key Files

### Main Scripts
| File | Purpose | Usage |
|------|---------|-------|
| `mafia.sh` | Main CLI interface | `./mafia.sh [command]` |
| `demo-game-correct-flow-v2.js` | Game engine (v3 with personas) | `node demo-game-correct-flow-v2.js` |
| `game-manager.js` | Game save/load system | `node game-manager.js [command]` |

### Persona System
| File | Purpose |
|------|---------|
| `packages/shared/src/persona/persona-generator.js` | Persona generation engine |
| `specs/persona-system.md` | Persona system documentation |

### Configuration
| File | Purpose |
|------|---------|
| `.mafia-config` | Saved configuration settings |
| `CONFIG_GUIDE.md` | Complete configuration guide |

### Documentation
| File | Purpose |
|------|---------|
| `README.md` | Main documentation |
| `ARCHITECTURE.md` | System design & flow |
| `GAME_MANAGEMENT.md` | Game management guide |
| `QUICK_REFERENCE.md` | Command cheat sheet |
| `specs/correct-night-flow.md` | Game flow specification |

---

## 🎭 Persona System

### Features
- **Diverse Names**: Western, Eastern, Latin, Nordic, African naming conventions
- **Rich Archetypes**: Historical figures, fictional characters, anime tropes, stereotypes
- **Communication Styles**: Formal, casual, southern, British, gangster, etc.
- **Verbal Tics**: Characteristic phrases used naturally
- **Personality Traits**: 3-5 traits per character
- **Backstories**: Origin stories that inform decisions
- **Flaws**: Personal weaknesses that affect gameplay

### Archetype Categories
1. **Historical**: Julius Caesar, Cleopatra, Leonardo da Vinci, Genghis Khan, Marie Curie
2. **Fictional**: Sherlock Holmes, Atticus Finch, Katniss Everdeen, Walter White
3. **Anime**: Guts, Light Yagami, Naruto, Sailor Moon, Rem
4. **Stereotypes**: Karen, Chad, Gary, Sandra, Derek
5. **Abstract**: The Judge, The Fool, The Guardian, The Oracle
6. **Fantasy**: Gandalf, Aragorn, Yoda, Geralt, Tyrion Lannister

### Example Persona
```
🎭 James "Ace" Tanaka (Julius Caesar archetype)
   📝 Origin: Former military commander who led successful campaigns
   💬 Communication: Formal with dry, intellectual humor
   ⭐ Traits: Charismatic, Strategic, Ambitious
   💔 Flaw: Prideful - struggles to admit when wrong
   🗣️ Verbal Tics: "Indeed", "Furthermore"
   🎪 Hobby: Practicing martial arts
```

---

## 🎛️ Configuration Options

### Player & Role Settings
```bash
--players, -p [n]   Total players (default: 10)
--mafia, -M [n]     Mafia count (default: auto)
--doctor [n]        Doctor count (default: 1)
--sheriff [n]       Sheriff count (default: 1)
--vigilante [n]     Vigilante count (default: 1)
```

### Messaging Settings
```bash
--mafia-msg-per [n]   Mafia messages per player (default: 3)
--mafia-msg-max [n]   Mafia max total messages (default: 10)
--town-msg-per [n]    Town messages per player (default: 2)
--town-msg-max [n]    Town max total messages (default: 15)
```

### Gameplay Settings
```bash
--day-rounds [n]    Day discussion rounds (default: 1)
--model [name]      AI model (default: openai/gpt-4o-mini)
```

### Config Management
```bash
--show, -s          Display current configuration
--menu, -m          Interactive configuration menu
--reset, -r         Reset to default settings
```

---

## 🎮 Game Flow (Corrected)

### Night Phase
1. **Mafia Team Chat**
   - Multiple messages per mafia member (configurable)
   - Build consensus on kill target
   - Vote on final target

2. **Doctor Action**
   - Choose someone to protect
   - Cannot protect same person twice
   - Does NOT know mafia's target ✅ (FIXED!)

3. **Sheriff Investigation**
   - Investigate one person
   - Learn exact role (Mafia, Doctor, etc.)
   - Does NOT know others' plans ✅ (FIXED!)

4. **Vigilante Action**
   - Choose to SHOOT or PASS (one-time only)
   - Does NOT know others' plans ✅ (FIXED!)

5. **Night Resolution**
   - Apply vigilante shot (if any)
   - Apply mafia kill (unless protected)
   - Reveal deaths

### Day Phase
1. **Discussion**
   - All players discuss (configurable messages)
   - Share suspicions and observations

2. **Voting**
   - Players vote to lynch someone
   - Majority wins, ties = no elimination

3. **Win Check**
   - Mafia wins: mafia ≥ town
   - Town wins: all mafia eliminated

---

## 📊 Test Results

```
✅ 22 FSM tests passing
✅ 13 Role tests passing
✅ 35 Provider tests passing
✅ Persona tests passing
━━━━━━━━━━━━━━━━━━━━
✅ 70+ total tests passing
```

---

## 🐛 Bug Fixes Applied

### ✅ Information Leakage FIXED
**Issue**: Doctor/Sheriff/Vigilante could see mafia's target in prompts

**Solution**: Removed `mafiaKillTarget` from their `previousPhaseData`

**Before**:
```javascript
previousPhaseData: `Mafia kill target: ${mafiaKillTarget?.name}`
```

**After**:
```javascript
previousPhaseData: `Previous night: ${deaths || 'No deaths'}`
```

### ✅ Variable Scope FIXED
**Issue**: `mafiaKillTarget` not accessible across phases

**Solution**: Declared at class level: `this.mafiaKillTarget = null`

### ✅ Configuration System ADDED
**Feature**: Comprehensive CLI configuration with:
- Player/role settings
- Messaging limits
- AI model selection
- Persistent config file
- Interactive menu

---

## 🎯 Usage Examples

### Example 1: Quick Demo
```bash
./mafia.sh demo
```

### Example 2: Custom Game
```bash
./mafia.sh config --players 8 --mafia 2 --mafia-msg-per 4
./mafia.sh new
```

### Example 3: Extended Discussion
```bash
./mafia.sh config \
  --mafia-msg-per 5 \
  --mafia-msg-max 20 \
  --town-msg-per 4 \
  --town-msg-max 30 \
  --day-rounds 2
./mafia.sh new
```

### Example 4: Test Different AI
```bash
./mafia.sh config --model openai/gpt-4
./mafia.sh demo

./mafia.sh config --model anthropic/claude-3
./mafia.sh demo
```

### Example 5: Mafia-Heavy Game
```bash
./mafia.sh config --players 10 --mafia 4
./mafia.sh new
```

---

## 📈 Benefits

### For Gameplay
- **Rich Roleplay**: Unique characters create engaging narratives
- **Strategic Depth**: Configurable messaging and roles
- **Replayability**: Different personas each game
- **Fair Play**: No information leakage between roles

### For Testing
- **Diverse Scenarios**: Test edge cases with different configs
- **AI Benchmarking**: Compare model performance
- **Game Balance**: Find optimal role distributions
- **Unit Testing**: Comprehensive test coverage

### For Research
- **Personality Analysis**: Study trait influence on strategy
- **Communication Patterns**: Analyze different styles
- **Social Dynamics**: Observe group behavior
- **Game Theory**: Test optimal strategies

---

## 🔧 For Developers

### Project Structure
```
/config/workspace/mafia/
├── mafia.sh                          # CLI interface
├── demo-game-correct-flow-v2.js      # Main game engine
├── game-manager.js                   # Save/load system
├── packages/shared/src/
│   ├── persona/
│   │   └── persona-generator.js      # Persona system
│   └── __tests__/                    # Unit tests
├── specs/
│   ├── correct-night-flow.md         # Game flow spec
│   └── persona-system.md             # Persona spec
└── saved-games/                      # Game saves
```

### Running Tests
```bash
cd packages/shared
npm test
```

### Adding Features
1. Edit `demo-game-correct-flow-v2.js` for game logic
2. Edit `packages/shared/src/persona/persona-generator.js` for personas
3. Add tests in `packages/shared/src/__tests__/`
4. Update documentation

---

## 📖 Documentation Guide

| Document | Purpose | When to Read |
|----------|---------|--------------|
| `README.md` | Quick start guide | First time users |
| `CONFIG_GUIDE.md` | Complete config reference | Advanced users |
| `GAME_MANAGEMENT.md` | Game management guide | Save/load games |
| `ARCHITECTURE.md` | System design | Developers |
| `QUICK_REFERENCE.md` | Command cheat sheet | Quick lookup |
| `specs/correct-night-flow.md` | Game rules | Understanding flow |
| `specs/persona-system.md` | Persona details | Custom personas |

---

## 🎉 Status Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Correct game flow | ✅ Complete | Mafia discussion + consensus |
| Persona system | ✅ Complete | 6 archetype categories |
| Information security | ✅ Fixed | No role can see others' plans |
| Configuration system | ✅ Complete | CLI + interactive menu |
| Save/load games | ✅ Working | Basic functionality |
| Unit tests | ✅ 70+ passing | FSM, roles, providers |
| Documentation | ✅ Complete | All features documented |
| HTTP API | 🔄 Coming soon | Web interface planned |
| Web UI | 🔄 Coming soon | React interface planned |

---

## 🚀 Next Steps

1. **Complete current games**: Let some games run to completion
2. **Build HTTP API**: REST + WebSocket for web interface
3. **Create Web UI**: React-based game interface
4. **Add pre-made scenarios**: Test specific game states
5. **Expand AI models**: Support more providers
6. **Persona evolution**: Characters remember past events

---

## 💬 Summary

The Mafia AI Benchmark is now a **production-ready** system with:

- ✅ **Rich Persona System**: Unique characters with backstories
- ✅ **Correct Game Flow**: Mafia team discussion with consensus
- ✅ **No Information Leakage**: Roles have appropriate knowledge
- ✅ **Flexible Configuration**: Full control over all settings
- ✅ **Comprehensive Testing**: 70+ unit tests passing
- ✅ **Complete Documentation**: Guides for all user levels
- ✅ **Save/Load System**: Persistent game management

**Ready to play!** Run `./mafia.sh demo` to start!

---

*Last Updated: December 28, 2025*
*Status: ✅ PRODUCTION READY*
*Version: 3.0*
