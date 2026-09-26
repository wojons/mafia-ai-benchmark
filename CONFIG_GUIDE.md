# 🎮 Mafia AI Benchmark — Configuration Guide

## Overview

Configuration lives in **two places**, both repo-local:

| File | What it configures | Created by |
|------|--------------------|------------|
| `mafia.config.json` (repo root) | Default game settings for the CLI: players, LLM provider/model, phase durations | `mafiactl init` / `mafiactl config` (or `./mafia.sh config`) |
| `.env` (repo root) | API keys, per-role model overrides, server ports, engine tuning | You (copy `.env.sample` for the full template) |

> The legacy `~/.mafia-config` / `/config/workspace/mafia/.mafia-config`
> file is gone — nothing in the monorepo reads it. Messaging limits and
> role counts are fixed inside the game engine; the tunable surface is
> players, models, and phase timing.
>
> Environment variables are audited against real readers (MAF-GAP-072):
> every uncommented entry in `.env.sample` has a verified reader, and the
> old never-read names (`WS_PORT`, `DEFAULT_PLAYERS`, role/message counts,
> `RATE_LIMIT_PER_MINUTE`, `TOKENS_PER_MINUTE`, `TRACK_COSTS`, …) were
> removed. The full matrix is below.

---

## 🎯 Quick Start

### Basic Commands

```bash
# Start the server (needed by everything below)
pnpm run server                     # or: ./mafia.sh server

# Write a default config file (mafia.config.json, repo-local)
./mafia.sh config --reset

# View current configuration
./mafia.sh config --show

# Interactive setup (prompts for players, roles, provider, model, timings)
pnpm --filter @mafia/cli dev -- init
```

---

## 🎛️ Configuration Options

### 👥 Game Settings (mafia.config.json)

| Setting | Description | Default | Example |
|---------|-------------|---------|---------|
| `numPlayers` | Total players in a game | 10 | `./mafia.sh config --players 8` |
| `llmProvider` | Default LLM provider | openai | `./mafia.sh config --set llmProvider openai` |
| `llmModel` | Default LLM model | openai/gpt-4o-mini | `./mafia.sh config --model openai/gpt-4o` |
| `nightDuration` | Night phase duration (s) | 60 | `./mafia.sh config --set nightDuration 60` |
| `dayDuration` | Day phase duration (s) | 120 | `./mafia.sh config --set dayDuration 120` |
| `votingDuration` | Voting phase duration (s) | 30 | `./mafia.sh config --set votingDuration 30` |

**Role distribution** is fixed by the engine at game start (roughly one
mafia per 4 players, always 1 doctor + 1 sheriff, vigilante only at 6+
players). It is not user-configurable.

**Role Distribution Examples:**

```bash
# Default 10-player game: 3 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 4 Villagers
./mafia.sh new

# 8-player game: 2 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 3 Villagers
./mafia.sh new 8

# 5-player game (minimum): 1 Mafia, 1 Doctor, 1 Sheriff, 2 Villagers
./mafia.sh new 5
```

### 🔧 Config-file Commands (mafia.config.json)

| Command | Description |
|---------|-------------|
| `./mafia.sh config --show` | View current settings |
| `./mafia.sh config --reset` | Reset config file to defaults (writes `./mafia.config.json` — inside the repo) |
| `./mafia.sh config --set <key> <value>` | Set any value (numbers/booleans parsed automatically) |
| `./mafia.sh config --model <provider/model>` | Shorthand for `--set llmModel ...` |
| `./mafia.sh config --players <n>` | Shorthand for `--set numPlayers ...` |
| `./mafia.sh config --menu` | Full interactive setup (runs `mafiactl init --force`) |
| `pnpm --filter @mafia/cli dev -- init` | Interactive setup from the CLI directly |

**Examples:**

```bash
# 8-player default, GPT-4o, longer day phase
./mafia.sh config --players 8
./mafia.sh config --model openai/gpt-4o
./mafia.sh config --set dayDuration 180

# Verify what actually landed
./mafia.sh config --show
```

The config file is a plain JSON document (flat keys as written by
`config set/reset`, nested `game`/`llm` sections from `init` — both
shapes are accepted when a game runs):

```json
{
  "numPlayers": 10,
  "llmProvider": "openai",
  "llmModel": "openai/gpt-4o-mini",
  "nightDuration": 60,
  "dayDuration": 120,
  "votingDuration": 30
}
```

