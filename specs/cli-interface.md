# CLI Interface Specifications

## Overview
The CLI (`mafiactl`) provides command-line control for creating, monitoring, and managing Mafia AI games.

## Installation
```bash
npm install -g mafia-ai-benchmark-cli
# or
pnpm install
pnpm build
pnpm link
```

## Global Options
```
mafiactl [global-options] <command> [command-options]

Global Options:
  -h, --help          Show help
  -v, --version       Show version
  --verbose           Enable verbose logging
  --json              Output JSON instead of formatted text
  --api-url <url>     API server URL (default: http://localhost:3000)
```

## Commands

### `mafiactl new`
Create and start a new game.

**Usage:**
```bash
mafiactl new [options]
```

**Options:**
```
  -p, --players <number>    Number of players (default: 10)
  -m, --mafia <number>      Number of mafia (default: 3)
  -s, --seed <number>       Random seed (optional)
  --names <names>           Comma-separated player names
  --mode <mode>             Agent mode: scripted|llm (default: scripted)
  --start                   Auto-start game after creation
  --attach                  Auto-attach after creation
  --json                    Output JSON
```

**Examples:**
```bash
# Default setup (10 players, 3 mafia, scripted agents)
mafiactl new

# Custom player count
mafiactl new --players 12 --mafia 4 --seed 12345 --start

# Custom names
mafiactl new --names "Alice,Bob,Charlie,Diana,Eve,Frank,Grace,Henry,Iris,Jack"

# With auto-attach
mafiactl new --seed 42 --attach

# Output game ID for scripting
GAME_ID=$(mafiactl new --json | jq -r .gameId)
```

**Output (formatted):**
```
✓ Game Created
  
📋 Game Details
  ID:         game-abc123
  Status:     CREATED
  Players:    10 (3 Mafia, 1 Doctor, 1 Sheriff, 5 Villagers)
  Seed:       12345
  Mode:       scripted

👥 Players
  Alice      [Villager]  ✓ Alive
  Bob        [Mafia]     ✓ Alive
  Charlie    [Doctor]    ✓ Alive
  Diana      [Sheriff]   ✓ Alive
  ...

🔗 Links
  Status:    http://localhost:3000/api/games/game-abc123
  Stream:    mafiactl attach game-abc123
  UI:        http://localhost:5173/game/game-abc123

💡 Next Steps
  Start:     mafiactl start game-abc123
  Attach:    mafiactl attach --follow game-abc123
  UI:        Open browser to Web UI
```

**Output (JSON):**
```json
{
  "gameId": "game-abc123",
  "status": "CREATED",
  "config": {
    "players": 10,
    "mafia": 3,
    "seed": 12345,
    "mode": "scripted"
  },
  "players": [
    {"id": "p1", "name": "Alice", "role": "villager", "alive": true},
    {"id": "p2", "name": "Bob", "role": "mafia", "alive": true}
  ],
  "links": {
    "status": "http://localhost:3000/api/games/game-abc123",
    "stream": "ws://localhost:3000/ws/game-abc123",
    "ui": "http://localhost:5173/game/game-abc123"
  }
}
```

**Exit Codes:**
- `0` - Success
- `1` - Invalid configuration
- `2` - API connection error
- `3` - Internal error

---

### `mafiactl attach`
Attach to a running game and stream events.

**Usage:**
```bash
mafiactl attach <game-id> [options]
```

**Options:**
```
  -f, --follow          Follow game stream (live updates)
  --poll <ms>           Poll interval for --no-stream mode (default: 1000)
  --verbose             Show all events including THINK streams
  --watch <player>      Highlight specific player events
  --json                Output raw JSON events
```

**Examples:**
```bash
# Attach to running game (shows status once)
mafiactl attach game-abc123

# Follow live game
mafiactl attach game-abc123 --follow

# Watch specific player
mafiactl attach game-abc123 --follow --watch "Alice"

# Full verbose mode (shows THINK)
mafiactl attach game-abc123 --verbose

# JSON mode for scripting
mafiactl attach game-abc123 --follow --json > game-log.json
```

**Output format:**

When `--follow` is used, shows live stream with color-coding:

