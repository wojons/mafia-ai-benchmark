# Mafia AI Benchmark — Flexible Role Model Configuration

> **Status (DOC-8, verified 2026-10-06):** the `config-players` command surface
> this guide previously taught does not exist in the current wrapper — it lived
> only in the dead legacy script `mafia-players.sh`, which still hardcodes a
> scratch environment (`/config/workspace/mafia`) that does not exist and whose
> per-player assignments have no reader in the current engine. Every command
> below was verified against the live `./mafia.sh` + engine instead.

## 🎯 Overview

Model assignment today supports:
- A **default model** for all players (`./mafia.sh config --model`, stored in
  the repo-local `mafia.config.json`)
- **Role-based overrides** via `.env` variables (`MAFIA_MODEL`,
  `DOCTOR_MODEL`, `SHERIFF_MODEL`, `VIGILANTE_MODEL`, `VILLAGER_MODEL`)
- **Per-game overrides** via a `roleModels` map in the game config (server
  API / `mafiactl`)
- Any model id in `provider/model` form; prefixed specs pass through verbatim

Per-player-by-number, ranges, patterns, presets, and save/load templates are
**not part of the current surface** — the old tool backed them with a
configuration store nothing reads anymore.

---

## 🚀 Quick Start

### View current configuration
```bash
./mafia.sh models
# 🤖 Model configuration:
#    Default model (mafia.config.json):
#   Provider:          openai
#   Model:             openai/gpt-4o-mini
#
#    Per-role overrides (.env — leave empty to use DEFAULT_MODEL):
#      DEFAULT_MODEL / MAFIA_MODEL / DOCTOR_MODEL / SHERIFF_MODEL /
#      VIGILANTE_MODEL / VILLAGER_MODEL
#
#    See CONFIG_GUIDE.md for the full model-assignment guide.
```

### Set models by role
```bash
# Edit .env (copy .env.sample if you don't have one):
#   DEFAULT_MODEL=openai/gpt-4o-mini          # everyone
#   MAFIA_MODEL=openai/gpt-4                  # all Mafia
#   SHERIFF_MODEL=anthropic/claude-3-opus-20240229

./mafia.sh new
```

### Set the default model
```bash
./mafia.sh config --model openai/gpt-4o-mini
# → Setting llmModel = openai/gpt-4o-mini
# → ✓ Configuration updated — llmModel = "openai/gpt-4o-mini"
```

---

## 📋 Command Reference (verified live)

| Command | What it does |
|---------|--------------|
| `./mafia.sh config --show` | Show players, durations, provider, model |
| `./mafia.sh config --model <provider/model>` | Set default model (`llmModel` in `mafia.config.json`) |
| `./mafia.sh config --set <key> <value>` | Set any config key (e.g. `llmModel`, `numPlayers`) |
| `./mafia.sh config --reset` | Reset config to defaults |
| `./mafia.sh models` | Show model setup + which role overrides are declared |
| `.env` role variables | `MAFIA_MODEL`, `DOCTOR_MODEL`, `SHERIFF_MODEL`, `VIGILANTE_MODEL`, `VILLAGER_MODEL` — empty inherits `DEFAULT_MODEL` |
| `roleModels` config key | Per-game map `{ "MAFIA": "openai/gpt-4", ... }` — adapter injects the `*_MODEL` vars into the engine child |

Rejected by the wrapper (and not coming back): `config-players`,
`--mafia-model`, `--town-model`, `--player-model N`, `--range-model`,
`--preset`, `--total-players`, `--save/--load`.

---

## 🎮 Usage Examples

### Example 1: GPT-4 vs Claude-3

```bash
# .env
DEFAULT_MODEL=anthropic/claude-3-sonnet-20240229   # town inherits this
MAFIA_MODEL=openai/gpt-4

./mafia.sh new
```

**Result:** Mafia plays GPT-4; Town (Doctor, Sheriff, Vigilante, Villagers)
plays Claude-3 Sonnet.

### Example 2: Strong Mafia, cheap Town

```bash
# .env
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=anthropic/claude-3-opus-20240229
SHERIFF_MODEL=openai/gpt-4
DOCTOR_MODEL=anthropic/claude-3-sonnet-20240229

./mafia.sh new
```

**Result:** Mafia = Claude-3 Opus, Sheriff = GPT-4, Doctor = Claude-3 Sonnet,
everyone else = GPT-4o-mini.

