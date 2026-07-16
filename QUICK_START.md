# 🚀 Mafia AI Benchmark — Quick Start Guide

Get up and running in 5 minutes!

## Prerequisites

- **Node.js** v18 or higher
- **pnpm** (install via `npm install -g pnpm`)
- **OpenRouter API Key** (free at https://openrouter.ai/keys)

## Step 1: Clone & Install

```bash
git clone https://github.com/wojons/mafia-ai-benchmark.git
cd mafia-ai-benchmark
pnpm install
```

## Step 2: Get an API Key

1. Go to https://openrouter.ai/keys
2. Create a free account
3. Copy your API key (starts with `sk-or-v1-`)

## Step 3: Configure the API Key

```bash
# Create a .env file in the repo root
echo 'OPENAI_API_KEY=sk-or-v1-YOUR-ACTUAL-KEY-HERE' > .env
```

## Step 4: Build & Start the Server

```bash
# Build all packages (shared, server, cli, web)
pnpm build

# Start the server (port 3000)
pnpm --filter @mafia/server dev
```

The server starts on `http://localhost:3000`. Health check: `curl http://localhost:3000/health`

## Step 5: Run Your First Game

### Option A: Quick Demo (5 players, fastest)

```bash
pnpm --filter @mafia/cli game:run
```

### Option B: Run a Benchmark

```bash
# POST a benchmark run via the API
curl -X POST http://localhost:3000/api/v1/benchmark \
  -H 'Content-Type: application/json' \
  -d '{"gameCount": 1, "playerCount": 5, "modelName": "openai/gpt-4o-mini"}'

# Check results
curl http://localhost:3000/api/v1/benchmark
```

### Option C: Use the CLI

```bash
# Interactive CLI
pnpm --filter @mafia/cli dev

# Or via the built binary
pnpm --filter @mafia/cli build
node apps/cli/dist/index.js
```

## What You'll See

The game will:

1. **Generate Personas** — Each player gets a unique name and personality:

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

2. **Play Night Phase** — Mafia discuss and reach consensus:

   ```
   😈 STEP 1: MAFIA TEAM CHAT
   [Mafia Chat] Vincent 'Vince' Moretti:
     "Listen, we should consider our options carefully. I think we need
      to target someone who's a real threat to our plans..."
   ```

3. **Play Day Phase** — All players discuss and vote:

   ```
   ☀️ DAY 1 - Discussion & Voting

   [1/10] 💉 Vincent 'Vince' Romano (DOCTOR):
     "I noticed something interesting during the discussion..."
   ```

4. **Determine Winner** — Mafia or Town wins!

## Available Commands

### Server

| Command | Description |
| ------- | ----------- |
| `pnpm --filter @mafia/server dev` | Start dev server (hot reload) |
| `pnpm --filter @mafia/server start` | Start built server |
| `pnpm --filter @mafia/server build` | Compile TypeScript |
| `pnpm --filter @mafia/server test:run` | Run server tests |
| `pnpm --filter @mafia/server db:migrate` | Run DB migrations |

### CLI

| Command | Description |
| ------- | ----------- |
| `pnpm --filter @mafia/cli dev` | Start interactive CLI (dev mode) |
| `pnpm --filter @mafia/cli game:run` | Run a game |
| `pnpm --filter @mafia/cli game:watch` | Watch a running game |

### Root (all packages)

| Command | Description |
| ------- | ----------- |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format all code |

## Configuration Options

### Environment Variables (`.env`)

```env
OPENAI_API_KEY=sk-or-v1-your-key-here  # Required: OpenRouter API key
PORT=3000                               # Optional: server port (default 3000)
```

### CLI Configuration

```bash
# View current settings
pnpm --filter @mafia/cli dev -- config show

# Configure player count
pnpm --filter @mafia/cli dev -- config --players 8 --mafia 2
```

### Models

Set via the `modelName` field in benchmark POST:

```json
"openai/gpt-4o-mini"          // Fast & cheap (default)
"openai/gpt-4o"               // More capable
"anthropic/claude-3-haiku"   // Anthropic
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
🎮 Mafia AI Benchmark — Monorepo Edition
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
```

### "Cannot find module" errors

```bash
# Reinstall dependencies
pnpm install
```

### Build fails

```bash
# Clean and rebuild
pnpm build
```

### Server not starting (port 3000 in use)

```bash
# Check what's using port 3000
lsof -i :3000
# Or set a different port
PORT=3001 pnpm --filter @mafia/server dev
```

### Game runs but no real LLM calls

Make sure your API key is valid and has credits on OpenRouter.

## Project Structure

```
mafia-ai-benchmark/
├── apps/
│   ├── server/     # Express REST API + WebSocket game engine (port 3000)
│   ├── cli/        # mafiactl CLI for running games & benchmarks
│   └── web/        # React/Vite frontend dashboard
├── packages/
│   └── shared/     # Shared types, constants, validation (Zod schemas)
├── pnpm-workspace.yaml
├── turbo.json
└── package.json    # Root workspace config with pnpm scripts
```

## Next Steps

- Read [CONFIG_GUIDE.md](CONFIG_GUIDE.md) for full configuration options
- Read [specs/persona-system.md](specs/persona-system.md) for persona details
- Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for command cheat sheet

## Need Help?

- Create an issue: https://github.com/wojons/mafia-ai-benchmark/issues
- Check existing issues for common problems

---

**Enjoy watching AI agents play Mafia!** 🎮🤖
