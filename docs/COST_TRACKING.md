# Cost Tracking System Documentation

## Overview

The Cost Tracking System monitors API usage and token costs for playing Mafia games with AI agents. It enforces budget limits to prevent overspending, tracks costs per-turn, per-player, and per-game, and provides detailed reports.

## Features

- **Per-Turn Tracking**: Track costs for each player's turn across all game phases
- **Budget Enforcement**: Prevent overspending with configurable limits and warnings
- **Multi-Granularity**: Track by player, game, model, and phase
- **Real-Time Monitoring**: Get budget warnings as you play
- **Detailed Reports**: Cost breakdowns by player, model, and phase
- **Context Compression**: Automatically compress chat history to reduce token usage
- **Event Replay**: Capture all game events for debugging and replay

## Quick Start

```javascript
const MafiaGame = require("./game-engine");

// Start game with cost tracking (default config)
const game = new MafiaGame({
  enableDatabase: true, // Required for cost tracking
});

await game.startGame(6); // 6 players

// After game ends, get cost report
if (game.costTracker) {
  const report = game.costTracker.getCostReport(game.gameId);
  console.log(`Total Cost: $${report.totalCost}`);
  console.log(`Budget Used: ${(report.budgetUsedPct * 100).toFixed(2)}%`);
}
```

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Cost tracking limits
COST_PER_PLAYER_PER_TURN=0.50      # Maximum cost per player per turn (USD)
COST_PER_GAME_TOTAL=10.00          # Maximum total cost per game (USD)
COST_WARNING_THRESHOLD=0.80        # Warn when budget reaches 80%
```

### Programmatic Configuration

```javascript
const costTracker = new CostTracker(db, {
  perPlayerPerTurn: 1.00,      // $1.00 per player per turn
  perGameTotal: 20.00,          // $20.00 per game total
  perModelPerTurn: 1.50,        # $1.50 per model per turn
  warningThreshold: 0.90,       // Warn at 90% not 80%
  stopThreshold: 1.00,          # Stop at 100% by default
});
```

## API Reference

### CostTracker Class

#### Constructor

```javascript
const tracker = new CostTracker(
  databaseConnection, // Database connection (optional)
  budgetLimits, // Configuration object (optional)
);
```

#### Methods

##### `trackPlayerTurn(gameId, playerId, playerName, turnData)`

Track costs for a single player turn.

**Parameters:**

- `gameId` (string): Unique game identifier
- `playerId` (string): Unique player identifier
- `playerName` (string): Human-readable player name
- `turnData` (object): Turn information
  - `phase` (string): Game phase (e.g., "DAY_DISCUSSION", "NIGHT_ACTIONS")
  - `actionType` (string): Type of action (e.g., "DISCUSS", "VOTE", "INVESTIGATE")
  - `model` (string): AI model used (e.g., "openai/gpt-4o-mini")
  - `provider` (string): API provider (e.g., "openrouter")
  - `promptTokens` (number): Number of prompt tokens used
  - `completionTokens` (number): Number of completion tokens used
  - `prices` (object): Pricing per million tokens
    - `promptPricePerMillion` (number): Cost per 1M prompt tokens
    - `completionPricePerMillion` (number): Cost per 1M completion tokens

**Returns:**

```javascript
{
  promptCost: 0.00015,           // Cost of prompt (USD)
  completionCost: 0.00012,       // Cost of completion (USD)
  totalCost: 0.00027,            // Total cost (USD)
  tokens: {
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200
  },
  warningTriggered: false,       // True if warning threshold reached
  stopTriggered: false,          // True if budget exhausted
  remainingBudget: 9.99973,      // Remaining budget (USD)
  budgetUsedPct: 0.000027        // Percentage of budget used
}
```

##### `getCostReport(gameId)`

Get detailed cost report for a game.

**Parameters:**

- `gameId` (string): Unique game identifier

**Returns:**

```javascript
{
  gameId: "game-123",
  totalCost: 0.005896,          // Total cost (USD)
  totalTokens: 26208,           // Total tokens used
  budgetUsedPct: 0.05896,       // Percentage of budget used
  budgetRemaining: 9.994104,    // Remaining budget (USD)
  warningsTriggered: 0,         // Number of warnings
  stopsTriggered: 0,            // Number of stops

  // Player breakdown
  players: [
    {
      playerId: "player-1",
      playerName: "Alice",
      totalTurns: 19,
      totalCost: 0.005896,
      totalTokens: 26208,
      avgCostPerTurn: 0.000310,
      warnings: 0,
      stops: 0,
      costsByPhase: [
        {
          phase: "DAY_DISCUSSION",
          turns: 6,
          totalCost: 0.001944,
          totalTokens: 8286,
          avgCostPerTurn: 0.000324
        }
      ]
    }
  ],

  // Model breakdown
  models: [
    {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      totalTurns: 19,
      totalCost: 0.005896,
      totalTokens: 26208,
      avgCostPerTurn: 0.000310
    }
  ]
}
```

##### `canAffordAction(gameId, playerId, estimatedCost)`

Check if player can afford another action.

**Parameters:**

- `gameId` (string): Unique game identifier
- `playerId` (string): Unique player identifier
- `estimatedCost` (object): Estimated cost
  - `totalCost` (number): Estimated total cost

**Returns:**

- (boolean): `true` if action is affordable, `false` if budget limit reached

##### `getPlayerBudget(gameId, playerId)`

Get remaining budget for a player.

**Parameters:**

- `gameId` (string): Unique game identifier
- `playerId` (string): Unique player identifier

**Returns:**

```javascript
{
  remainingPerTurn: 0.49973,    // Remaining per-turn budget
  remainingPerGame: 9.99973,    // Remaining per-game budget
  usedPerTurn: 0.00027,         // Used per turn
  usedPerGame: 0.00027,         // Used per game
  warnings: 0,                  // Number of warnings
  stops: 0                      // Number of stops
}
```

##### `getPlayerBudgetSummary(playerId)`

Get budget summary as a formatted string for player prompts.

**Parameters:**

- `playerId` (string): Unique player identifier

**Returns:**

- (string): Formatted budget summary

##### `updateBudgetLimits(newLimits)`

Update budget limits dynamically.

**Parameters:**

- `newLimits` (object): New budget limits
  - `perPlayerPerTurn` (number): New per-turn limit
  - `perGameTotal` (number): New total limit
  - `warningThreshold` (number): New warning threshold
  - `stopThreshold` (number): New stop threshold

##### `getCostTrends(options)`

Get cost trends with filtering and sorting.

**Parameters:**

- `options` (object): Query options
  - `gameId` (string, optional): Filter by game
  - `playerId` (string, optional): Filter by player
  - `model` (string, optional): Filter by model
  - `limit` (number, optional): Max results (default: 100)
  - `sortBy` (string, optional): Sort field (default: "timestamp")
  - `sortOrder` (string, optional): "ASC" or "DESC" (default: "DESC")

**Returns:**

- (array): Array of budget events

### ContextCompressor Class

Automatically compresses chat history to reduce token usage.

#### Constructor

```javascript
const compressor = new ContextCompressor();
```

#### Methods

##### `compressHistory(gameState, player, options)`

Compress chat history for a player.

**Parameters:**

- `gameState` (object): Game state
  - `chatHistory` (array): Chat messages
  - `maxContextChars` (number): Maximum context size
- `player` (object): Player object (for summarizing repetitive args)
- `options` (object): Compression options
  - `maxChars` (number): Maximum characters (default: 50000)
  - `priority` (string): "evidence", "recent", or "all" (default: "evidence")
  - `removeVotingDuplicates` (boolean): Remove duplicate voting (default: true)
  - `summarizeRepetitiveArgs` (boolean): Summarize repetitive arguments (default: true)
  - `trimLongMessages` (boolean): Trim long messages (default: true)

**Returns:**

- (array): Compressed chat history

### EventReplay Class

Capture and replay game events for debugging.

#### Constructor

```javascript
const replay = new EventReplay(databaseConnection);
```

#### Methods

##### `captureEvent(event, gameState)`

Capture a game event for replay.

**Parameters:**

- `event` (object): Game event
- `gameState` (object): Current game state (optional)

##### `replayGame(gameId)`

Replay a game from event log.

**Parameters:**

- `gameId` (string): Unique game identifier

**Returns:**

- (Promise<void>): Replays the game to console

##### `restoreToEvent(gameId, eventId)`

Restore game to specific event point.

**Parameters:**

- `gameId` (string): Unique game identifier
- `eventId` (number): Event ID

**Returns:**

- (Promise<object>): Event and snapshot

## Budget Enforcement

### Per-Player-Per-Turn Limit

Prevents a single player from exceeding a cost threshold on a single turn.

**Default:** $0.50 per player per turn

### Per-Game-Total Limit

Prevents the entire game from exceeding a total cost threshold.

**Default:** $10.00 per game

### Warning Threshold

Outputs a warning when budget usage reaches the threshold.

**Default:** 80% of budget

**Example:**

```
[COST] Budget warning for Alice: 85.3% used
```

### Stop Threshold

Stops further API calls when budget is exhausted.

**Default:** 100% of budget (hard stop)

**Example:**

```
[COST] Budget limit reached for Bob! Remaining: $0.00.
[COST] Stopping further API calls for this player.
```

## Database Schema

### budget_events Table

Tracks budget warnings and stops.

```sql
CREATE TABLE budget_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gameId TEXT NOT NULL,
  playerId TEXT NOT NULL,
  eventType TEXT NOT NULL CHECK (eventType IN ('WARNING', 'STOP', 'INFO', 'DEBUG')),
  budgetScope TEXT NOT NULL CHECK (budgetScope IN ('per-player-per-turn', 'per-game-total', 'per-model-per-turn', 'per-model-total')),
  currentUsed REAL NOT NULL,
  "limit" REAL NOT NULL,
  utilizationPct REAL NOT NULL,
  timestamp INTEGER NOT NULL
);
```

### game_events_replay Table

Captures all game events for replay.

```sql
CREATE TABLE game_events_replay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gameId TEXT NOT NULL,
  round INTEGER NOT NULL,
  phase TEXT NOT NULL,
  playerId TEXT,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  content TEXT NOT NULL,
  gameStateSnapshot TEXT,
  timestamp INTEGER NOT NULL
);
```

## Integration Example

### Manual Integration

```javascript
const {
  CostTracker,
  ContextCompressor,
  EventReplay,
} = require("./cost-tracking");

