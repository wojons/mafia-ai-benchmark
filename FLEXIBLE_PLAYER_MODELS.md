# Mafia AI Benchmark - Flexible Player Model Configuration

## 🎯 Overview

A **scalable, database-driven system** for assigning AI models to players that supports:
- Any number of players (1 to 1000+)
- Role-based assignments (all Mafia, all Town, etc.)
- Player-specific assignments (player 1, player 2, etc.)
- Bulk operations (ranges, patterns, groups)
- Preset configurations
- Save/load templates
- Database storage

---

## 🚀 Quick Start

### View Current Configuration
```bash
./mafia.sh config-players --show
```

### Set Models by Role
```bash
# Mafia gets GPT-4
./mafia.sh config-players --mafia-model openai/gpt-4

# Town gets Claude-3 Sonnet
./mafia.sh config-players --town-model anthropic/claude-3-sonnet-20240229

# Sheriff gets the strongest model
./mafia.sh config-players --sheriff-model anthropic/claude-3-opus-20240229
```

### Set Models for Specific Players
```bash
# Player 1 gets GPT-4
./mafia.sh config-players --player-model 1 openai/gpt-4

# Players 1-50 get GPT-4o-mini
./mafia.sh config-players --range-model 1 50 openai/gpt-4o-mini
```

### Use Presets
```bash
# GPT-4 vs Claude-3 battle
./mafia.sh config-players --preset gpt4VsClaude

# Varying strength by role
./mafia.sh config-players --preset varying

# Experimental (rotate models)
./mafia.sh config-players --preset experimental
```

---

## 📋 Command Reference

### View & Manage

| Command | Description |
|---------|-------------|
| `--show, -s` | Display current configuration |
| `--reset` | Reset to default settings |
| `--help, -h` | Show help |

### Role-Based Assignments

| Command | Description | Example |
|---------|-------------|---------|
| `--mafia-model [model]` | All Mafia members | `--mafia-model openai/gpt-4` |
| `--doctor-model [model]` | Doctor | `--doctor-model anthropic/claude-3` |
| `--sheriff-model [model]` | Sheriff | `--sheriff-model openai/gpt-4o` |
| `--vigilante-model [model]` | Vigilante | `--vigilante-model google/gemini-1.5-pro` |
| `--villager-model [model]` | All Villagers | `--villager-model openai/gpt-4o-mini` |
| `--town-model [model]` | All Town roles | `--town-model anthropic/claude-3-sonnet` |

### Player-Specific Assignments

| Command | Description | Example |
|---------|-------------|---------|
| `--player-model [n] [model]` | Specific player | `--player-model 1 openai/gpt-4` |
| `--range-model [s] [e] [model]` | Range of players | `--range-model 1 50 openai/gpt-4o-mini` |

### Presets

| Command | Description | Result |
|---------|-------------|--------|
| `--preset gpt4VsClaude` | GPT-4 vs Claude-3 | Mafia=GPT-4, Town=Claude-3 |
| `--preset varying` | By role strength | Different models per role |
| `--preset experimental` | Rotate models | Mix of 3 models |
| `--preset allGpt4` | All GPT-4 | All players use GPT-4 |
| `--preset allClaude` | All Claude-3 Opus | All players use Claude-3 Opus |

### Game Settings

| Command | Description | Example |
|---------|-------------|---------|
| `--total-players [n]` | Set player count | `--total-players 100` |
| `--save [file.json]` | Save config | `--save my-config.json` |
| `--load [file.json]` | Load config | `--load my-config.json` |

---

## 🎮 Usage Examples

### Example 1: GPT-4 vs Claude-3

```bash
# Set up the battle
./mafia.sh config-players --preset gpt4VsClaude
./mafia.sh config-players --show

# Create game
./mafia.sh new
```

**Result:**
- Mafia: OpenAI GPT-4
- Town (Doctor, Sheriff, Vigilante, Villagers): Anthropic Claude-3 Sonnet

---

### Example 2: 100-Player Game

