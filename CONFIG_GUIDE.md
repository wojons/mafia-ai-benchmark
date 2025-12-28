# 🎮 Mafia AI Benchmark - Complete Configuration Guide

## Overview

The Mafia AI Benchmark now features a comprehensive configuration system that gives you full control over every aspect of the game. From player counts to messaging limits to AI models, you can customize the experience to your exact specifications.

---

## 🎯 Quick Start

### Basic Commands

```bash
# Run a demo game with defaults
./mafia.sh demo

# Create a game with custom configuration
./mafia.sh new

# View current configuration
./mafia.sh config --show

# Reset to defaults
./mafia.sh config --reset
```

---

## 🎛️ Configuration Options

### 👥 Player & Role Settings

| Option | Short | Description | Default | Example |
|--------|-------|-------------|---------|---------|
| `--players` | `-p` | Total players in game | 10 | `--players 8` |
| `--mafia` | `-M` | Number of mafia members | auto (floor(n/4)) | `--mafia 3` |
| `--doctor` | | Number of doctors | 1 | `--doctor 2` |
| `--sheriff` | | Number of sheriffs | 1 | `--sheriff 0` |
| `--vigilante` | | Number of vigilantes | 1 | `--vigilante 0` |

**Role Distribution Examples:**

```bash
# 6 players: 1 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 2 Villagers
./mafia.sh config --players 6 && ./mafia.sh new

# 8 players: 2 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 3 Villagers
./mafia.sh config --players 8 && ./mafia.sh new

# 10 players: 2 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 5 Villagers
./mafia.sh config --players 10 && ./mafia.sh new

# 12 players: 3 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 6 Villagers
./mafia.sh config --players 12 && ./mafia.sh new

# Custom: 3 Mafia in 10-player game
./mafia.sh config --players 10 --mafia 3 && ./mafia.sh new
```

---

### 💬 Messaging Settings

| Option | Description | Default | Example |
|--------|-------------|---------|---------|
| `--mafia-msg-per` | Messages each mafia member can send | 3 | `--mafia-msg-per 4` |
| `--mafia-msg-max` | Maximum total mafia messages | 10 | `--mafia-msg-max 15` |
| `--town-msg-per` | Messages each town member can send | 2 | `--town-msg-per 3` |
| `--town-msg-max` | Maximum total town messages | 15 | `--town-msg-max 20` |

**Messaging Examples:**

```bash
# Extended mafia discussion (5 messages each, max 20 total)
./mafia.sh config --mafia-msg-per 5 --mafia-msg-max 20

# Active town debate (3 messages each, max 25 total)
./mafia.sh config --town-msg-per 3 --town-msg-max 25

# Both: High-engagement game
./mafia.sh config --mafia-msg-per 5 --mafia-msg-max 20 --town-msg-per 4 --town-msg-max 30
```

**How Messaging Works:**

```
MAFIA TEAM CHAT:
├── Each mafia member can send up to --mafia-msg-per messages
├── Discussion continues until:
│   ├── All mafia exhausted their messages, OR
│   ├── Total messages reach --mafia-msg-max, OR
│   └── Mafia reach consensus early
└── Then: Mafia vote on kill target

DAY DISCUSSION:
├── Each town member can send up to --town-msg-per messages
├── Discussion continues until:
│   ├── All members exhausted messages, OR
│   └── Total messages reach --town-msg-max
└── Then: Voting phase begins
```

---

### 🎮 Gameplay Settings

| Option | Description | Default | Example |
|--------|-------------|---------|---------|
| `--day-rounds` | Number of day discussion rounds | 1 | `--day-rounds 2` |
| `--model` | AI model to use | openai/gpt-4o-mini | `--model claude-3` |

**Gameplay Examples:**

```bash
# Two day rounds per cycle (extended discussion)
./mafia.sh config --day-rounds 2

# Different AI model
./mafia.sh config --model anthropic/claude-3

# Custom game
./mafia.sh config --day-rounds 2 --model openai/gpt-4o
```

---

## 📖 Complete Configuration Examples

### Example 1: Standard Game

```bash
./mafia.sh config \
  --players 10 \
  --mafia 2 \
  --mafia-msg-per 3 \
  --town-msg-per 2 \
  --day-rounds 1
```