// Initialize
const db = getDatabase();
await initializeSupportingSchema(db);

const costTracker = new CostTracker(db);
const contextCompressor = new ContextCompressor();
const eventReplay = new EventReplay(db);

// Track after API call
const response = await callAI(prompt);
const result = costTracker.trackPlayerTurn("game-123", "player-1", "Alice", {
  phase: "DAY_DISCUSSION",
  promptTokens: response.usage.prompt_tokens,
  completionTokens: response.usage.completion_tokens,
  model: "openai/gpt-4o-mini",
  provider: "openrouter",
  prices: {
    promptPricePerMillion: 0.15,
    completionPricePerMillion: 0.6,
  },
});

if (result.stopTriggered) {
  console.log("Budget exhausted - stop the game");
}

// Compress history before day phase
const compressedHistory = contextCompressor.compressHistory(
  { chatHistory, maxContextChars: 50000 },
  player,
  { priority: "evidence", removeVotingDuplicates: true },
);

// Capture events for replay
eventReplay.captureEvent(
  {
    gameId: "game-123",
    round: 1,
    phase: "DAY_DISCUSSION",
    playerId: "player-1",
    type: "MESSAGE",
    visibility: "PUBLIC",
    content: { message: "hello" },
  },
  gameState,
);

// Get report at game end
const report = costTracker.getCostReport("game-123");
console.log(`Total cost: $${report.totalCost}`);
```

### Automatic Integration

The `MafiaGame` class automatically integrates cost tracking when database is enabled:

```javascript
const game = new MafiaGame({
  enableDatabase: true,
  // Cost tracking is now active!
});