```bash
# Set total players
./mafia.sh config-players --total-players 100

# Mafia team gets strong models
./mafia.sh config-players --mafia-model anthropic/claude-3-opus-20240229

# Key town roles get good models
./mafia.sh config-players --sheriff-model openai/gpt-4
./mafia.sh config-players --doctor-model anthropic/claude-3-sonnet-20240229

# Rest of town gets cheaper model
./mafia.sh config-players --villager-model openai/gpt-4o-mini

# Create game
./mafia.sh new
```

**Result:**
- 25 Mafia: Claude-3 Opus (strongest)
- 1 Sheriff: GPT-4
- 1 Doctor: Claude-3 Sonnet
- 1 Vigilante: GPT-4o-mini
- 72 Villagers: GPT-4o-mini

---

### Example 3: Specific Player Models (10 players)

```bash
# Assign different models to different players
./mafia.sh config-players --player-model 1 openai/gpt-4
./mafia.sh config-players --player-model 2 anthropic/claude-3-opus
./mafia.sh config-players --player-model 3 google/gemini-1.5-pro
./mafia.sh config-players --player-model 4 openai/gpt-4o
./mafia.sh config-players --player-model 5 anthropic/claude-3-sonnet
./mafia.sh config-players --player-model 6 openai/gpt-4o-mini
./mafia.sh config-players --player-model 7 anthropic/claude-3-haiku
./mafia.sh config-players --player-model 8 google/gemini-1.5-flash
./mafia.sh config-players --player-model 9 openai/gpt-4
./mafia.sh config-players --player-model 10 anthropic/claude-3-opus

./mafia.sh new
```

---

### Example 4: Bulk Range Assignment

```bash
# 1000-player game with GPT-4o-mini for most
./mafia.sh config-players --total-players 1000

# First 100 players get stronger models (maybe they joined early?)
./mafia.sh config-players --range-model 1 100 openai/gpt-4

# Rest get standard model
./mafia.sh config-players --town-model openai/gpt-4o-mini

./mafia.sh new
```

---

### Example 5: Pattern Assignment

```bash
# 100 players - even indices get GPT-4, odd get Claude-3
./mafia.sh config-players --total-players 100

# This requires custom script for patterns
cat > /tmp/pattern-config.sh << 'EOF'
#!/bin/bash
for i in {1..100}; do
  if [ $((i % 2)) -eq 0 ]; then
    ./mafia.sh config-players --player-model $i openai/gpt-4
  else
    ./mafia.sh config-players --player-model $i anthropic/claude-3-sonnet
  fi
done
EOF
bash /tmp/pattern-config.sh

./mafia.sh new
```

---

## 💾 Database Storage

Player model assignments are stored in the database:

### Table: `player_model_assignments`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique identifier |
| `game_id` | TEXT | Reference to game |
| `player_id` | TEXT | Specific player or NULL |
| `player_name` | TEXT | Human-readable name |
| `role` | TEXT | Role or NULL |
| `player_index` | INTEGER | 1-based ordering |
| `provider` | TEXT | AI provider |
| `model` | TEXT | AI model |
| `temperature` | REAL | Model temperature |
| `max_tokens` | INTEGER | Max tokens |
| `priority` | INTEGER | Assignment priority |

### Table: `bulk_model_assignments`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique identifier |
| `game_id` | TEXT | Reference to game |
| `assignment_type` | TEXT | 'role', 'team', 'range', 'pattern' |
| `assignment_value` | TEXT | e.g., 'MAFIA', '1-50', 'even' |
| `provider` | TEXT | AI provider |
| `model` | TEXT | AI model |
| `temperature` | REAL | Model temperature |
| `max_tokens` | INTEGER | Max tokens |

### Table: `player_config_templates`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique identifier |
| `name` | TEXT | Template name (unique) |
| `description` | TEXT | Template description |
| `config` | TEXT | JSON configuration |
| `is_default` | INTEGER | Is default template |

---

## 🎯 Priority System

The system uses a priority system to resolve conflicts:

1. **Player-specific assignments** (highest priority)
2. **Role-based assignments**
3. **Bulk/pattern assignments**
4. **Default model** (lowest priority)

