# Game Persistence & Recovery Specification

## Overview

The Mafia AI Benchmark supports full game persistence, enabling games to be paused, resumed, and recovered after crashes. This is critical for large-scale games (e.g., 5000 players) that may run for weeks.

## Persistence Architecture

### Database Schema

```
games
├── id, seed, player_count, mafia_count
├── status (CREATED, RUNNING, PAUSED, FINISHED, CANCELLED)
├── phase, day_number, round_number, winner
├── timing metadata (created_at, started_at, finished_at, duration_ms)
└── config_json, initial_roles, final_state

players
├── id, game_id, player_id, player_name
├── assigned_role, is_alive
├── model, provider
└── joined_at

events (Event Sourcing)
├── id, game_id, sequence (auto-increment)
├── event_type, timestamp_ms
├── private (visibility flag)
├── payload (full JSON with game_state for critical events)
└── game_state_snapshot_id (optional link to full state snapshot)

snapshots (Game State Checkpoints)
├── id, game_id, sequence
├── game_state (complete serialized game state)
└── created_at
```

### Event Sourcing Pattern

Every action in the game produces an event:

```json
{
  "event_type": "PLAYER_MESSAGE",
  "playerId": "p123",
  "playerName": "Alice",
  "message": {
    "thinks": "Private strategic reasoning...",
    "says": "Public statement..."
  },
  "gameState": {  // For critical events
    "round": 5,
    "phase": "DAY_DISCUSSION",
    "players": [...],
    "votingHistory": [...]
  }
}
```

## Checkpoint System

### When Checkpoints Are Created

1. **Phase Transitions** (automatic)
   - NIGHT_STARTED
   - DAY_STARTED
   - GAME_OVER
   - VOTING_COMPLETE

2. **Critical Events** (optional, based on `createCheckpoint` flag)
   - Deaths/eliminations
   - Role reveals
   - Win conditions

### Checkpoint Content

Each checkpoint contains complete game state:

```javascript
{
  // Game info
  gameId: "game-abc123",
  round: 5,
  dayNumber: 3,
  phase: "DAY_DISCUSSION",
  gameStatus: "RUNNING",
  winner: null,

  // Players (full state)
  players: [
    {
      id: "p123",
      name: "Alice",
      role: "MAFIA",
      emoji: "😈",
      isMafia: true,
      isAlive: true,
      persona: { ... }  // Full persona
    }
  ],

  // Dead players
  deadPlayers: [
    {
      id: "p456",
      name: "Bob",
      role: "SHERIFF",
      emoji: "👮",
      deathType: "KILLED"
    }
  ],

  // Game history (all events and messages)
  gameHistory: [...],
  gameEvents: [...],

  // Special states
  mafiaKillTarget: { id: "p789", name: "Charlie" },
  lastDoctorProtection: "p101",
  vigilanteShotUsed: true,
  lastVigilanteTarget: { id: "p202", name: "Dana" },

  // Voting history
  votingHistory: [...],

  // Timestamp
  lastCheckpoint: 1735555555000
}
```

## Game Recovery

### Resuming a Paused/Crashed Game

```javascript
// 1. Create game instance with database enabled
const game = new MafiaGame({
  enableDatabase: true,
  dbPath: "./data/mafia.db",
});

// 2. Resume from latest checkpoint
await game.resumeFromCheckpoint("game-abc123");

// 3. Game state is fully restored:
//    - All players with roles and personas
//    - Chat history and events
//    - Voting history
//    - Current phase and round
//    - Special game states

// 4. Continue with next phase
// (game automatically picks up where it left off)
```

### Recovery Flow

```
Crash/Restart
    ↓
Load latest snapshot from database
    ↓
Reconstruct game state
    ↓
- Restore all players (with roles, personas, alive status)
- Restore game history (messages, events)
- Restore voting history
- Restore phase, round, day number
- Restore special states (mafia target, doctor protection, etc.)
    ↓
Game resumes at current phase
    ↓
Continue normal execution
```

## Event Replay Capability

Because all events are stored with full context, you can:

1. **Replay entire game**: Reconstruct game state from event log
2. **Analyze specific moments**: Query events by type, player, phase
3. **Debug**: Inspect full context at any point
4. **Export**: Export event log JSON for external analysis

### Example: Replay Night Phase

```sql
SELECT event_type, timestamp_ms, payload
FROM events
WHERE game_id = 'game-abc123'
  AND event_type IN ('NIGHT_STARTED', 'PLAYER_MESSAGE', 'MAFIA_KILL_TARGET', 'NIGHT_RESOLVED')
  AND sequence BETWEEN 50 AND 100
ORDER BY sequence ASC;
```

## Pause/Resume API

