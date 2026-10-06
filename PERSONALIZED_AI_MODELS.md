# Mafia AI Benchmark — Per-Role Model Configuration Guide

Every command block in this guide was verified against the current `./mafia.sh`
wrapper and the live engine (game-engine.js `PlayerModelConfig` wiring).

## Overview

You can control which AI model plays each **role** in the game. This allows:
- **Model vs Model**: Compare how different models play against each other
- **Role-specific models**: Assign stronger models to critical roles
- **Experimentation**: Test AI strategies across different providers

Model ids use the `provider/model` form (e.g. `openai/gpt-4o-mini`).

## 🎯 Quick Start

### View the current model setup
```bash
./mafia.sh models
```

### Set the default model
```bash
./mafia.sh config --model openai/gpt-4o-mini
# → Setting llmModel = openai/gpt-4o-mini
# → ✓ Configuration updated — llmModel = "openai/gpt-4o-mini"

./mafia.sh config --show    # verify
./mafia.sh new              # play a game with it
```

### Give a role its own model
Role overrides live in `.env` (copy `.env.sample` for the full template):

```bash
# .env — leave a variable empty to inherit DEFAULT_MODEL
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=openai/gpt-4
DOCTOR_MODEL=
SHERIFF_MODEL=anthropic/claude-3-sonnet-20240229
VIGILANTE_MODEL=
VILLAGER_MODEL=
```

Then start the game as usual:
```bash
./mafia.sh new
```

---

## 📋 Configuration Options

### Default model

| Mechanism | How | Notes |
|-----------|-----|-------|
| Wrapper shorthand | `./mafia.sh config --model <provider/model>` | Writes `llmModel` to `mafia.config.json` (repo-local, gitignored) |
| Config key | `./mafia.sh config --set llmModel <provider/model>` | Same effect, generic form |
| Engine fallback | `DEFAULT_MODEL` in `.env` | Used when no config-file model is set |

### Per-role overrides (.env)

| Variable | Applies to |
|----------|-----------|
| `MAFIA_MODEL` | All Mafia members |
| `DOCTOR_MODEL` | Doctor |
| `SHERIFF_MODEL` | Sheriff |
| `VIGILANTE_MODEL` | Vigilante |
| `VILLAGER_MODEL` | All Villagers |

An **empty value inherits `DEFAULT_MODEL`**. Overrides are read by the engine
at game start (game-engine.js wires them into the player model config), and
the server's legacy adapter maps the same role names — including the
`TOWN → VILLAGER_MODEL` alias — so the two entry points agree.

### Per-game overrides (config.roleModels)

If you drive games through the server API or `mafiactl` config instead of
`.env`, pass a `roleModels` map in the game config:

```json
{ "roleModels": { "MAFIA": "openai/gpt-4", "SHERIFF": "anthropic/claude-3-sonnet-20240229" } }
```

The adapter sets exactly those `*_MODEL` variables in the engine child
environment for that game, and persists the assignment with the game record.
An empty value inherits `DEFAULT_MODEL`.

> Per-player-by-number assignment (player 1 gets X, player 2 gets Y) is **not**
> part of the current surface. The old per-player config tool
> (`mafia-players.sh`) targeted a scratch environment that no longer exists
> and is retained only as a dead legacy script — do not use it.

---

## 🎮 Usage Examples

### Example 1: GPT-4 vs Claude-3 (Mafia vs Town)

```bash
# .env
DEFAULT_MODEL=anthropic/claude-3-sonnet-20240229   # town inherits this
MAFIA_MODEL=openai/gpt-4

./mafia.sh new
```

**Result:** Mafia team plays GPT-4, Town team plays Claude-3 Sonnet.

### Example 2: Stronger Models for Special Roles

```bash
# .env
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=anthropic/claude-3-opus-20240229
DOCTOR_MODEL=openai/gpt-4
SHERIFF_MODEL=anthropic/claude-3-sonnet-20240229

./mafia.sh new
```

**Result:** Mafia = Claude-3 Opus (strongest), Doctor = GPT-4, Sheriff =
Claude-3 Sonnet, everyone else = GPT-4o-mini.

### Example 3: Experiment Mode

```bash
# Run the same setup with different models and compare
./mafia.sh config --model openai/gpt-4o-mini
./mafia.sh new > game_gpt4o-mini.log

./mafia.sh config --model openai/gpt-4
./mafia.sh new > game_gpt4.log

./mafia.sh config --model anthropic/claude-3-sonnet-20240229
./mafia.sh new > game_claude3.log

# Compare results
diff game_gpt4o-mini.log game_gpt4.log
```

### Example 4: Model Comparison Tournament

```bash
#!/bin/bash
# Run multiple games with different default models and track results

models=("openai/gpt-4o-mini" "openai/gpt-4" "anthropic/claude-3-sonnet-20240229")

for model in "${models[@]}"; do
    echo "Testing model: $model"
    ./mafia.sh config --model "$model"
    ./mafia.sh new > "results_${model//\//-}.log"
    echo "  → Results saved to results_${model//\//-}.log"
done

echo "All tests complete!"
```

---

## 🤖 Available Models

Model ids use the `provider/model` form. Common examples:

### OpenAI
| Model | Id |
|-------|-----|
| GPT-4o-mini | `openai/gpt-4o-mini` |
| GPT-4o | `openai/gpt-4o` |
| GPT-4 | `openai/gpt-4` |

### Anthropic
| Model | Id |
|-------|-----|
| Claude 3 Haiku | `anthropic/claude-3-haiku-20240307` |
| Claude 3 Sonnet | `anthropic/claude-3-sonnet-20240229` |
| Claude 3 Opus | `anthropic/claude-3-opus-20240229` |

### Google
| Model | Id |
|-------|-----|
| Gemini 1.5 Flash | `google/gemini-1.5-flash` |
| Gemini 1.5 Pro | `google/gemini-1.5-pro` |

Run `./mafia.sh models` at any time to see the configured setup. Model ids
that carry a provider prefix pass through verbatim to the engine (the
provider is derived from the first segment), so custom/OpenRouter-compatible
specs like `CUSTOM/openai/gpt-4o` also work.

---

## 💡 Tips & Best Practices

1. **Start simple**: establish a baseline with `./mafia.sh config --model <m>`
2. **Test incrementally**: change one role override at a time
3. **Track results**: save game logs and compare outcomes
4. **Consider cost**: GPT-4 and Claude-3 Opus are expensive
5. **Remember the inheritance rule**: empty `*_MODEL` → `DEFAULT_MODEL` →
   config-file `llmModel` → engine built-in `openai/gpt-4o-mini`

## 🔧 Troubleshooting

### Unknown config option
```bash
./mafia.sh config --mafia-model openai/gpt-4
# ❌ Unknown config option: --mafia-model
#    Use: --show | --reset | --set <k> <v> | --model <m> | --players <n> | --menu
```
Per-role models are configured via `.env` variables (see above) — the wrapper
has no per-role assignment flags. Use `--model` for the default model only.

### Model not available
```bash
# Some models require specific API keys — set them in the environment or .env
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Verify what the engine will use
```bash
./mafia.sh models    # shows default + which role overrides are declared
```

---

## 📖 Related Documentation

- **Main Config**: `CONFIG_GUIDE.md` (authoritative configuration reference)
- **Quick Reference**: `QUICK_REFERENCE.md`
- **Environment template**: `.env.sample`

---

*Last Updated: October 6, 2026*
*Rewritten against the live surface for DOC-8 (previously documented a
removed per-player config CLI; verified: every command here runs).*