**Result:**
- 10 players (2 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 5 Villagers)
- Mafia: 3 messages each, max 10 total
- Town: 2 messages each, max 15 total
- 1 day round

---

### Example 2: Mafia-Heavy Game

```bash
./mafia.sh config \
  --players 10 \
  --mafia 4 \
  --mafia-msg-per 4 \
  --mafia-msg-max 25 \
  --town-msg-per 3 \
  --town-msg-max 20
```

**Result:**
- 10 players with 4 Mafia (challenging!)
- Mafia: 4 messages each, max 25 total (lots of coordination)
- Town: 3 messages each, max 20 total (active debate)
- Mafia has 40% of players (very difficult for town)

---

### Example 3: Quick Game

```bash
./mafia.sh config \
  --players 6 \
  --mafia 1 \
  --mafia-msg-per 2 \
  --mafia-msg-max 4 \
  --town-msg-per 1 \
  --town-msg-max 5 \
  --day-rounds 1
```

**Result:**
- 6 players (1 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilager, 2 Villagers)
- Mafia: 2 messages each, max 4 total
- Town: 1 message each, max 5 total
- Fast-paced game

---

### Example 4: Extended Strategy Game

```bash
./mafia.sh config \
  --players 12 \
  --mafia 3 \
  --mafia-msg-per 5 \
  --mafia-msg-max 30 \
  --town-msg-per 4 \
  --town-msg-max 40 \
  --day-rounds 2
```

**Result:**
- 12 players (3 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 6 Villagers)
- Mafia: 5 messages each, max 30 total (extensive coordination)
- Town: 4 messages each, max 40 total (vigorous debate)
- 2 day rounds (more discussion before voting)
- Long, strategic game

---

### Example 5: AI Model Testing

```bash
# Test with GPT-4
./mafia.sh config --model openai/gpt-4

# Test with Claude
./mafia.sh config --model anthropic/claude-3-opus-20240229

# Test with different models, same game settings
./mafia.sh config --mafia 2 --town-msg-per 2 --model openai/gpt-4o-mini
```

---

## 🔧 Interactive Configuration

For an interactive menu-driven approach:

```bash
./mafia.sh config --menu
```

This will prompt you for each setting individually:

```
🎛️  MAFIA GAME CONFIGURATION MENU
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current values shown in brackets []
Press Enter to keep current value

👥 Total Players [10]: 
😈 Mafia Count [auto]: 
💉 Doctor Count [1]: 
👮 Sheriff Count [1]: 
🔫 Vigilante Count [1]: 

💬 MESSAGING SETTINGS
   Mafia Messages/Player [3]: 
   Mafia Max Messages Total [10]: 
   Town Messages/Player [2]: 
   Town Max Messages Total [15]: 
...
```

---

## 📂 Configuration File

Settings are saved to `~/.mafia-config` (or `/config/workspace/mafia/.mafia-config`):

```bash
# View current config file
cat /config/workspace/mafia/.mafia-config

# Output:
PLAYERS=10
MAFIA_COUNT=2
DOCTOR_COUNT=1
SHERIFF_COUNT=1
VIGILANTE_COUNT=1
MAFIA_MESSAGES_PER_PLAYER=3
MAFIA_MAX_MESSAGES=10
TOWN_MESSAGES_PER_PLAYER=2
TOWN_MAX_MESSAGES=15
DAY_DISCUSSION_ROUNDS=1
VOTING_ENABLED=true
NIGHT_PHASE_ENABLED=true
PERSONA_ENABLED=true
AI_MODEL=openai/gpt-4o-mini
API_KEY=auto
```

---

## 🎮 Pre-Set Configurations

### Quick Game (6 players, minimal discussion)
```bash
./mafia.sh config --players 6 --mafia 1 --mafia-msg-per 2 --town-msg-per 1
```

### Standard Game (10 players, balanced)
```bash
./mafia.sh config --players 10 --mafia 2 --mafia-msg-per 3 --town-msg-per 2
```

### Championship Game (12 players, extended)
```bash
./mafia.sh config --players 12 --mafia 3 --mafia-msg-per 4 --town-msg-per 3 --day-rounds 2
```

### Mafia Advantage (High mafia count)
```bash
./mafia.sh config --players 10 --mafia 4 --mafia-msg-per 5
```

### Town Advantage (High town participation)
```bash
./mafia.sh config --players 10 --mafia 2 --mafia-msg-per 2 --town-msg-per 4
```

