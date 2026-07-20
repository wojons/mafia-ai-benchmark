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
- **🧪 286 Tests**: Comprehensive test coverage

## 🚀 Quick Start

**New here?** Start with **[QUICK_START.md](QUICK_START.md)** - 5 minute setup guide!

### TL;DR - Get Running Now

```bash
cd mafia-ai-benchmark

# 1. Install dependencies
pnpm install

# 2. Add your API key to .env (required!)
nano .env
# OPENAI_API_KEY=sk-or-v1-YOUR-KEY-HERE

# 3. Build all packages
pnpm build

# 4. Start the server
pnpm --filter @mafia/server dev

# 5. In another terminal, run a benchmark
pnpm --filter @mafia/cli benchmark
```

### What You'll See

```
🎮 Mafia AI Benchmark - Monorepo Edition
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
pnpm --filter @mafia/cli config --players 10 --mafia 3 --mafia-msg-per 4 --town-msg-per 3 --day-rounds 2
pnpm --filter @mafia/cli game:run
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

## 📁 Commands Guide

### CLI Commands (via `mafiactl`)

| Command | Purpose | When to Use |
| --- | --- | --- |
| `pnpm --filter @mafia/cli game:run` | **Run a game** | Playing Mafia with AI agents |
| `pnpm --filter @mafia/cli benchmark` | **Run benchmark** | Automated model evaluation |
| `pnpm --filter @mafia/cli stats` | **View stats** | Game and model statistics |
| `pnpm --filter @mafia/cli list-games` | **List games** | Browse recent games |
| `pnpm --filter @mafia/cli config show` | **View config** | Check current settings |
| `pnpm --filter @mafia/cli config set` | **Configure** | Customize game params |

### Server Commands

| Command | Purpose | When to Use |
| --- | --- | --- |
| `pnpm --filter @mafia/server dev` | **Start server** | Run REST API + WebSocket |
| `pnpm --filter @mafia/server test:run` | **Run tests** | Verify server tests (39) |

### Root Commands

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (4/4)
pnpm --filter @mafia/server test:run    # Server tests (39)
pnpm --filter @mafia/shared test:run    # Shared tests (150)
pnpm --filter @mafia/web test:run       # Web tests (2)
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
mafia-ai-benchmark/
├── apps/
│   ├── server/                  ✅ HTTP/WebSocket server + game engine
│   ├── cli/                     ✅ TypeScript CLI (mafiactl)
│   └── web/                     ✅ React frontend
├── packages/shared/             ✅ Shared types, FSM, roles, personas
│   ├── src/
│   │   ├── fsm/                 ✅ Game state machine
│   │   ├── roles/               ✅ Role definitions
│   │   ├── events/              ✅ Event definitions
│   │   ├── providers/           ✅ AI provider configs
│   │   └── persona/             ✅ Persona generation
│   └── __tests__/               ✅ 286 tests
├── specs/                       ✅ Technical specifications
├── pnpm-workspace.yaml          ✅ Monorepo workspace config
├── turbo.json                   ✅ Build pipeline config
└── .env                         ✅ API keys (create from .env.sample)
```

### Running Tests

```bash
# All tests from root
pnpm --filter @mafia/server test:run   # Server (39 tests)
pnpm --filter @mafia/shared test:run   # Shared (150 tests)
pnpm --filter @mafia/web test:run      # Web (2 tests)
```

**Test Coverage**: 286 tests (Shared 150, Server 114, CLI 20, Web 2)

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

- **Pre-made Scenarios** - Test specific game states
- **Persona Memory** - Characters remember past events
- **Multiple AI Providers** - Claude, Gemini, Groq, etc.

## 📝 Notes

- **Use `pnpm --filter @mafia/cli game:run`** to run games
- Games persist between sessions in the server database
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

**Status**: ✅ Production Ready | ✅ Fully Documented | ✅ 286 Tests (277 pass, 9 integration require server)

**Quick Start**: See [QUICK_START.md](QUICK_START.md) for 5-minute setup guide!

Built with ❤️ for AI research and game theory exploration
