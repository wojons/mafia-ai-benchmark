# 🚀 Mafia AI Benchmark - Quick Start Guide

Get up and running in 5 minutes!

## Prerequisites

- **Node.js** v18 or higher
- **OpenRouter API Key** (free at https://openrouter.ai/keys)

## Step 1: Get an API Key

1. Go to https://openrouter.ai/keys
2. Create a free account
3. Copy your API key (starts with `sk-or-v1-`)

## Step 2: Configure the API Key

```bash
cd /config/workspace/mafia

# Edit the .env file and add your API key
nano .env
```

Find this line and replace with your actual key:

```env
OPENAI_API_KEY=sk-or-v1-YOUR-ACTUAL-KEY-HERE
```

## Step 3: Run Your First Game

### Option A: Quick Demo (5 players, fastest)

```bash
cd /config/workspace/mafia
node game-engine.js
```

This runs a complete game with 5 players and auto-generated personas.

### Option B: Full Demo (10 players)

```bash
cd /config/workspace/mafia
./mafia.sh demo
```

### Option C: Custom Configuration

```bash
# Configure for 8 players
./mafia.sh config --players 8 --mafia 2

# Create the game
./mafia.sh new
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

### Using mafia.sh (Recommended)

| Command                         | Description             |
| ------------------------------- | ----------------------- |
| `./mafia.sh demo`               | Run one-off demo game   |
| `./mafia.sh new`                | Create and run new game |
| `./mafia.sh config --show`      | View current settings   |
| `./mafia.sh config --players 8` | Set 8 players           |
| `./mafia.sh config --mafia 2`   | Set 2 mafia             |
| `./mafia.sh help`               | Show all options        |

### Using game-engine.js Directly

```bash
node game-engine.js              # Default (5 players)
node game-engine.js --players 8  # 8 players
```

## Configuration Options

### Players & Roles

```bash
./mafia.sh config --players 10   # Total players
./mafia.sh config --mafia 3      # Mafia count
./mafia.sh config --doctor 1     # Doctor count
./mafia.sh config --sheriff 1    # Sheriff count
./mafia.sh config --vigilante 1  # Vigilante count
```

### Game Settings

```bash
./mafia.sh config --mafia-msg-per 4   # Mafia messages each
./mafia.sh config --town-msg-per 3    # Town messages each
./mafia.sh config --day-rounds 2      # Discussion rounds
```

### Models

```bash
./mafia.sh config --model openai/gpt-4o-mini   # Fast & cheap (default)
./mafia.sh config --model openai/gpt-4o        # More capable
./mafia.sh config --model anthropic/claude-3-haiku  # Anthropic
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
🎮 Mafia AI Benchmark - PERSONA EDITION v3
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

# Reload and run
source .env && node game-engine.js
```

### "Cannot find module" errors

```bash
# Install dependencies
npm install
```

### Game runs but no real LLM calls

Make sure your API key is valid and has credits.

## Next Steps

- Read [CONFIG_GUIDE.md](CONFIG_GUIDE.md) for full configuration options
- Read [specs/persona-system.md](specs/persona-system.md) for persona details
- Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for command cheat sheet

## Need Help?

- Create an issue: https://github.com/wojons/mafia-ai-benchmark/issues
- Check existing issues for common problems

---

**Enjoy watching AI agents play Mafia!** 🎮🤖