await game.startGame(6);

// Game automatically:
// 1. Tracks costs for each API call
// 2. Enforces budget limits
// 3. Warns at 80% of budget
// 4. Stops at 100% of budget
// 5. Compresses context after night phases
// 6. Captures events for replay
```

## Best Practices

### 1. Set Reasonable Budgets

For a 6-player game:

- **Minimum viable**: $5.00 (expect ~3 rounds)
- **Full gameplay**: $10.00 (expect ~5-7 rounds)
- **Extended play**: $20.00 (expect ~10+ rounds)

### 2. Monitor Usage During Development

Use `.env` warning threshold of 0.70 during development to catch issues early.

### 3. Use Context Compression

Context compression reduces token usage by 30-70% depending on game length.

### 4. Track Cost Trends

Use `getCostTrends()` to identify expensive players or phases.

### 5. Test with Mock Responses

During testing, disable API calls to save costs:

```javascript
process.env.API_KEY = ""; // No API key = mock responses
```

## Estimated Costs

### Per Game (6 Players)

| Model         | Prompt Price | Completion Price | Est. Cost/Game |
| ------------- | ------------ | ---------------- | -------------- |
| gpt-4o-mini   | $0.15/M      | $0.60/M          | $1-5           |
| gpt-3.5-turbo | $0.50/M      | $1.50/M          | $3-15          |
| gpt-4o        | $2.50/M      | $10.00/M         | $15-75         |

### Per Player Turn

Average per turn with gpt-4o-mini: $0.00027 (1000 prompt + 200 completion tokens)

## Troubleshooting

### Issue: "Budget limit reached" immediately

**Solution:** Check your budget limits. If using `.env`, ensure values are formatted correctly:

```bash
# Correct
COST_PER_PLAYER_PER_TURN=0.50

# Incorrect
COST_PER_PLAYER_PER_TURN = 0.50  #Spaces around =
```

### Issue: TotalTokens shows NaN

**Solution:** The cost tracking may not have detected token usage. Check that:

- AI response includes `usage` field
- Token values are numbers, not strings

### Issue: Context compression not working

**Solution:** Ensure `chatHistory` is an array with message objects containing `message` and `player` fields.

### Issue: Event replay fails

**Solution:** Check that database is connected. Event replay requires:

```javascript
const db = await getDatabase();
await initializeSupportingSchema(db);
```

## License

MIT

## Support

For issues, questions, or contributing guidelines, see the project repository.
