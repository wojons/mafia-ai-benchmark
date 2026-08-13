# API Specifications

## Overview

The backend server exposes both REST endpoints for control operations and WebSocket endpoints for real-time event streaming.

## Base URL

```
http://localhost:3004/api
ws://localhost:3004/ws
```

## REST API Endpoints

### Game Management

#### Create New Game

**Endpoint:** `POST /api/v1/games`

**Request:**

```json
{
  "config": {
    "numPlayers": 10,
    "llmProvider": "openai",
    "llmModel": "openai/gpt-4o-mini",
    "nightDuration": 60,
    "dayDuration": 120,
    "votingDuration": 30,
    "roles": [
      { "role": "MAFIA", "count": 3 },
      { "role": "DOCTOR", "count": 1 },
      { "role": "SHERIFF", "count": 1 },
      { "role": "VILLAGER", "count": 5 }
    ]
  },
  "numPlayers": 10
}
```

**Alternative: minimal body (defaults applied):**

```json
{
  "config": {
    "numPlayers": 5
  }
}
```

**Response (200 OK):**

```json
{
  "gameId": "game-123",
  "status": "CREATED",
  "config": {
    "players": 10,
    "mafia": 3,
    "seed": 12345,
    "personaMode": "custom"
  },
  "players": [
    {
      "id": "p1",
      "name": "Suspicious 25",
      "role": "MAFIA",
      "alive": true,
      "persona": {
        "archetype": "Detective",
        "traits": ["Observant", "Analytical", "Skeptical"],
        "communicationStyle": "Clinical",
        "humor": "dry",
        "moralAlignment": "True Neutral",
        "flaw": "Trusting",
        "seed": "suspicious lawyer who questions everyone"
      }
    },
    {
      "id": "p2",
      "name": "Quiet 5",
      "role": "MAFIA",
      "alive": true,
      "persona": {
        "archetype": "Observer",
        "traits": ["Resourceful", "Cautious", "Adaptable"],
        "communicationStyle": "Direct",
        "humor": "quiet",
        "moralAlignment": "Neutral Good",
        "flaw": "Impulsive",
        "seed": "quiet bookstore owner who observes everything"
      }
    }
    // ... other players
  ],
  "links": {
    "self": "/api/v1/games/game-123",
    "stream": "/ws/game-123",
    "export": "/api/v1/games/game-123/export"
  }
}
```

**Validation Rules:**

- `numPlayers`: Must be between 5 and 20
- `mafia`: Must be 20-40% of players, rounded down
- `seed`: Optional random seed (auto-generated if not provided)

---

#### Get Game Status

**Endpoint:** `GET /api/v1/games/:gameId`

**Response (200 OK):**

```json
{
  "id": "game-123",
  "status": "RUNNING",
  "phase": "DAY_VOTING",
  "dayNumber": 2,
  "roundNumber": 4,
  "config": {
    "seed": 12345,
    "players": 10,
    "mafia": 3
  },
  "players": [
    {
      "id": "p1",
      "name": "Alice",
      "role": "villager", // Only shows if authorized
      "alive": true
    }
    // ... all players
  ],
  "aliveCount": 6,
  "deadCount": 4,
  "winner": null, // "town", "mafia", or null if ongoing
  "createdAt": 1703774400000,
  "startedAt": 1703774401000,
  "finishedAt": null
}
```

**Status values:** "CREATED", "RUNNING", "PAUSED", "FINISHED", "CANCELLED"

**Phase values:** "SETUP", "NIGHT_ACTIONS", "MORNING_REVEAL", "DAY_DISCUSSION", "DAY_VOTING", "RESOLUTION", "END"

---

#### List Games

**Endpoint:** `GET /api/v1/games`

**Query Parameters:**

- `limit`: Number of games to return (default: 50, max: 100)
- `offset`: Offset for pagination (default: 0)
- `status`: Filter by status (optional)

**Response (200 OK):**