---

## 💬 Messaging Limits (fixed in the engine)

Per-role messaging limits are **not configurable** — the engine fixes
them in code (mafia chat up to 6 messages, day discussion up to
`min(10, 2 × alive players)`). The old `--mafia-msg-per` / `--town-msg-per`
config options no longer exist. If you need different dynamics, edit
`game-engine.js` (the constants live near the chat loops).

---

## 🤖 AI Models

### Default Model

Set the default model via config file **or** environment — both are read
by the legacy engine through the `.env` loader:

| Layer | Where | Example |
|-------|-------|---------|
| Config file | `mafia.config.json` → `llmModel` | `./mafia.sh config --model openai/gpt-4o-mini` |
| Environment | `.env` → `DEFAULT_MODEL` | `DEFAULT_MODEL=openai/gpt-4o-mini` |
| Per-run flag | CLI `--model` flag | `pnpm --filter @mafia/cli dev -- run-game --model openai/gpt-4o` |

### Per-Role Overrides (`.env`)

Give specific roles their own model — leave a variable empty to inherit
`DEFAULT_MODEL`:

```bash
# .env
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=openai/gpt-4o           # mafia needs stronger reasoning
SHERIFF_MODEL=anthropic/claude-3-haiku
```

Available role variables: `DEFAULT_MODEL`, `MAFIA_MODEL`,
`DOCTOR_MODEL`, `SHERIFF_MODEL`, `VIGILANTE_MODEL`, `VILLAGER_MODEL`.

Model ids use the `provider/model` form (e.g. `openai/gpt-4o-mini`,
`anthropic/claude-3-sonnet`); the API key comes from the matching
provider variable (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — see
`.env.sample`). The default setup targets **OpenRouter** with any
OpenAI-compatible endpoint via `OPENAI_BASE_URL`.

**Check the current model setup:**

```bash
./mafia.sh models
```

---

## 📂 Configuration File

Settings are saved to `./mafia.config.json` at the **repo root** (never
in your home directory, never under `/config`):

```bash
# View the raw file
cat mafia.config.json
```

Both `mafiactl config` and the wrapper resolve the file from the
working directory, which is always the repo root — a fresh clone gets
its own file and never touches anything outside the repo.

---

## 🎮 Pre-Set Configurations

```bash
# Standard Game (10 players, defaults)
./mafia.sh config --reset && ./mafia.sh new

# Quick Game (5 players — the minimum)
./mafia.sh new 5

# Championship Game (12 players)
./mafia.sh new 12
```

---

## 🎭 Persona System

Personas are **always on** — every player gets an LLM-generated name,
backstory, and communication style derived from seed descriptions. To
run with specific persona seeds, pass them through the API:

```bash
curl -X POST localhost:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"numPlayers": 5, "personaSeeds": ["A quiet accountant who loves puzzles", "..."]}'
```

The old `PERSONA_ENABLED` / `--personas` flags no longer exist — personas
cannot be turned off (confirmed by the MAF-GAP-072 audit: nothing reads
`PERSONA_ENABLED`).

---

## 💻 Environment Variables (`.env`)

Copy `.env.sample` to `.env` and fill in your values. Every uncommented
entry below was audited against the source tree (MAF-GAP-072): each has a
verified reader; removed names are listed in the
**Removed (dead) variables** section.

**Scope: server process vs legacy engine child process.** The server
(`apps/server`) reads its variables itself. Games are actually played by
the legacy engine (`game-engine.js`), which
`apps/server/src/services/legacy-game-adapter.ts` spawns as a child
process; the bridge (`apps/server/src/services/legacy-bridge.js`) loads
`.env` again inside that child, so engine variables take effect there —
changing them requires a new game, not a server restart.