---

## 🎭 Persona System

The persona system is enabled by default. To disable:

```bash
# Not yet implemented in config, coming soon!
# ./mafia.sh config --personas false
```

**With Personas:**
- Each player gets a unique name and backstory
- Communication style varies by archetype
- Personas influence AI responses
- More engaging roleplay experience

**Without Personas:**
- Simple numbered players (Player 1, Player 2, etc.)
- Generic communication
- Faster gameplay
- Pure strategy focus

---

## 🤖 AI Models

Available AI models (requires API keys):

| Model | Provider | Command |
|-------|----------|---------|
| GPT-4o-mini | OpenAI | `--model openai/gpt-4o-mini` |
| GPT-4o | OpenAI | `--model openai/gpt-4o` |
| GPT-4 | OpenAI | `--model openai/gpt-4` |
| Claude 3 Opus | Anthropic | `--model anthropic/claude-3-opus-20240229` |
| Claude 3 Sonnet | Anthropic | `--model anthropic/claude-3-sonnet-20240229` |
| Gemini Pro | Google | `--model google/gemini-pro` |

---

## 🧪 Testing Different Configurations

### Test 1: Compare Messaging Limits

```bash
# Test with low messaging
./mafia.sh config --mafia-msg-per 1 --town-msg-per 1
./mafia.sh demo

# Reset and test with high messaging
./mafia.sh config --reset
./mafia.sh config --mafia-msg-per 5 --town-msg-per 4
./mafia.sh demo
```

### Test 2: Compare Role Distributions

```bash
# Standard 10-player
./mafia.sh config --players 10 --mafia 2
./mafia.sh demo

# Mafia-heavy
./mafia.sh config --players 10 --mafia 4
./mafia.sh demo

# Town-heavy
./mafia.sh config --players 10 --mafia 1
./mafia.sh demo
```

### Test 3: Compare AI Models

```bash
# GPT-4o-mini (fast, cheap)
./mafia.sh config --model openai/gpt-4o-mini
./mafia.sh demo

# GPT-4 (slower, smarter)
./mafia.sh config --model openai/gpt-4
./mafia.sh demo
```

---

## 📋 Command Reference

### Game Management

| Command | Description |
|---------|-------------|
| `./mafia.sh new` | Create new game with current config |
| `./mafia.sh demo` | Run one-off demo game |
| `./mafia.sh list` | List all saved games |
| `./mafia.sh continue [id]` | Resume a saved game |
| `./mafia.sh delete [id]` | Delete a saved game |

### Configuration

| Command | Description |
|---------|-------------|
| `./mafia.sh config --show` | View current settings |
| `./mafia.sh config --menu` | Interactive configuration menu |
| `./mafia.sh config --reset` | Reset to defaults |
| `./mafia.sh config [OPTIONS]` | Set multiple options at once |

### Options

| Option | Description |
|--------|-------------|
| `--players, -p [n]` | Set total players |
| `--mafia, -M [n]` | Set mafia count |
| `--mafia-msg-per [n]` | Set mafia messages per player |
| `--mafia-msg-max [n]` | Set mafia max total messages |
| `--town-msg-per [n]` | Set town messages per player |
| `--town-msg-max [n]` | Set town max total messages |
| `--doctor [n]` | Set doctor count |
| `--sheriff [n]` | Set sheriff count |
| `--vigilante [n]` | Set vigilante count |
| `--day-rounds [n]` | Set day discussion rounds |
| `--model [name]` | Set AI model |

---

## 💡 Tips & Best Practices

1. **Start with defaults**: Run a few games with default settings first
2. **Adjust messaging**: Increase messages for more strategic depth
3. **Test different role distributions**: See how game balance changes
4. **Compare AI models**: Some models play better than others
5. **Document your experiments**: Keep notes on what works best

---

## 🔜 Future Enhancements

Planned configuration options:
- `--personas` - Enable/disable persona system
- `--debug` - Show AI reasoning in output
- `--speed` - Control game speed (fast/normal/slow)
- `--output` - Save game to file
- `--seed` - Set random seed for reproducible games
- `--teams` - Custom team compositions
- `--roles` - Enable/disable specific roles
- `--timer` - Add time limits to phases

---

*Last Updated: December 28, 2025*
*Version: 3.0*
