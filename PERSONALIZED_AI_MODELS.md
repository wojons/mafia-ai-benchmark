# Mafia AI Benchmark - Per-Player Model Configuration Guide

## Overview

You can now control which AI model is used for each player in the game! This allows for:
- **Model vs Model**: Compare how different models play
- **Role-specific models**: Assign stronger models to critical roles
- **Experimentation**: Test AI strategies across different providers

## 🎯 Quick Start

### View Available Models
```bash
./mafia.sh models
```

### Assign Models to Players

#### Option 1: By Role (All players of same role get same model)
```bash
./mafia.sh config --mafia-model openai/gpt-4 \
                  --town-model anthropic/claude-3 \
                  --special-model openai/gpt-4o-mini
./mafia.sh new
```

#### Option 2: By Specific Player (Each player gets specific model)
```bash
./mafia.sh config --player1-model openai/gpt-4 \
                  --player2-model anthropic/claude-3 \
                  --player3-model google/gemini-pro
./mafia.sh new 3
```

#### Option 3: Mixed (Default for most, specific for some)
```bash
./mafia.sh config --default-model openai/gpt-4o-mini \
                  --mafia-model openai/gpt-4 \
                  --player1-model anthropic/claude-3
./mafia.sh new
```

---

## 📋 Configuration Options

### By Role

| Option | Description | Default |
|--------|-------------|---------|
| `--mafia-model [model]` | AI model for all Mafia members | `default-model` |
| `--doctor-model [model]` | AI model for Doctor | `default-model` |
| `--sheriff-model [model]` | AI model for Sheriff | `default-model` |
| `--vigilante-model [model]` | AI model for Vigilante | `default-model` |
| `--villager-model [model]` | AI model for Villagers | `default-model` |

### By Player Number

| Option | Description | Default |
|--------|-------------|---------|
| `--player1-model [model]` | Model for player 1 | `default-model` |
| `--player2-model [model]` | Model for player 2 | `default-model` |
| `--player3-model [model]` | Model for player 3 | `default-model` |
| ... | ... | ... |
| `--player10-model [model]` | Model for player 10 | `default-model` |

### Default Settings

| Option | Description | Default |
|--------|-------------|---------|
| `--default-model [model]` | Default model for all players | `openai/gpt-4o-mini` |
| `--provider [name]` | Set provider for all players | `openai` |

---

## 🎮 Usage Examples

### Example 1: GPT-4 vs Claude-3 (Mafia vs Town)

```bash
# Mafia uses GPT-4, Town uses Claude-3
./mafia.sh config --mafia-model openai/gpt-4 \
                  --town-model anthropic/claude-3-sonnet-20240229
./mafia.sh new
```

**Result:**
- Mafia team (all): OpenAI GPT-4
- Town team (all): Anthropic Claude-3 Sonnet
- You can observe which model plays better!

---

### Example 2: Stronger Models for Special Roles

```bash
# Mafia gets Claude-3 Opus, Doctor gets GPT-4, Sheriff gets Claude-3 Sonnet
./mafia.sh config --mafia-model anthropic/claude-3-opus-20240229 \
                  --doctor-model openai/gpt-4 \
                  --sheriff-model anthropic/claude-3-sonnet-20240229
./mafia.sh new
```

**Result:**
- Mafia: Claude-3 Opus (strongest)
- Doctor: GPT-4 (very strong)
- Sheriff: Claude-3 Sonnet (strong)
- Villagers: GPT-4o-mini (default)

---

### Example 3: Specific Player Models (Small Game)

```bash
# 3-player game with all different models
./mafia.sh config --player1-model openai/gpt-4 \
                  --player2-model anthropic/claude-3 \
                  --player3-model google/gemini-pro
./mafia.sh new 3
```

**Result:**
- Player 1: GPT-4
- Player 2: Claude-3
- Player 3: Gemini Pro

---

### Example 4: Experiment Mode

```bash
# Run same game setup with different models
./mafia.sh config --default-model openai/gpt-4o-mini
./mafia.sh new > game_gpt4o-mini.log

./mafia.sh config --default-model openai/gpt-4
./mafia.sh new > game_gpt4.log

./mafia.sh config --default-model anthropic/claude-3
./mafia.sh new > game_claude3.log

# Compare results
diff game_gpt4o-mini.log game_gpt4.log
diff game_gpt4.log game_claude3.log
```

---

### Example 5: Model Comparison Tournament

```bash
#!/bin/bash
# Run multiple games with different models and track results

models=("openai/gpt-4o-mini" "openai/gpt-4" "anthropic/claude-3-sonnet-20240229")

for model in "${models[@]}"; do
    echo "Testing model: $model"
    ./mafia.sh config --default-model "$model"
    ./mafia.sh new > "results_${model//\//-}.log"
    echo "  → Results saved to results_${model//\//-}.log"
done

echo "All tests complete!"
```

---

## 🤖 Available Models

### OpenAI
| Model | Command | Speed | Intelligence |
|-------|---------|-------|--------------|
| GPT-4o-mini | `--model openai/gpt-4o-mini` | Fast | Good |
| GPT-4o | `--model openai/gpt-4o` | Medium | Better |
| GPT-4 | `--model openai/gpt-4` | Slow | Best |

### Anthropic
| Model | Command | Speed | Intelligence |
|-------|---------|-------|--------------|
| Claude 3 Haiku | `--model anthropic/claude-3-haiku-20240307` | Fast | Good |
| Claude 3 Sonnet | `--model anthropic/claude-3-sonnet-20240229` | Medium | Better |
| Claude 3 Opus | `--model anthropic/claude-3-opus-20240229` | Slow | Best |