```json
{
  "games": [
    {
      "id": "game-123",
      "status": "RUNNING",
      "phase": "DAY_DISCUSSION",
      "dayNumber": 2,
      "aliveCount": 6,
      "winner": null,
      "createdAt": 1703774400000
    }
    // ... more games
  ],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

---

### Game Control

#### Start Game

**Endpoint:** `POST /api/v1/games/:gameId/start`

**Response (200 OK):**

```json
{
  "id": "game-123",
  "status": "RUNNING",
  "phase": "NIGHT_ACTIONS",
  "dayNumber": 0,
  "startedAt": 1703774401000
}
```

**Error Cases:**

- `400 Bad Request`: Game already started
- `404 Not Found`: Game ID not found

---

#### Pause Game

**Endpoint:** `POST /api/v1/games/:gameId/pause`

**Request:** (empty body)

**Response (200 OK):**

```json
{
  "id": "game-123",
  "status": "PAUSED",
  "phase": "DAY_VOTING",
  "pausedAt": 1703774500000
}
```

---

#### Resume Game

**Endpoint:** `POST /api/v1/games/:gameId/resume`

**Response (200 OK):**

```json
{
  "id": "game-123",
  "status": "RUNNING",
  "phase": "DAY_VOTING",
  "resumedAt": 1703774501000
}
```

---

#### Execute Single Step

**Endpoint:** `POST /api/v1/games/:gameId/step`

**Response (200 OK):**

```json
{
  "id": "game-123",
  "status": "PAUSED", // Pauses after each step
  "completedStep": {
    "type": "VOTE_RESULT",
    "sequence": 75
  },
  "nextStepAvailable": true
}
```

---

### Game Data

#### Export Event Log

**Endpoint:** `GET /api/v1/games/:gameId/export`

**Query Parameters:**

- `format`: Export format (default: "jsonl", options: "jsonl", "json")

**Response (200 OK):**

For `jsonl` format:

```
{ "eventType": "GAME_CREATED", "gameId": "game-123", ... }
{ "eventType": "PHASE_CHANGED", "gameId": "game-123", ... }
{ "eventType": "NIGHT_ACTION_SUBMITTED", "gameId": "game-123", ... }
...
```

For `json` format:

```json
{
  "gameId": "game-123",
  "events": [
    { "eventType": "GAME_CREATED", ... },
    { "eventType": "PHASE_CHANGED", ... },
    // ... all events
  ]
}
```

**Response Headers:**

- `Content-Type`: `application/jsonl` or `application/json`
- `Content-Disposition`: `attachment; filename="game-123.jsonl"`

---

#### Get Event Stream (Polling)

**Endpoint:** `GET /api/v1/games/:gameId/events`

**Query Parameters:**

- `since`: Starting sequence number (default: 0)
- `includePrivate`: Include private events (default: false, requires admin access)

**Response (200 OK):**

```json
{
  "gameId": "game-123",
  "events": [
    {
      "eventType": "NIGHT_ACTION_SUBMITTED",
      "sequence": 2,
      "timestamp": 1703774402000,
      "private": false,
      "payload": {
        /* event data */
      }
    }
    // ... events since 'since' parameter
  ],
  "nextSequence": 16 // Next sequence number to poll
}
```

**Usage:** Clients can poll this endpoint for events instead of using WebSocket.

---

### Benchmark Report

#### Get Benchmark Report

**Endpoint:** `GET /api/v1/benchmark/report`

**Query Parameters:**

- `gameId`: Optional. Include a per-game detail block for the given game.
- `format`: Optional. `json` (default) or `csv`.

**Response (200 OK):** Top-level payload — NOT wrapped in a `data` field.

```json
{
  "generatedAt": "2026-08-13T00:00:00.000Z",
  "summary": {
    "totalGames": 1058,
    "activeGames": 76,
    "completedGames": 982,
    "mafiaWinRate": 0.1802,
    "avgDuration": 197
  },
  "modelPerformance": [
    {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "gamesPlayed": 511,
      "wins": 0,
      "winRate": 0,
      "avgTokens": 30400,
      "avgCost": 0.0072,
      "avgLatency": 102
    }
  ],
  "agentStats": [
    {
      "agentId": "p1",
      "executions": 122,
      "successes": 122,
      "totalLatency": 13000,
      "totalTokens": 49000000,
      "totalCost": 15.04,
      "provider": "CUSTOM",
      "model": "openai"
    }
  ],
  "recommendations": [
    "Best win rate: openai/gpt-4o-mini (18.0%)",
    "Best value: openai/gpt-4o-mini (win rate per dollar)"
  ]
}
```

**`summary` semantics:** `mafiaWinRate` is the mafia win count over completed games. The winner is derived from the game's `GAME_OVER`-phase event (`data.winner`), falling back to the `games.winner` column.

**`modelPerformance[].wins` / `winRate` semantics (MAF-GAP-039):**

Per-model wins are games the model's side won, attributed from real per-game model participation:

1. `players.won = 1` rows — explicit per-player win flags.
2. Side attribution — a player row's `is_mafia` compared to the game winner (`games.winner`, falling back to the `GAME_OVER` event winner — the same derivation as `summary.mafiaWinRate`): the model's side won iff `is_mafia = 1` and MAFIA won, or `is_mafia = 0` and TOWN won. A game counts at most once per model.

`winRate = wins / gamesPlayed`. `wins` is **0 when unattributable** — legacy usage-only games (e.g. `token_usage` rows with `player_id = 'ALL'`) record real usage but no side/role data, so their wins are never guessed. A row with `gamesPlayed > 0` and `wins = 0` therefore means "no attributable wins," not "lost every game." Game-level winners are never assigned to every model in a game, and one row per model string is guaranteed (provider-prefixed spellings are normalized).

**`agentStats[]`:** per-agent execution aggregates (`executions`, `successes`, totals). Rows with zero executions legitimately show `totalLatency: 0`.

---

## WebSocket API

### Connection

**Endpoint:** `ws://localhost:3004/ws/:gameId`

