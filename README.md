# 🎮 Mafia AI Benchmark

An advanced AI-powered Mafia game simulation that benchmarks different AI models' ability to play the classic social deduction game. Features real-time game mechanics, role-based strategies, comprehensive event sourcing, and rich AI personas.

## ✨ Features

- **🤖 AI Agents**: Autonomous players powered by LLMs (GPT-4o-mini, Claude, etc.)
- **🎭 Dynamic Personas**: Unique characters with diverse backgrounds, communication styles, and personalities
- **🎛️ Full Configuration**: Control players, roles, messaging limits, AI models, and more
- **🎯 Correct Game Flow**: Mafia team discussion with consensus (not single-turn votes)
- **💬 Split-Pane Consciousness**: Private reasoning (THINK) vs public statements (SAYS)
- **🌙 Night Phase**: Mafia discussion, Doctor protection, Sheriff investigation, Vigilante action
- **☀️ Day Phase**: Discussion, voting, lynching
- **📊 Event Sourcing**: Complete game audit trail with visibility levels
- **💰 Cost Tracking**: Track API costs per game and player
- **🧪 409+ Tests**: Comprehensive test coverage

## 🚀 Quick Start

**New here?** Start with **[QUICK_START.md](QUICK_START.md)** - 5 minute setup guide!

### TL;DR - Get Running Now

```bash
cd /config/workspace/mafia

# 1. Add your API key to .env (required!)
nano .env
# OPENAI_API_KEY=sk-or-v1-YOUR-KEY-HERE

# 2. Run a demo game
node game-engine.js

# OR use the bash wrapper
./mafia.sh demo
```

### What You'll See

```
🎮 Mafia AI Benchmark - PERSONA EDITION v3
🔒 Generating personas...
  😈 Vincent Marino (MAFIA) - Traits: analytical, reserved, meticulous
  😈 Francesco 'Frankie' Moretti (MAFIA) - Traits: empathetic, determined
  💉 Vincent 'Vince' Romano (DOCTOR) - Traits: charismatic, trustworthy
  👮 Margaret 'Maggie' Sinclair (SHERIFF) - Traits: observant, friendly

🌙 NIGHT 1
😈 Mafia Chat: Real strategy discussion...
💉 Doctor: Protects someone...
👮 Sheriff: Investigates someone...

☀️ DAY 1
💬 Discussion and voting...
🏆 Mafia or Town wins!
```

## 📖 Documentation

| Document                                                       | Purpose                            |
| -------------------------------------------------------------- | ---------------------------------- |
| **[README.md](README.md)**                                     | This file - quick start & overview |
| **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)**                   | Command cheat sheet                |
| **[CONFIG_GUIDE.md](CONFIG_GUIDE.md)**                         | Complete configuration guide       |
| **[GAME_MANAGEMENT.md](GAME_MANAGEMENT.md)**                   | Detailed game management           |
| **[ARCHITECTURE.md](ARCHITECTURE.md)**                         | System architecture & design       |
| **[PROJECT_READY.md](PROJECT_READY.md)**                       | Complete system summary            |
| **[POSTER.md](POSTER.md)**                                     | Visual system overview             |
| **[specs/correct-night-flow.md](specs/correct-night-flow.md)** | Game flow specification            |
| **[specs/persona-system.md](specs/persona-system.md)**         | Persona system documentation       |

## 🎭 Persona System

Each AI agent now has a unique persona!

### Features

- **6 Archetype Categories**: Historical, Fictional, Anime, Stereotypes, Abstract, Fantasy
- **8 Communication Styles**: Formal, Casual, Southern, British, Gangster, Valley Girl, Southern Gentleman, Pirate
- **Diverse Names**: Western, Eastern, Latin, Nordic, African naming conventions
- **Rich Backstories**: Origin stories that inform decision-making
- **Personal Flaws**: Weaknesses that affect gameplay

### Example Persona

```
🎭 James "Ace" Tanaka (Julius Caesar archetype)
   📝 Origin: Former military commander who led successful campaigns
   💬 Communication: Formal with dry, intellectual humor
   ⭐ Traits: Charismatic, Strategic, Ambitious
   💔 Flaw: Prideful - struggles to admit when wrong
   🗣️ Verbal Tics: "Indeed", "Furthermore"
```

See **[specs/persona-system.md](specs/persona-system.md)** for complete documentation.

## 🎛️ Configuration System

Full control over every aspect of the game:

### Player & Role Settings

```bash
--players, -p [n]   Total players (default: 10)
--mafia, -M [n]     Mafia count (default: auto=floor(n/4))
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

### Management

```bash
--show, -s          Display current configuration
--menu, -m          Interactive configuration menu
--reset, -r         Reset to default settings
```

**Example:**

```bash
./mafia.sh config --players 10 --mafia 3 --mafia-msg-per 4 --town-msg-per 3 --day-rounds 2
./mafia.sh new
```

See **[CONFIG_GUIDE.md](CONFIG_GUIDE.md)** for complete documentation.

## 🎯 Game Flow (Corrected)

### Night Phase

1. **😈 Mafia Team Chat** - Mafia discuss (multiple messages each) and reach consensus
2. **💉 Doctor Action** - Doctor protects someone (can't repeat twice)
3. **👮 Sheriff Investigation** - Sheriff learns exact role of target
4. **🔫 Vigilante Action** - Vigilante can shoot once (or pass)
5. **🌅 Night Resolution** - Deaths revealed, game continues

### Day Phase

1. **💬 Discussion** - All players discuss (configurable messages)
2. **🗳️ Voting** - Players vote to lynch someone
3. **🏆 Win Check** - Mafia wins if ≥ town, Town wins if all mafia eliminated

See **[specs/correct-night-flow.md](specs/correct-night-flow.md)** for complete specification.

## 📁 Scripts Guide

### Main Scripts (Use These)

| Script                          | Purpose              | When to Use            |
| ------------------------------- | -------------------- | ---------------------- |
| `node game-engine.js`           | **Main game engine** | Running complete games |
| `./mafia.sh`                    | **CLI wrapper**      | Configuration, demos   |
| `./mafia.sh demo`               | Run one-off demo     | Quick test             |
| `./mafia.sh config --show`      | View settings        | Check current config   |
| `./mafia.sh config --players 8` | Configure            | Customize game         |

### Quick Commands

```bash
# Run game directly
node game-engine.js