### Google
| Model | Command | Speed | Intelligence |
|-------|---------|-------|--------------|
| Gemini 1.5 Flash | `--model google/gemini-1.5-flash` | Fast | Good |
| Gemini 1.5 Pro | `--model google/gemini-1.5-pro` | Medium | Better |

### Other Providers
| Provider | Command |
|----------|---------|
| Groq | `--model groq/llama2-70b-4096` |
| DeepSeek | `--model deepseek/deepseek-chat` |
| Meta | `--model meta-llama/llama-2-70b-chat` |
| Mistral | `--model mistral/mistral-large` |

---

## 📊 Model Configuration File

When you set model configurations, they're saved to `.mafia-config`:

```bash
# View current model settings
cat /config/workspace/mafia/.mafia-config

# Example output:
PLAYERS=10
MAFIA_COUNT=2
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=openai/gpt-4
DOCTOR_MODEL=openai/gpt-4o-mini
SHERIFF_MODEL=anthropic/claude-3-sonnet-20240229
VIGILANTE_MODEL=openai/gpt-4o-mini
VILLAGER_MODEL=openai/gpt-4o-mini
```

---

## 🎯 Advanced Configuration

### Per-Player + Per-Role Priority

The system uses this priority order:
1. **Player-specific** (`--player1-model`, etc.) - Highest priority
2. **Role-specific** (`--mafia-model`, etc.) - Medium priority
3. **Default** (`--default-model`) - Lowest priority

```bash
# Player 1 gets Claude, but if they're Mafia, they still get GPT-4
./mafia.sh config --player1-model anthropic/claude-3 \
                  --mafia-model openai/gpt-4 \
                  --default-model openai/gpt-4o-mini
./mafia.sh new 10

# If Player 1 is Mafia: Uses GPT-4 (role override)
# If Player 1 is Town: Uses Claude-3 (player override)
```

### Mixed Provider Setup

```bash
# Different providers for different roles
./mafia.sh config --mafia-model openai/gpt-4 \
                  --doctor-model anthropic/claude-3 \
                  --sheriff-model google/gemini-pro \
                  --default-model openai/gpt-4o-mini
./mafia.sh new
```

---

## 🧪 Research Experiments

### Experiment 1: Model Strength Comparison

```bash
# Run 10 games with each model and track win rates
for model in "openai/gpt-4o-mini" "openai/gpt-4" "anthropic/claude-3-sonnet-20240229"; do
    echo "Testing: $model"
    mafia_wins=0
    town_wins=0
    
    for i in {1..10}; do
        ./mafia.sh config --default-model "$model"
        result=$(./mafia.sh new 2>&1 | grep -o "MAFIA WINS\|TOWN WINS")
        if [[ "$result" == "MAFIA WINS" ]]; then
            ((mafia_wins++))
        else
            ((town_wins++))
        fi
    done
    
    echo "  $model: Mafia=$mafia_wins, Town=$town_wins"
done
```

### Experiment 2: Role Performance Analysis

```bash
# Does Claude play better as Sheriff than GPT-4?
./mafia.sh config --default-model openai/gpt-4o-mini \
                  --sheriff-model anthropic/claude-3
./mafia.sh new

# Compare with GPT-4 as Sheriff
./mafia.sh config --default-model openai/gpt-4o-mini \
                  --sheriff-model openai/gpt-4
./mafia.sh new
```

### Experiment 3: Meta-Strategy

```bash
# What if we assign our best model to the role that matters most?
# Hypothesis: Sheriff identification is most valuable
./mafia.sh config --default-model openai/gpt-4o-mini \
                  --sheriff-model openai/gpt-4 \
                  --mafia-model openai/gpt-4o-mini
./mafia.sh new

# vs. putting best model on Mafia
./mafia.sh config --default-model openai/gpt-4o-mini \
                  --mafia-model openai/gpt-4 \
                  --sheriff-model openai/gpt-4o-mini
./mafia.sh new
```

---

## 💡 Tips & Best Practices

1. **Start Simple**: Begin with `--default-model` to establish baseline
2. **Test Incrementally**: Change one model at a time
3. **Track Results**: Save logs to compare outcomes
4. **Consider Cost**: GPT-4 and Claude-3 Opus are expensive!
5. **Consider Speed**: Faster models = quicker testing
6. **Document Settings**: Save interesting configurations

---

## 🔧 Troubleshooting

### Invalid Model Name
```bash
# Error: Invalid model 'unknown/model'
./mafia.sh config --model unknown/model

# Fix: Use exact model names from provider
./mafia.sh models  # List available models
```

### Model Not Available
```bash
# Some models require specific API keys
# Set API key in environment or .env file
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Conflicting Settings
```bash
# If you set both --mafia-model and --player1-model
# And player 1 is Mafia, which wins?

# Answer: Role-specific takes precedence for that role
# But you can override specific players
./mafia.sh config --mafia-model openai/gpt-4 \
                  --player1-model anthropic/claude-3
# Player 1 (if Mafia): GPT-4 (role override)
# Player 1 (if Town): Claude-3 (player override)
```

---

## 📖 Related Documentation

- **Main Config**: `CONFIG_GUIDE.md`
- **Quick Reference**: `QUICK_REFERENCE.md`
- **Persona System**: `specs/persona-system.md`
- **Game Flow**: `specs/correct-night-flow.md`

---

*Last Updated: December 28, 2025*
*Feature: Per-Player Model Configuration v1.0*
