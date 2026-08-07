# 🚀 Mafia AI Benchmark - Quick Start Guide

Get up and running in 5 minutes!

## Prerequisites

- **Node.js** v20 or higher
- **pnpm** (install with `npm install -g pnpm`)
- **OpenRouter API Key** (free at https://openrouter.ai/keys)

## Step 1: Get an API Key

1. Go to https://openrouter.ai/keys
2. Create a free account
3. Copy your API key (starts with `sk-or-v1-`)

## Step 2: Install and Configure

```bash
# Clone the repo
git clone https://github.com/wojons/mafia-ai-benchmark.git
cd mafia-ai-benchmark

# Install dependencies (all workspaces)
pnpm install

# Set your API key
echo 'OPENAI_API_KEY=sk-or-v1-YOUR-ACTUAL-KEY-HERE' > .env
```

## Step 3: Run Your First Game

The project is a **pnpm monorepo** with three apps:
- `apps/server` — REST API + WebSocket game server
- `apps/cli` — `mafiactl` command-line interface
- `apps/web` — React visualization dashboard

### Option A: Quick Demo via API (fastest)

```bash
# Start the server (in one terminal)
pnpm run server

# Create and run a game (in another terminal)
pnpm --filter @mafia/cli dev -- run-game --players 5
```

### Option B: Interactive CLI

```bash
# Explore all commands
pnpm --filter @mafia/cli dev -- help

# Run a 10-player game
pnpm --filter @mafia/cli dev -- run-game --players 10
```

### Option C: Web Dashboard

```bash
# Start the server
pnpm run server

# Start the web UI (on port 5174)
pnpm run web
```

Open http://localhost:5174 to watch games in real time.

### Option D: Run Benchmark Suite

```bash
# Start the server
pnpm run server

# Run automated benchmarks
pnpm --filter @mafia/cli dev -- benchmark --games 10 --players 5
```

## What You'll See

The game will:

1. **Generate Personas** - Each player gets a unique name and personality:

   ```
   🔒 Generating personas from seeds...
     [1/5] Seed: "A quiet accountant who loves solving puzzles..." -> Role: MAFIA
     [2/5] Seed: "A community organizer..." -> Role: DOCTOR

   🔒 CHARACTERS (Secret Role Assignments):
   ------------------------------------------------------------
     😈 Vincent Marino (Logical-Sequential)
         Role: MAFIA
         Traits: analytical, reserved, meticulous, strategic
         Flaw: Vincent struggles with trusting others...
   ```

2. **Play Night Phase** - Mafia discuss and reach consensus:

   ```
   😈 STEP 1: MAFIA TEAM CHAT
   [Mafia Chat] Vincent 'Vince' Moretti:
     "Listen, we should consider our options carefully. I think we need
      to target someone who's a real threat to our plans..."
   ```

3. **Play Day Phase** - All players discuss and vote:

   ```
   ☀️ DAY 1 - Discussion & Voting

   [1/10] 💉 Vincent 'Vince' Romano (DOCTOR):
     "I noticed something interesting during the discussion..."
   ```

4. **Determine Winner** - Mafia or Town wins!

## Available Commands

### Workspace Commands (from project root)

| Command                                    | Description                    |
| ------------------------------------------ | ------------------------------ |
| `pnpm install`                             | Install all dependencies       |
| `pnpm run server`                          | Start the game server          |
| `pnpm run web`                             | Start the web dashboard        |
| `pnpm test`                                | Run all tests                  |
| `pnpm run build`                           | Build all workspaces           |

> **Note — running `pnpm test`:** the server's API integration tests
> (`apps/server/src/__tests__/api.test.ts`) need a **live mafia server**. When
> none is reachable they are **skipped with a clear message** instead of
> failing. To run them, start the server (`pnpm run server`) and point the
> tests at it with `TEST_BASE_URL=http://localhost:3004 pnpm test` (the
> compose host port; the default probe URL is `http://localhost:3000`).

### CLI Commands (mafiactl)

| Command                                                       | Description                    |
| ------------------------------------------------------------- | ------------------------------ |
| `pnpm --filter @mafia/cli dev -- run-game --players 5`        | Run a game with 5 players      |
| `pnpm --filter @mafia/cli dev -- run-game --players 10`       | Run a game with 10 players     |
| `pnpm --filter @mafia/cli dev -- benchmark --games 10`        | Run 10 benchmark games         |
| `pnpm --filter @mafia/cli dev -- list-games`                  | List recent and active games   |
| `pnpm --filter @mafia/cli dev -- stats`                       | View game and model statistics |
| `pnpm --filter @mafia/cli dev -- watch-game <game-id>`        | Watch a game in real time      |
| `pnpm --filter @mafia/cli dev -- help`                        | Show all commands              |

### Server API Endpoints

| Endpoint                 | Method | Description        |
| ------------------------ | ------ | ------------------ |
| `/api/v1/games`          | GET    | List games         |
| `/api/v1/games`          | POST   | Create a new game  |
| `/api/v1/games/:id`      | GET    | Get game details   |
| `/api/v1/games/:id/start`| POST   | Start a game       |
| `/api/v1/benchmark`      | POST   | Run benchmarks     |
| `/api/v1/stats`          | GET    | View statistics    |

## Docker Deployment

The repo ships a `docker-compose.yml` stack: `server` (API + WebSocket,
host `:3004` → container `:3000`) and `web` (dashboard, host `:5174`).
**The container runs the source at build time — after any code change you
must rebuild, not just restart:**

```bash
# Rebuild the server image from current source and recreate the container
docker compose up -d --build server

# Verify the running instance serves the NEW code (old containers keep
# serving pre-fix behavior for hours/days until rebuilt)
curl -s http://localhost:3004/health
```

Health check: `docker ps` should show `mafia-ai-benchmark-server-1`
`Up … (healthy)`. If an endpoint behaves differently from the latest
git source (e.g. `GET /api/v1/games?limit=2` returning more than 2 games,
or `/api/v1/benchmark/report` showing a fabricated 100% win-rate row),
the container is stale — rebuild with the command above before debugging
further. A stale container was the root cause of MAF-GAP-014.

## Configuration Options

### Environment Variables

Create a `.env` file in the project root:

```bash
# Required
OPENAI_API_KEY=sk-or-v1-your-key-here

# Optional
PORT=3000                # Container server port (default: 3000; exposed on host as :3004)
TEST_BASE_URL=http://localhost:3004  # Where API integration tests look for the server (default: http://localhost:3000)
DATABASE_PATH=./data/games.db  # SQLite path
LOG_LEVEL=info           # debug, info, warn, error
```

### Game Settings

Configure games via the CLI:

```bash
# Set player count
pnpm --filter @mafia/cli dev -- config set players 8

# Set mafia count
pnpm --filter @mafia/cli dev -- config set mafia 2

# View current config
pnpm --filter @mafia/cli dev -- config show
```

### Models

Set the model in your `.env` file:

```bash
# Default model for all players
OPENAI_MODEL=openai/gpt-4o-mini       # Fast & cheap (default)
# OPENAI_MODEL=openai/gpt-4o          # More capable
# OPENAI_MODEL=anthropic/claude-3-haiku  # Anthropic
```

## How the Game Works

### Roles

| Role          | Ability                    | Team  |
| ------------- | -------------------------- | ----- |
| **Mafia**     | Kill 1 player per night    | Mafia |
| **Doctor**    | Protect 1 player per night | Town  |
| **Sheriff**   | Investigate exact role     | Town  |
| **Vigilante** | Kill once per game         | Town  |
| **Villager**  | Vote and discuss           | Town  |

### Night Phase

1. Mafia discuss (multiple messages) and reach consensus on kill
2. Doctor protects someone
3. Sheriff investigates someone
4. Vigilante can shoot (once per game)
5. Results revealed (who died, if saved)

### Day Phase

1. All players discuss (in character!)
2. Vote to lynch someone
3. Check win conditions

### Win Conditions

- **Mafia wins**: When mafia ≥ town (alive)
- **Town wins**: When all mafia eliminated

## Example Output

```
🎮 Mafia AI Benchmark - Monorepo Edition
======================================================================
🌙 NIGHT 1
😈 Mafia: Vincent Marino, Francesco 'Frankie' Moretti, Vincent 'Vince' Moretti
   [Mafia Chat] Vincent 'Vince' Moretti:
     "Listen, we should consider our options carefully. I think we need
      to target someone who's a real threat..."

💉 Doctor: Vincent 'Vince' Romano protects Maggie Sinclair
👮 Sheriff: Margaret 'Maggie' Sinclair investigates Vincent Marino
   → Result: Vincent Marino is MAFIA!

🌅 Morning: No deaths! (Doctor saved the target)

☀️ DAY 1
💬 Discussion...
🗳️ Voting...
🚨 Maggie Sinclair lynched! (She was the Sheriff)

🏆 Result: Mafia wins!
```

## Troubleshooting

### "API key not set" error

```bash
# Check your key is set
cat .env | grep OPENAI_API_KEY

# Ensure the .env file is in the project root (where package.json lives)
ls -la .env
```

### "Cannot find module" errors

```bash
# Install all workspace dependencies
pnpm install
```

### Server won't start

```bash
# Make sure nothing is using the host API port (compose exposes the server on :3004)
lsof -i :3004

# Build the server first if you've made changes
pnpm run server:build
pnpm run server
```

### CLI commands not working

```bash
# Make sure dependencies are installed
pnpm install

# Build the CLI first
pnpm --filter @mafia/cli build

# Then run commands
pnpm --filter @mafia/cli dev -- help
```

### Game runs but no real LLM calls

Make sure your API key is valid and has credits on https://openrouter.ai.

## Next Steps

- Read [CONFIG_GUIDE.md](CONFIG_GUIDE.md) for full configuration options
- Read [specs/persona-system.md](specs/persona-system.md) for persona details
- Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for command cheat sheet
- Explore the [README.md](README.md) for project architecture overview

## Need Help?

- Create an issue: https://github.com/wojons/mafia-ai-benchmark/issues
- Check existing issues for common problems

---

**Enjoy watching AI agents play Mafia!** 🎮🤖