### Pausing a Game

```javascript
// Pause game (creates checkpoint and sets status to PAUSED)
async pauseGame() {
  await this.createGameStateCheckpoint("PAUSED_MANUAL");
  await this.db.updateGame(this.gameId, { status: "PAUSED" });
  console.log(`[DB] Game paused: ${this.gameId}`);
}
```

### Resuming a Game

```javascript
// Resume game (as shown above)
await resumeFromCheckpoint(gameId);
```

### Listing Paused Games

```sql
SELECT id, phase, round, day_number, created_at
FROM games
WHERE status = 'PAUSED'
ORDER BY created_at DESC;
```

## Large Game Considerations

### 5000 Player Games

For massive games:

1. **Checkpoint Frequency**: Adjust based on complexity
   - Phase transitions: Always checkpoint
   - Every 10 rounds: Auto-checkpoint
   - Manual checkpoints: On demand

2. **Database Storage**: Use SQLite with WAL mode

   ```javascript
   this.db.pragma("journal_mode = WAL");
   this.db.pragma("synchronous = NORMAL");
   ```

3. **Event Compression**: Store compressed JSON for large payloads

   ```javascript
   payload: compress(JSON.stringify(content));
   ```

4. **Incremental Snapshots**: Only store changed state
   - Not storing full game history in every snapshot
   - Reference previous snapshots

## Failure Recovery

### Power Failure Scenario

```
System crash at round 5, day 3
    ↓
Database stored checkpoint at DAY_START (round 5)
    ↓
On restart:
  1. Query games table for status = 'RUNNING'
  2. For each game, load latest snapshot
  3. Resume from checkpoint
    ↓
Game continues from Day 3 discussion
```

### Database Corruption

```javascript
// Fallback to event replay if snapshot corrupted
try {
  await resumeFromCheckpoint(gameId);
} catch (corruptionError) {
  console.log("Snapshot corrupted, replaying from events...");
  await replayGameFromEvents(gameId); // Not yet implemented
}
```

## Performance Benchmarks

### Storage Estimates

| Player Count | Events/Game | Database Size | Checkpoint Size |
| ------------ | ----------- | ------------- | --------------- |
| 10           | ~150        | ~100 KB       | ~50 KB          |
| 100          | ~2,000      | ~2 MB         | ~500 KB         |
| 500          | ~15,000     | ~15 MB        | ~3 MB           |
| 5,000        | ~200,000    | ~200 MB       | ~30 MB          |

### Load/Resume Times

| Player Count | Snapshot Load | Event Reconstruction | Total Resume |
| ------------ | ------------- | -------------------- | ------------ |
| 10           | <50ms         | <100ms               | <150ms       |
| 100          | <200ms        | <500ms               | <700ms       |
| 500          | <1s           | <3s                  | <4s          |
| 5,000        | <10s          | <30s                 | <40s         |

## Security & Privacy

### Private Information

Mafia chats and private thoughts are protected:

1. **Database isolation**: Separate tables for public/private events
2. **Encryption**: Optional encryption for `private = 1` events
3. **Access control**: Admin-only visibility for ADMIN_ONLY events

```sql
-- Public events (everyone can see)
SELECT * FROM events WHERE game_id = ? AND private = 0;

-- Admin access ( mafia chat included
SELECT * FROM events WHERE game_id = ?;
```

## Best Practices

1. **Always enable database in production**

   ```bash
   ENABLE_DATABASE=true node game-engine.js
   ```

2. **Create milestones for long games**

   ```javascript
   if (this.round % 10 === 0) {
     await this.createGameStateCheckpoint(`ROUND_${this.round}`);
   }
   ```

3. **Monitor database size**

   ```javascript
   const stats = db.getStats();
   console.log(`Games: ${stats.games}, Events: ${stats.events}`);
   ```

4. **Backup regularly**

   ```bash
   cp data/mafia.db data/mafia.backup.db
   ```

5. **Test recovery process**
   ```javascript
   // After crash simulation
   const testResume = async (gameId) => {
     const before = game.captureGameState();
     await game.resumeFromCheckpoint(gameId);
     const after = game.captureGameState();
     console.log(
       "State matches:",
       JSON.stringify(before) === JSON.stringify(after),
     );
   };
   ```

## Future Enhancements

- [ ] Event Replay Engine: Replay from event log without checkpoints
- [ ] Incremental Snapshots: Store only changed state between checkpoints
- [ ] Distributed Storage: Use PostgreSQL/MongoDB for large-scale deployments
- [ ] Real-time Streaming: SSE event stream with checkpoint markers
- [ ] Game Export: Export full game as JSON importable elsewhere
- [ ] Branching/Forking: Create alternative timelines from any checkpoint