```
🔴 NIGHT 1
   21:30:01  [Mafia] Bob targets Charlie
   21:30:02  [Doctor] Charlie protects Alice
   21:30:03  [Sheriff] Diana investigates Bob
   
🌅 MORNING 1
   21:30:05  ☀️ No one died (Doctor protection!)
   
💬 DAY 1 - Discussion
   Alice: "I think Bob is acting suspicious..."
   Bob: "That's ridiculous! Diana is the real threat."
   ...
   
🗳️ DAY 1 - Voting
   Alice → Bob
   Bob → Diana
   Charlie → Bob
   ...
   
⚰️ ELIMINATION
   Bob (Mafia) eliminated by vote
   
🔴 NIGHT 2
   ...
```

With `--watch Alice`:
```
💬 DAY 1 - Discussion
   Alice: "I think Bob is acting suspicious..."
                 ^^^^ highlighted
```

With `--verbose`:
```
💭 THINK (Alice): "Bob defended Charlie too strongly. 
                   That looks like mafia protecting teammate."
💬 SAYS (Alice): "I think Bob is acting suspicious..."
```

**Exit Codes:**
- `0` - Normal exit (Ctrl+C or game ended)
- `1` - Game not found
- `2` - API connection error
- `130` - Interrupted (Ctrl+C)

---

### `mafiactl status`
Get current game status (non-streaming).

**Usage:**
```bash
mafiactl status <game-id> [options]
```

**Options:**
```
  --json        Output JSON
  --roles       Show player roles (admin only)
  --detailed    Show detailed stats
```

**Examples:**
```bash
# Quick status check
mafiactl status game-abc123

# With roles (admin view)
mafiactl status game-abc123 --roles

# Full stats
mafiactl status game-abc123 --detailed

# JSON for scripting
mafiactl status game-abc123 --json
```

**Output (standard):**
```
🎮 Game: game-abc123

Status: RUNNING
Phase:  DAY DISCUSSION (Day 2)

👥 Players (Alive: 6 / Dead: 4)
  Alice      Villager  ✓ Alive
  Bob        Mafia     ✗ Dead (Night 1)
  Charlie    Doctor    ✓ Alive
  Diana      Sheriff   ✗ Dead (Vote Day 1)
  ...

📊 Stats
  Day:        2
  Round:      6
  Duration:   5m 23s

Winner: Town (not yet decided)
```

**Output (detailed):**
```
🎮 Game: game-abc123

Status: RUNNING
Phase:  DAY VOTING (Day 2)

👥 Players
  Alice [V]   Alive  Suspicion: 45%
  Charlie [D] Alive  Suspicion: 20%
  Eve [V]     Alive  Suspicion: 65% ← Leading Vote
  ...

🗳️ Current Vote (2/6 cast)
  Alice     → Eve     ("Too defensive")
  Charlie   → Not yet voted
  ...

🌙 Night Results
  Night 1: No kill (Doctor protected Charlie)
  Night 2: Sheriff (Diana) killed

🎯 Sheriff's Investigation Log
  Night 1: Bob (Mafia) ✓
  Night 2: Eve (Unknown)
```

**Output (JSON):**
```json
{
  "gameId": "game-abc123",
  "status": "RUNNING",
  "phase": "DAY_VOTING",
  "dayNumber": 2,
  "roundNumber": 6,
  "players": {
    "alive": [/* 6 players */],
    "dead": [/* 4 players */]
  },
  "currentVote": {
    "cast": 2,
    "total": 6,
    "leader": "Eve",
    "distribution": {"Eve": 1, "Frank": 1}
  },
  "createdAt": 1703774400000,
  "durationMs": 323000
}
```

**Exit Codes:**
- `0` - Success
- `1` - Game not found

---

### `mafiactl start`
Start a created game.

**Usage:**
```bash
mafiactl start <game-id> [options]
```

**Examples:**
```bash
# Start game
mafiactl start game-abc123

# With follow
mafiactl start game-abc123 && mafiactl attach game-abc123 --follow
```

**Output:**
```
✓ Started game-abc123
Phase: NIGHT_ACTIONS (Day 0)
```

**Exit Codes:**
- `0` - Success
- `1` - Game not found
- `2` - Already started

---

### `mafiactl pause`
Pause a running game.

**Usage:**
```bash
mafiactl pause <game-id>
```

**Output:**
```
✓ Paused game-abc123
Phase: DAY_VOTING (Day 2) - PAUSED
```

---