### Example 3: Per-game override (API / mafiactl path)

Pass a `roleModels` map in the game config — the server's legacy adapter maps
role names to the engine's env-var names (including `TOWN → VILLAGER_MODEL`)
and persists the assignment with the game record:

```json
{
  "numPlayers": 8,
  "llmModel": "openai/gpt-4o-mini",
  "roleModels": { "MAFIA": "openai/gpt-4", "SHERIFF": "anthropic/claude-3-opus-20240229" }
}
```

### Example 4: Research comparison loop

```bash
for model in "openai/gpt-4o-mini" "openai/gpt-4" "anthropic/claude-3-sonnet-20240229"; do
    ./mafia.sh config --model "$model"
    ./mafia.sh new > "results_${model//\//-}.log"
done
# Compare win rates: ./mafia.sh stats
```

---

## 🎯 Priority System

Resolution order for which model a player uses:

1. **Per-game `roleModels`** for the player's role (highest)
2. **`.env` role override** (`MAFIA_MODEL`, …)
3. **Default model**: config-file `llmModel` → `DEFAULT_MODEL` env → engine
   built-in `openai/gpt-4o-mini` (lowest)

An empty value at any role level inherits the next level down.

---

## 💾 Where assignments live

| Store | Format | Read by |
|-------|--------|---------|
| `mafia.config.json` (repo root, gitignored) | JSON `{ "llmModel": "provider/model", ... }` | `mafiactl config` / `./mafia.sh config` |
| `.env` (repo root, gitignored) | `MAFIA_MODEL=openai/gpt-4` etc. | game-engine.js at game start + server adapter |
| Game config `roleModels` | JSON map | server adapter (per-game, persisted with the game) |

The old `player_model_assignments` / `bulk_model_assignments` /
`player_config_templates` database tables from earlier drafts of this guide
are not read by the current engine — removed from this document.

---

## 📊 Available Models

| Provider | Example ids |
|----------|-------------|
| OpenAI | `openai/gpt-4o-mini`, `openai/gpt-4o`, `openai/gpt-4` |
| Anthropic | `anthropic/claude-3-haiku-20240307`, `anthropic/claude-3-sonnet-20240229`, `anthropic/claude-3-opus-20240229` |
| Google | `google/gemini-1.5-flash`, `google/gemini-1.5-pro` |

Custom/OpenRouter-compatible prefixed specs (e.g. `CUSTOM/openai/gpt-4o`)
pass through verbatim; the provider is derived from the first segment.

---

## 🎓 Research Use Cases

### 1. Model Comparison
```bash
./mafia.sh config --model openai/gpt-4
./mafia.sh new > gpt4.log
./mafia.sh config --model anthropic/claude-3-sonnet-20240229
./mafia.sh new > claude3.log
./mafia.sh stats        # win rates per model
```

### 2. Role Performance Analysis
```bash
# Strong Sheriff vs weak Sheriff — change only SHERIFF_MODEL between runs
# .env: SHERIFF_MODEL=openai/gpt-4        → ./mafia.sh new
# .env: SHERIFF_MODEL=openai/gpt-4o-mini  → ./mafia.sh new
```

### 3. Cost Optimization
```bash
# Keep the expensive model only where it matters
# .env: DEFAULT_MODEL=openai/gpt-4o-mini, MAFIA_MODEL=openai/gpt-4
./mafia.sh new
```

---

## 🔧 Troubleshooting

### `./mafia.sh config-players ...` prints the help banner and does nothing
`config-players` is not a wrapper verb. Use `.env` role variables or
`config --model` as documented above.

### `❌ Unknown config option: --mafia-model`
Per-role assignment is not a wrapper flag. Set `MAFIA_MODEL` in `.env`.

### Verify what the engine will use
```bash
./mafia.sh models && ./mafia.sh config --show
```

---

## 📖 Related Documentation

- **Main Config**: `CONFIG_GUIDE.md` (authoritative configuration reference)
- **Environment template**: `.env.sample`
- **Per-role guide**: `PERSONALIZED_AI_MODELS.md`

---

*Last Updated: October 6, 2026*
*Rewritten against the live surface for DOC-8 (previously documented the dead
`config-players`/`mafia-players.sh` tool; verified: every command here runs).*