Example:
```bash
# Default: GPT-4o-mini
./mafia.sh config-players --default-model openai/gpt-4o-mini

# Role: Mafia gets Claude-3
./mafia.sh config-players --mafia-model anthropic/claude-3-opus

# Player 1: Mafia gets GPT-4 (override)
./mafia.sh config-players --player-model 1 openai/gpt-4

# Result:
# - Player 1 (if Mafia): GPT-4 (player override)
# - Other Mafia: Claude-3 (role assignment)
# - Town: GPT-4o-mini (default)
```

---

## 📁 Save/Load Templates

### Save Configuration
```bash
./mafia.sh config-players --preset gpt4VsClaude
./mafia.sh config-players --save my-game-config.json
```

### Load Configuration
```bash
./mafia.sh config-players --load my-game-config.json
./mafia.sh new
```

### Share Configuration
```bash
# Send the config file to another user
scp my-game-config.json user@server:/path/

# They load and use it
./mafia.sh config-players --load my-game-config.json
./mafia.sh new
```

---

## 🔧 Integration with Game Manager

The player configuration is automatically passed to the game:

```bash
./mafia.sh config-players --preset gpt4VsClaude
./mafia.sh new 10

# Game manager reads:
# - Player model assignments from database
# - Role-based assignments
# - Generates AI configurations
# - Creates players with correct models
```

---

## 🎓 Research Use Cases

### 1. Model Comparison
```bash
# Test GPT-4 vs Claude-3
./mafia.sh config-players --preset gpt4VsClaude
./mafia.sh new > gpt4_vs_claude.log

# Test different distribution
./mafia.sh config-players --preset varying
./mafia.sh new > varying_models.log
```

### 2. Role Performance Analysis
```bash
# Strong Sheriff
./mafia.sh config-players --sheriff-model openai/gpt-4
./mafia.sh new

# Weak Sheriff
./mafia.sh config-players --sheriff-model openai/gpt-4o-mini
./mafia.sh new
```

### 3. Cost Optimization
```bash
# All cheap models
./mafia.sh config-players --preset allGpt4o-mini
./mafia.sh new

# Compare costs vs performance
```

### 4. Large-Scale Testing
```bash
# 1000 players with varying model assignments
./mafia.sh config-players --total-players 1000
./mafia.sh config-players --mafia-model anthropic/claude-3-opus
./mafia.sh config-players --range-model 2 100 anthropic/claude-3-sonnet
./mafia.sh config-players --range-model 51 1000 openai/gpt-4o-mini
./mafia.sh new
```

---

## 📊 Available Models

### OpenAI
| Model | Command | Speed | Cost |
|-------|---------|-------|------|
| GPT-4o-mini | `openai/gpt-4o-mini` | Fast | Low |
| GPT-4o | `openai/gpt-4o` | Medium | Medium |
| GPT-4 | `openai/gpt-4` | Slow | High |

### Anthropic
| Model | Command | Speed | Cost |
|-------|---------|-------|------|
| Claude 3 Haiku | `anthropic/claude-3-haiku-20240307` | Fast | Low |
| Claude 3 Sonnet | `anthropic/claude-3-sonnet-20240229` | Medium | Medium |
| Claude 3 Opus | `anthropic/claude-3-opus-20240229` | Slow | High |

### Google
| Model | Command | Speed | Cost |
|-------|---------|-------|------|
| Gemini 1.5 Flash | `google/gemini-1.5-flash` | Fast | Low |
| Gemini 1.5 Pro | `google/gemini-1.5-pro` | Medium | Medium |

---

## 🎯 Best Practices

1. **Start Simple**: Use `--preset` commands first
2. **Test Incrementally**: Change one thing at a time
3. **Save Configs**: Save interesting configurations
4. **Track Results**: Log game outputs for comparison
5. **Consider Cost**: Strong models are expensive!
6. **Consider Speed**: Fast models = quicker testing

---

## 📖 Related Documentation

- **Main Config**: `CONFIG_GUIDE.md`
- **Persona System**: `specs/persona-system.md`
- **Game Flow**: `specs/correct-night-flow.md`
- **API Documentation**: `specs/api-specs.md`

---

*Last Updated: December 28, 2025*
*Feature: Flexible Player Model Configuration v1.0*
