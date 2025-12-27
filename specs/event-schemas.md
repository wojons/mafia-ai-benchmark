# Event Schemas

## Overview
All game state changes are recorded as events in an append-only event stream. This enables deterministic replay and full audit trails.

## Event Structure
All events follow this base structure:

```typescript
interface BaseEvent {
  eventType: string;           // Event type identifier
  gameId: string;             // Unique game identifier
  sequence: number;           // Sequential event number (0-based)
  timestamp: number;          // Unix timestamp (ms)
  private?: boolean;          // True if event contains THINK or private info
  payload: Record<string, any>; // Event-specific data
}
```

## Core Event Types

### 1. GAME_CREATED
Emitted when a new game is initialized.

**Schema:**
```typescript
interface GameCreatedEvent extends BaseEvent {
  eventType: 'GAME_CREATED';
  payload: {
    gameId: string;
    seed: number;
    config: {
      players: 10;
      mafia: 3;
      doctor: 1;
      sheriff: 1;
      villagers: 5;
    };
    initialRoles: Array<{
      playerId: string;
      playerName: string;
      role: 'mafia' | 'doctor' | 'sheriff' | 'villager';
    }>;
  };
}
```

**Example:**
```json
{
  "eventType": "GAME_CREATED",
  "gameId": "game-123",
  "sequence": 0,
  "timestamp": 1703774400000,
  "payload": {
    "gameId": "game-123",
    "seed": 12345,
    "config": {
      "players": 10,
      "mafia": 3,
      "doctor": 1,
      "sheriff": 1,
      "villagers": 5
    },
    "initialRoles": [
      {"playerId": "p1", "playerName": "Alice", "role": "villager"},
      {"playerId": "p2", "playerName": "Bob", "role": "mafia"},
      { /* ... */ }
    ]
  }
}
```

### 2. PHASE_CHANGED
Emitted when game phase transitions.

**Schema:**
```typescript
interface PhaseChangedEvent extends BaseEvent {
  eventType: 'PHASE_CHANGED';
  payload: {
    from: 'NIGHT_ACTIONS' | 'MORNING_REVEAL' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'RESOLUTION';
    to: 'NIGHT_ACTIONS' | 'MORNING_REVEAL' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'RESOLUTION' | 'END';
    dayNumber: number;  // Increments after each night
    roundNumber: number;
  };
}
```

**Example:**
```json
{
  "eventType": "PHASE_CHANGED",
  "gameId": "game-123",
  "sequence": 1,
  "timestamp": 1703774401000,
  "payload": {
    "from": "SETUP",
    "to": "NIGHT_ACTIONS",
    "dayNumber": 0,
    "roundNumber": 0
  }
}
```

### 3. NIGHT_ACTION_SUBMITTED
Emitted when an agent submits a night action.

**Schema:**
```typescript
interface NightActionSubmittedEvent extends BaseEvent {
  eventType: 'NIGHT_ACTION_SUBMITTED';
  payload: {
    agentId: string;
    agentName: string;
    actionType: 'KILL' | 'PROTECT' | 'INVESTIGATE';
    targetId: string;
    targetName: string;
  };
}
```

**Example (Mafia):**
```json
{
  "eventType": "NIGHT_ACTION_SUBMITTED",
  "gameId": "game-123",
  "sequence": 2,
  "timestamp": 1703774402000,
  "payload": {
    "agentId": "p2",
    "agentName": "Bob",
    "actionType": "KILL",
    "targetId": "p5",
    "targetName": "Charlie"
  }
}
```

### 4. NIGHT_RESOLVED
Emitted after all night actions are processed.

**Schema:**
```typescript
interface NightResolvedEvent extends BaseEvent {
  eventType: 'NIGHT_RESOLVED';
  payload: {
    nightNumber: number;
    killedPlayerId: string | null;
    killedPlayerName: string | null;
    protectedPlayerId: string | null;
    protectedPlayerName: string | null;
    protectionPreventsKill: boolean;
    investigationResult: {
      sheriffId: string;
      sheriffName: string;
      targetId: string;
      targetName: string;
      isMafia: boolean;
    } | null;
  };
}
```

**Example:**
```json
{
  "eventType": "NIGHT_RESOLVED",
  "gameId": "game-123",
  "sequence": 15,
  "timestamp": 1703774403000,
  "payload": {
    "nightNumber": 1,
    "killedPlayerId": null,
    "killedPlayerName": null,
    "protectedPlayerId": "p5",
    "protectedPlayerName": "Charlie",
    "protectionPreventsKill": true,
    "investigationResult": {
      "sheriffId": "p6",
      "sheriffName": "Sheriff",
      "targetId": "p3",
      "targetName": "Diana",
      "isMafia": true
    }
  }
}
```

### 5. AGENT_THINK_STREAM
Emitted as agent's private reasoning is generated (token-by-token).

**Schema:**
```typescript
interface AgentThinkStreamEvent extends BaseEvent {
  eventType: 'AGENT_THINK_STREAM';
  private: true;  // Always private
  payload: {
    agentId: string;
    agentName: string;
    chunk: string;  // Text chunk (one token or sentence)
    turnId: string;  // Unique ID for this thinking session
  };
}
```

**Example:**
```json
{
  "eventType": "AGENT_THINK_STREAM",
  "gameId": "game-123",
  "sequence": 45,
  "timestamp": 1703774404000,
  "private": true,
  "payload": {
    "agentId": "p2",
    "agentName": "Bob",
    "chunk": "I need to kill someone who seems suspicious to the town but isn't too obvious. ",
    "turnId": "think-night-1-p2"
  }
}
```

### 6. AGENT_SAY_STREAM
Emitted as agent's public statement is generated (token-by-token).