# Run with options
node game-engine.js --players 8

# Run demo
./mafia.sh demo

# Configure and create
./mafia.sh config --players 8 --mafia 2
./mafia.sh new
```

### Configuration Commands

```bash
# View current settings
./mafia.sh config --show

# Interactive menu
./mafia.sh config --menu

# Set specific options
./mafia.sh config --mafia 3
./mafia.sh config --mafia-msg-per 4 --town-msg-per 3

# Reset to defaults
./mafia.sh config --reset
```

### Direct Node Scripts

```bash
# Run complete game
node demo-game-correct-flow-v2.js

# Game management
node game-manager.js new 10
node game-manager.js list
node game-manager.js delete [gameId]
```

## 🎭 Roles

| Role          | Ability                           | Win Condition        |
| ------------- | --------------------------------- | -------------------- |
| **Mafia**     | Kill one player each night        | Survive until ≥ town |
| **Doctor**    | Protect one player each night     | Town victory         |
| **Sheriff**   | Investigate exact role each night | Town victory         |
| **Vigilante** | Shoot one player once             | Town victory         |
| **Villager**  | Vote and discuss                  | Town victory         |

## 🔧 Development

### Project Structure

```
/config/workspace/mafia/
├── game-engine.js              ✅ Main game engine (runs games)
├── mafia.sh                    ✅ CLI wrapper script
├── cli.js                      ✅ CLI utilities
├── .env                        ✅ API keys (create from .env.sample)
├── .mafia-config               ✅ Persistent configuration
├── packages/shared/src/
│   ├── persona/
│   │   └── persona-generator.js    ✅ Persona generation
│   ├── fsm/                         ✅ Game state machine
│   ├── roles/                       ✅ Role definitions
│   ├── events/                      ✅ Event definitions
│   ├── providers/                   ✅ AI provider configs
│   └── __tests__/                   ✅ 409+ tests
├── specs/                           ✅ Technical specs
│   ├── correct-night-flow.md
│   ├── persona-system.md
│   └── [other specs]
├── apps/
│   ├── server/                      ✅ HTTP/WebSocket server
│   └── cli/                         ✅ TypeScript CLI (dev)
└── saved-games/                     ✅ Game saves
```

### Running Tests

```bash
cd packages/shared
npm test
```

**Test Coverage**: 409+ passing tests (FSM, Roles, Providers, Personas, Events, Types, Integration)

### Game Events

Each game action is stored as an event with visibility levels:

```json
{
  "gameId": "game-123",
  "round": 1,
  "phase": "NIGHT",
  "playerName": "James Tanaka",
  "personaArchetype": "Julius Caesar",
  "eventType": "MESSAGE",
  "visibility": "PRIVATE_MAFIA", // PUBLIC, PRIVATE_MAFIA, ADMIN_ONLY
  "content": {
    "think": "Private reasoning in character...",
    "says": "Public statement in character...",
    "personaTraits": ["Charismatic", "Strategic", "Ambitious"]
  }
}
```

## 🐛 Bug Fixes Applied

### ✅ Information Leakage Fixed

**Issue**: Doctor/Sheriff/Vigilante could see mafia's target in their prompts
**Fix**: Removed `mafiaKillTarget` from their `previousPhaseData`

### ✅ Variable Scope Fixed

**Issue**: `mafiaKillTarget` not accessible across phases
**Fix**: Declared at class level: `this.mafiaKillTarget = null`

### ✅ Configuration System Added

**Feature**: Comprehensive CLI configuration with 15+ options

- Player/role settings
- Messaging limits
- AI model selection
- Persistent config file
- Interactive menu

### ✅ Persona System Added

**Feature**: Rich, dynamic characters with:

- 6 archetype categories
- 8 communication styles
- Diverse naming conventions
- Personal backstories and flaws

## 🚀 Coming Soon

- **HTTP API Server** - REST + WebSocket for web interface
- **Web UI** - React-based game interface
- **Pre-made Scenarios** - Test specific game states
- **Persona Memory** - Characters remember past events
- **Multiple AI Providers** - Claude, Gemini, Groq, etc.

## 📝 Notes

- **Use `node game-engine.js`** to run games
- Games saved with `./mafia.sh new` persist between sessions
- AI models use GPT-4o-mini via OpenRouter (configurable via `--model`)
- Role assignments are random each game
- Personas are unique each game, generated by the LLM from personality descriptions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request

## 📄 License

MIT License - see LICENSE file

---

**Status**: ✅ Production Ready | ✅ Fully Documented | ✅ 409+ Tests Passing

**Quick Start**: See [QUICK_START.md](QUICK_START.md) for 5-minute setup guide!

Built with ❤️ for AI research and game theory exploration