| Variable | Scope | Reader | Default |
|----------|-------|--------|---------|
| `OPENAI_API_KEY` | engine child | `game-engine.js:688` (legacy engine LLM calls) | — |
| `OPENAI_BASE_URL` | engine child | `game-engine.js:689` (OpenAI-compatible endpoint, default OpenRouter) | `https://openrouter.ai/api/v1` |
| `DEFAULT_MODEL` | engine child | `game-engine.js:752` (+ `legacy-game-adapter.ts:612` fallback) | `openai/gpt-4o-mini` |
| `MAFIA_MODEL` | engine child | `game-engine.js:760` via `ROLE_ENV_MAP` (also set per-game from `config.roleModels` by the adapter) | inherits `DEFAULT_MODEL` |
| `DOCTOR_MODEL` | engine child | `game-engine.js:761` via `ROLE_ENV_MAP` | inherits `DEFAULT_MODEL` |
| `SHERIFF_MODEL` | engine child | `game-engine.js:762` via `ROLE_ENV_MAP` | inherits `DEFAULT_MODEL` |
| `VIGILANTE_MODEL` | engine child | `game-engine.js:763` via `ROLE_ENV_MAP` | inherits `DEFAULT_MODEL` |
| `VILLAGER_MODEL` | engine child | `game-engine.js:764` via `ROLE_ENV_MAP` (TOWN config keys alias to it) | inherits `DEFAULT_MODEL` |
| `PERSONA_TEMPERATURE` | engine child | `game-engine.js:1740` | `1.0` |
| `MAX_CONTEXT_CHARS` | engine child | `game-engine.js:1726` | `100000` |
| `MAX_RETRIES` | engine child | `game-engine.js:1732` | `3` |
| `RETRY_DELAY_MS` | engine child | `game-engine.js:1735` | `1000` |
| `ALLOW_MULTI_ROLE` | engine child | `game-engine.js:1744` (`"true"` enables) | `false` |
| `LOG_LEVEL` | engine child | `game-engine.js:21` (pino structured logging; inert when `LOG_STRUCTURED=false`) | `info` |
| `PORT` | server | `apps/server/src/index.ts:28` (container port pinned to 3000 by compose) | 3000 (`DEFAULT_PORT`) |
| `DB_PATH` | server | `apps/server/src/index.ts:43` (SQLite database path) | `./data/mafia.db` |
| `NODE_ENV` | server | `apps/server/src/index.ts:128` (`production` hides internal error details in API error responses) | — |

Notes:
- The engine child also inherits `OPENAI_API_KEY`/`DEFAULT_MODEL` from the
  server's own environment via `{...process.env}` in the adapter, so values
  exported in the shell reach the engine even without `.env`.
- Per-role models can be set per game through `config.roleModels`
  (mafiactl); the adapter then sets exactly those `*_MODEL` variables in
  the child environment. An empty value inherits `DEFAULT_MODEL`.

### Removed (dead) variables

These names appeared in `.env.sample` (and sometimes `specs/`) but **no
non-test source reads them** — verified by scanning `apps/`, `packages/`,
`game-engine.js` and the game-engine modules for `process.env` readers
(MAF-GAP-072):

| Variable | Why it is dead |
|----------|----------------|
| `WS_PORT` | WebSocket rides the server's HTTP port (`/ws`); no separate WS listener exists |
| `DEFAULT_PLAYERS` | player count comes from `mafia.config.json` (`numPlayers`) / CLI args |
| `MAFIA_COUNT`, `DOCTOR_COUNT`, `SHERIFF_COUNT`, `VIGILANTE_COUNT` | role distribution is fixed by the engine |
| `MAFIA_MESSAGES_PER_PLAYER`, `MAFIA_MAX_MESSAGES`, `TOWN_MESSAGES_PER_PLAYER`, `TOWN_MAX_MESSAGES` | messaging limits are engine-fixed constants |
| `DAY_DISCUSSION_ROUNDS` | day-discussion flow is engine-fixed |
| `VOTING_ENABLED`, `NIGHT_PHASE_ENABLED` | phase flow is engine-fixed |
| `PERSONA_ENABLED` | personas are always on (old `--personas` flag is gone too) |
| `DEFAULT_TEMPERATURE` | engine pins temperature in code (0.7 default) |
| `DEFAULT_MAX_TOKENS` | engine pins `maxTokens: 800` in code |
| `RATE_LIMIT_PER_MINUTE`, `TOKENS_PER_MINUTE` | no rate limiter reads environment; provider modules handle 429s |
| `TRACK_COSTS` | cost tracking has no on/off switch; usage is always collected |
| `ANTHROPIC_BASE_URL`, `GOOGLE_BASE_URL`, `DEEPSEEK_BASE_URL`, `GROQ_BASE_URL`, `META_BASE_URL`, `MISTRAL_BASE_URL`, `XAI_BASE_URL`, `QWEN_BASE_URL` | provider modules pin their endpoints (e.g. `anthropic.ts:37`); only `OPENAI_BASE_URL` is read |
| `DEBUG` | the `DEBUG` token appears in the shared logging enum (`LogLevel.DEBUG`), but no `process.env.DEBUG` reader exists |