**Schema:**
```typescript
interface AgentSayStreamEvent extends BaseEvent {
  eventType: 'AGENT_SAY_STREAM';
  payload: {
    agentId: string;
    agentName: string;
    chunk: string;
    turnId: string;
  };
}
```

**Example:**
```json
{
  "eventType": "AGENT_SAY_STREAM",
  "gameId": "game-123",
  "sequence": 50,
  "timestamp": 1703774405000,
  "payload": {
    "agentId": "p1",
    "agentName": "Alice",
    "chunk": "I think Bob is acting very suspicious. He defended Charlie too strongly.",
    "turnId": "say-day-1-p1"
  }
}
```

### 7. VOTE_CAST
Emitted when an agent casts a vote (day phase).

**Schema:**
```typescript
interface VoteCastEvent extends BaseEvent {
  eventType: 'VOTE_CAST';
  payload: {
    roundNumber: number;
    voterId: string;
    voterName: string;
    targetId: string;
    targetName: string;
    voteTime: number;  // Time elapsed since voting phase started
  };
}
```

**Example:**
```json
{
  "eventType": "VOTE_CAST",
  "gameId": "game-123",
  "sequence": 70,
  "timestamp": 1703774406000,
  "payload": {
    "roundNumber": 1,
    "voterId": "p1",
    "voterName": "Alice",
    "targetId": "p2",
    "targetName": "Bob",
    "voteTime": 1500
  }
}
```

### 8. VOTE_RESULT
Emitted after voting phase completes.

**Schema:**
```typescript
interface VoteResultEvent extends BaseEvent {
  eventType: 'VOTE_RESULT';
  payload: {
    roundNumber: number;
    eliminatedPlayerId: string | null;
    eliminatedPlayerName: string | null;
    votes: Array<{
      voterId: string;
      voterName: string;
      targetId: string;
      targetName: string;
    }>;
    voteDistribution: Record<string, number>;  // targetId -> count
    majorityReached: boolean;
    tie: boolean;
  };
}
```

**Example:**
```json
{
  "eventType": "VOTE_RESULT",
  "gameId": "game-123",
  "sequence": 75,
  "timestamp": 1703774407000,
  "payload": {
    "roundNumber": 1,
    "eliminatedPlayerId": "p2",
    "eliminatedPlayerName": "Bob",
    "votes": [ /* Array of all votes */ ],
    "voteDistribution": {
      "p2": 4,
      "p3": 2,
      "p4": 2
    },
    "majorityReached": true,
    "tie": false
  }
}
```

### 9. PLAYER_ELIMINATED
Emitted when a player is eliminated (from vote or night kill).

**Schema:**
```typescript
interface PlayerEliminatedEvent extends BaseEvent {
  eventType: 'PLAYER_ELIMINATED';
  payload: {
    playerId: string;
    playerName: string;
    role: 'mafia' | 'doctor' | 'sheriff' | 'villager';
    eliminatedBy: 'vote' | 'night_kill';
    roundNumber: number;
    flipRevealedRole: boolean;  // Role shown to public
  };
}
```

**Example:**
```json
{
  "eventType": "PLAYER_ELIMINATED",
  "gameId": "game-123",
  "sequence": 76,
  "timestamp": 1703774408000,
  "payload": {
    "playerId": "p2",
    "playerName": "Bob",
    "role": "mafia",
    "eliminatedBy": "vote",
    "roundNumber": 1,
    "flipRevealedRole": true
  }
}
```

### 10. GAME_ENDED
Emitted when win conditions are met.

**Schema:**
```typescript
interface GameEndedEvent extends BaseEvent {
  eventType: 'GAME_ENDED';
  payload: {
    winner: 'town' | 'mafia';
    winningPlayers: Array<{
      playerId: string;
      playerName: string;
      role: 'mafia' | 'doctor' | 'sheriff' | 'villager';
    }>;
    finalGameState: {
      dayNumber: number;
      roundNumber: number;
      alivePlayers: Array<string>;
      deadPlayers: Array<string>;
    };
    durationMs: number;
  };
}
```

**Example:**
```json
{
  "eventType": "GAME_ENDED",
  "gameId": "game-123",
  "sequence": 120,
  "timestamp": 1703774500000,
  "payload": {
    "winner": "town",
    "winningPlayers": [ /* Town players */ ],
    "finalGameState": {
      "dayNumber": 3,
      "roundNumber": 5,
      "alivePlayers": ["p1", "p3", "p4", "p7", "p8"],
      "deadPlayers": ["p2", "p5", "p6", "p9", "p10"]
    },
    "durationMs": 100000
  }
}
```

## Event Validation

### Client-side Filtering
Clients can filter based on view mode:

```typescript
function filterEvents(events: Event[], viewMode: 'admin' | 'town' | 'postmortem'): Event[] {
  if (viewMode === 'admin') return events;  // Admin sees all
  return events.filter(event => !event.private || viewMode === 'postmortem');
}
```

### Replay Determinism
For deterministic replay, events must:
- Use same seed for RNG
- Apply events in same sequence
- Ignore timestamp for state reconstruction

```typescript
function replayGame(events: Event[]): GameState {
  let state = initialState;
  for (const event of events.sort((a, b) => a.sequence - b.sequence)) {
    state = applyEvent(state, event);
  }
  return state;
}
```

## Storage Format

### JSONL Export
```javascript
// Export format - one JSON event per line
{ "eventType": "GAME_CREATED", "gameId": "game-123", ... }
{ "eventType": "PHASE_CHANGED", "gameId": "game-123", ... }
{ "eventType": "NIGHT_ACTION_SUBMITTED", "gameId": "game-123", ... }
...
```

### SQLite Schema
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  game_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSON NOT NULL,
  private BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_game_sequence (game_id, sequence)
);
```