### `mafiactl resume`
Resume a paused game.

**Usage:**
```bash
mafiactl resume <game-id>
```

**Output:**
```
✓ Resumed game-abc123
Phase: DAY_VOTING (Day 2) - RUNNING
```

---

### `mafiactl step`
Execute a single step (for debugging).

**Usage:**
```bash
mafiactl step <game-id> [options]
```

**Options:**
```
  --count <n>     Number of steps (default: 1)
```

**Examples:**
```bash
# Single step
mafiactl step game-abc123

# 5 steps
mafiactl step game-abc123 --count 5

# Keep stepping until next phase
while true; do mafiactl step game-abc123; sleep 1; done
```

**Output:**
```
✓ Step executed
Completed: NIGHT_ACTIONS → MORNING_REVEAL
Next:      MORNING_REVEAL → DAY_DISCUSSION
```

---

### `mafiactl export`
Export game event log.

**Usage:**
```bash
mafiactl export <game-id> [options]
```

**Options:**
```
  -o, --output <file>   Output file (default: stdout)
  -f, --format <fmt>    Format: jsonl|json (default: jsonl)
  --include-private     Include THINK and private events
```

**Examples:**
```bash
# Export to stdout
mafiactl export game-abc123

# Export to file
mafiactl export game-abc123 --output game-abc123.jsonl

# Export with private events (full log)
mafiactl export game-abc123 --include-private --output full-log.jsonl

# Export as JSON
mafiactl export game-abc123 --format json > game.json
```

**Output file (jsonl format):**
```
{"eventType":"GAME_CREATED","gameId":"game-abc123","sequence":0,...}
{"eventType":"PHASE_CHANGED","gameId":"game-abc123","sequence":1,...}
{"eventType":"NIGHT_ACTION_SUBMITTED","gameId":"game-abc123","sequence":2,...}
...
```

---

### `mafiactl list`
List games.

**Usage:**
```bash
mafiactl list [options]
```

**Options:**
```
  --limit <n>       Number of games (default: 50)
  --offset <n>      Offset for pagination (default: 0)
  --status <status> Filter by status
  --json            Output JSON
```

**Examples:**
```bash
# List recent games
mafiactl list

# List running games only
mafiactl list --status RUNNING

# Pagination
mafiactl list --limit 10 --offset 50

# JSON output
mafiactl list --json | jq '.games[] | {id, status, phase}'
```

**Output:**
```
🎮 Recent Games (50 total)

ID              Status    Phase         Day   Winner   Created
─────────────   ────────  ────────────  ────  ──────   ────────────
game-abc123     RUNNING   DAY_VOTING    2     -        1 hour ago
game-def456     FINISHED  END           4     town     3 hours ago
game-ghi789     PAUSED    DAY_DISCUSS   1     -        5 hours ago
```

---

## Configuration

### Config File
CLI reads from `~/.mafiactl/config.json`:

```json
{
  "apiUrl": "http://localhost:3000",
  "defaultOptions": {
    "players": 10,
    "mafia": 3,
    "mode": "scripted"
  }
}
```

### Environment Variables
- `MAFIACTL_API_URL`: API server URL
- `MAFIACTL_VERBOSE`: Enable verbose mode (1/0)
- `MAFIACTL_JSON`: Output JSON format (1/0)

---

## Exit Codes

Standard exit codes:
- `0` - Success
- `1` - General error (invalid args, API error)
- `2` - Connection error
- `3` - Permission denied
- `130` - Interrupted (Ctrl+C)

---

## Interactive Mode

Future enhancement: Interactive mode for debugging.

```bash
mafiactl interactive game-abc123
```

Shows TUI with:
- Live event feed
- Player roster
- Control buttons (pause, resume, step)
- Filter options
- Search functionality

Uses `blessed` or similar library.

---

## Testing

### CLI Tests
```bash
# Run CLI tests
pnpm test:cli

# Test specific command
pnpm test:cli -- --grep "mafiactl new"
```

### Example Test
```typescript
test('mafiactl new creates game', async () => {
  const result = await runCli(['new', '--seed', '123', '--json']);
  expect(result.exitCode).toBe(0);
  
  const game = JSON.parse(result.stdout);
  expect(game.gameId).toMatch(/^game-/);
  expect(game.config.seed).toBe(123);
});
```