`MAX_CONTEXT_CHARS` is intentionally **not** in the removed table: it is
live (engine context budget, `game-engine.js:1726`). `MAFIA_SERVER_URL`
is also not `.env`-scoped — mafiactl (`apps/cli/src/config.ts`) and
`mafia.sh` read it from your shell export.

---

## 🧪 Testing Different Configurations

### Test 1: Compare Player Counts

```bash
./mafia.sh server                    # terminal 1

./mafia.sh new 5                     # terminal 2
./mafia.sh new 10
./mafia.sh stats                     # compare outcomes
```

### Test 2: Compare Role Distributions (via player count)

```bash
./mafia.sh new 6                     # 2 Mafia, 4 Town
./mafia.sh new 10                    # 3 Mafia, 7 Town
./mafia.sh stats
```

### Test 3: Compare AI Models

```bash
./mafia.sh config --model openai/gpt-4o-mini
./mafia.sh new 10
./mafia.sh config --model openai/gpt-4o
./mafia.sh new 10
./mafia.sh stats                     # win rates per model
```

Or benchmark two models head-to-head:

```bash
./mafia.sh benchmark --games 2 --models openai/gpt-4o-mini,openai/gpt-4o
```

---

## 📋 Command Reference

### Game Management

| Command | Description |
|---------|-------------|
| `./mafia.sh server` | Start the game server (:3004) |
| `./mafia.sh new [n]` | Start a game (default 10 players) |
| `./mafia.sh demo` | Run a one-off 5-player game |
| `./mafia.sh list` | List all games |
| `./mafia.sh watch [gameId]` | Watch a game live (most recent if no id) |
| `./mafia.sh continue` | How to reopen a finished game |
| `./mafia.sh delete [id]` | Not supported — the server has no delete API (rows are preserved for stats by design) |

### Benchmarking

| Command | Description |
|---------|-------------|
| `./mafia.sh benchmark --quick` | Show the accumulated benchmark report |
| `./mafia.sh benchmark --games 2 --models a,b` | Run fresh benchmark games |
| `./mafia.sh benchmark export --format csv` | Export benchmark data |
| `./mafia.sh stats` | Game and model statistics |

### Configuration

| Command | Description |
|---------|-------------|
| `./mafia.sh config --show` | View current settings |
| `./mafia.sh config --reset` | Reset config file to defaults (repo-local) |
| `./mafia.sh config --set <k> <v>` | Set a configuration value |
| `./mafia.sh config --model <m>` | Set default LLM model |
| `./mafia.sh config --players <n>` | Set default player count |
| `./mafia.sh models` | Show the model configuration |

### Raw mafiactl (equivalent, no wrapper)

| Command | Description |
|---------|-------------|
| `pnpm --filter @mafia/cli dev -- init` | Interactive setup |
| `pnpm --filter @mafia/cli dev -- run-game --players 10` | Run a game |
| `pnpm --filter @mafia/cli dev -- list-games` | List games |
| `pnpm --filter @mafia/cli dev -- watch-game <id>` | Watch a game |
| `pnpm --filter @mafia/cli dev -- config show` | Show config |
| `pnpm --filter @mafia/cli dev -- stats` | Statistics |
| `pnpm --filter @mafia/cli dev -- benchmark` | Benchmark report/run |

---

## 💡 Tips & Best Practices

1. **Start with defaults**: run `./mafia.sh config --reset`, start the
   server, and run a 5-player game first (cheapest).
2. **Check for mock games**: an invalid API key makes every LLM call
   fall back to canned phrases; such games are flagged `mock` and
   excluded from win stats — fix `.env` if stats look empty.
3. **Compare models fairly**: change only the model between runs.
4. **Use `MAFIA_SERVER_URL`** to point the CLI at a remote server.
5. **Document your experiments**: benchmark results accumulate on the
   server — `./mafia.sh benchmark --quick` shows the full report.

---

## 🔜 Notes

- Messaging limits and role counts are engine-fixed (see above).
- Games run to completion server-side; there is no pause/resume — use
  `watch-game` to follow live and `/replay` to review a finished game.

---

*Last Updated: September 2026 (rewritten against the pnpm monorepo —
MAF-GAP-071; env sample audited against real readers — MAF-GAP-072)*
*Version: 4.1*