**Protocol:** WebSocket with JSON message format

**Authentication:** None (local development only)

**Connection Flow:**

```
Client → Server: { "type": "SUBSCRIBE", "gameId": "game-123" }
Server → Client: { "type": "SUBSCRIBED", "sequence": 15 }
Server → Client: [...stream of events...]
```

**Error Handling:**

- Invalid gameId: Connection closed with 1008 error
- Game not found: Connection closed with 1008 error

---

### Message Types

#### Subscribe to Game (Client → Server)

```json
{
  "type": "SUBSCRIBE",
  "gameId": "game-123",
  "viewMode": "admin" // Optional: "admin", "town", "postmortem"
}
```

#### Subscribed Confirmation (Server → Client)

```json
{
  "type": "SUBSCRIBED",
  "gameId": "game-123",
  "sequence": 15, // Last event sequence number
  "gameStatus": {
    "phase": "DAY_DISCUSSION",
    "dayNumber": 2,
    "aliveCount": 6
  }
}
```

#### Event Messages (Server → Client)

```json
{
  "type": "EVENT",
  "event": {
    "eventType": "NIGHT_ACTION_SUBMITTED",
    "sequence": 16,
    "timestamp": 1703774402000,
    "private": false,
    "payload": {
      /* event data */
    }
  }
}
```

**Note:** Private events are only sent if `viewMode === 'admin'`.

#### Heartbeat (Server → Client)

```json
{
  "type": "HEARTBEAT",
  "sequence": 20,
  "gameStatus": {
    "phase": "DAY_DISCUSSION",
    "aliveCount": 6
  }
}
```

Sent every 30 seconds if no events. Client can assume connection is alive.

---

### Reconnection Strategy

**Problem:** Temporary disconnections cause event loss

**Solution 1:** Event sequence buffering

- Server buffers last 100 events in memory
- On reconnect, client sends last known sequence
- Server replays missing events

**Solution 2:** Resume from last snapshot (optional)

- Client stores last snapshot + sequence
- Reconnect with snapshot and sequence
- Server sends events since snapshot

**Client reconnect logic:**

```typescript
// On disconnect, attempt reconnection
let lastSequence = getLastEventSequence();

function reconnect() {
  const ws = new WebSocket(`ws://localhost:3004/ws/${gameId}`);

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "SUBSCRIBE",
        gameId,
        since: lastSequence, // Request events since this sequence
        viewMode: "admin",
      }),
    );
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "EVENT") {
      lastSequence = message.event.sequence;
      processEvent(message.event);
    }
  };

  ws.onclose = () => {
    setTimeout(reconnect, 5000); // Reconnect after 5 seconds
  };
}
```

---

## Error Responses

### HTTP Error Standard

All errors follow this response format:

```json
{
  "error": {
    "code": "GAME_NOT_FOUND",
    "message": "Game with ID 'game-999' was not found",
    "statusCode": 404,
    "details": {}
  }
}
```

### Error Codes

#### 400 Bad Request

- `INVALID_CONFIGURATION`: Game config validation failed
- `GAME_ALREADY_STARTED`: Game cannot be modified after start
- `INVALID_GAME_STATE`: Operation not allowed in current game state

#### 404 Not Found

- `GAME_NOT_FOUND`: Game ID does not exist
- `PLAYER_NOT_FOUND`: Player ID does not exist

#### 409 Conflict

- `GAME_LOCKED`: Game is being modified by another operation
- `DUPLICATE_ACTION`: Action already submitted

#### 503 Service Unavailable

- `ENGINE_BUSY`: Game engine temporarily unavailable
- `TOO_MANY_GAMES`: Server at capacity

---

## Rate Limiting

**WebSocket Connections:**

- Max 100 concurrent connections per IP
- Connection idle timeout: 60 minutes

**REST API:**

- GET/POST /api/v1/games: 10 requests/second per IP
- Other endpoints: 100 requests/minute per IP

---

## CORS Configuration

Development:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
```

Production (when deployed):

- Origin restricted to specific domains
- Credentials may be required for authentication
