# API Specifications

## Overview
The backend server exposes both REST endpoints for control operations and WebSocket endpoints for real-time event streaming.

## Base URL
```
http://localhost:3000/api
ws://localhost:3000/ws
```

## REST API Endpoints

### Game Management

#### Create New Game
**Endpoint:** `POST /api/games`

**Request:**
```json
{
  "players": 10,
  "mafia": 3,
  "seed": 12345,
  "mode": "scripted",  // "scripted" or "llm"
  "playerNames": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Iris", "Jack"]
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
    "seed": 12345
  },
  "players": [
    {
      "id": "p1",
      "name": "Alice",
      "role": "villager",
      "alive": true
    }
    // ... other players
  ],
  "links": {
    "self": "/api/games/game-123",
    "stream": "/ws/game-123",
    "export": "/api/games/game-123/export"
  }
}
```

**Validation Rules:**
- `players`: Must be even number, minimum 6, maximum 20
- `mafia`: Must be 20-40% of players, rounded down
- `seed`: Optional random seed (auto-generated if not provided)
- `mode`: Must be "scripted" or "llm"

---

#### Get Game Status
**Endpoint:** `GET /api/games/:gameId`

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
      "role": "villager",  // Only shows if authorized
      "alive": true
    }
    // ... all players
  ],
  "aliveCount": 6,
  "deadCount": 4,
  "winner": null,  // "town", "mafia", or null if ongoing
  "createdAt": 1703774400000,
  "startedAt": 1703774401000,
  "finishedAt": null
}
```

**Status values:** "CREATED", "RUNNING", "PAUSED", "FINISHED", "CANCELLED"

**Phase values:** "SETUP", "NIGHT_ACTIONS", "MORNING_REVEAL", "DAY_DISCUSSION", "DAY_VOTING", "RESOLUTION", "END"

---

#### List Games
**Endpoint:** `GET /api/games`

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
**Endpoint:** `POST /api/games/:gameId/start`

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
**Endpoint:** `POST /api/games/:gameId/pause`

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
**Endpoint:** `POST /api/games/:gameId/resume`

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
**Endpoint:** `POST /api/games/:gameId/step`

**Response (200 OK):**
```json
{
  "id": "game-123",
  "status": "PAUSED",  // Pauses after each step
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
**Endpoint:** `GET /api/games/:gameId/export`

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
**Endpoint:** `GET /api/games/:gameId/events`

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
      "payload": { /* event data */ }
    }
    // ... events since 'since' parameter
  ],
  "nextSequence": 16  // Next sequence number to poll
}
```

**Usage:** Clients can poll this endpoint for events instead of using WebSocket.

---

## WebSocket API

### Connection

**Endpoint:** `ws://localhost:3000/ws/:gameId`

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
  "viewMode": "admin"  // Optional: "admin", "town", "postmortem"
}
```

#### Subscribed Confirmation (Server → Client)
```json
{
  "type": "SUBSCRIBED",
  "gameId": "game-123",
  "sequence": 15,  // Last event sequence number
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
    "payload": { /* event data */ }
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
  const ws = new WebSocket(`ws://localhost:3000/ws/${gameId}`);
  
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'SUBSCRIBE',
      gameId,
      since: lastSequence,  // Request events since this sequence
      viewMode: 'admin'
    }));
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'EVENT') {
      lastSequence = message.event.sequence;
      processEvent(message.event);
    }
  };
  
  ws.onclose = () => {
    setTimeout(reconnect, 5000);  // Reconnect after 5 seconds
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
- GET/POST /api/games: 10 requests/second per IP
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