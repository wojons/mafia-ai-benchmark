# Mafia AI Benchmark - Production Server Specifications

## Overview
Production-ready HTTP/WebSocket server for the Mafia AI Benchmark system. Provides REST API for game management, SSE for event streaming, and integrates with the game engine.

## Server Configuration

| Setting | Value | Env Var |
|---------|-------|---------|
| HTTP Port | 3000 | `PORT` |
| WebSocket Port | 3001 | `WS_PORT` |
| Data Directory | `./data` | `DATA_DIR` |
| Database | SQLite | - |

---

## API Endpoints

### Health & Info

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |
| GET | `/api/v1` | API version and available endpoints |

### Games

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/games` | List all games |
| POST | `/api/v1/games` | Create a new game |
| GET | `/api/v1/games/:gameId` | Get game details |
| POST | `/api/v1/games/:gameId/start` | Start the game |
| POST | `/api/v1/games/:gameId/stop` | Stop the game |

### Players

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/games/:gameId/players` | List players in game |
| POST | `/api/v1/games/:gameId/players` | Add player to game |
| DELETE | `/api/v1/games/:gameId/players/:playerId` | Remove player |
| POST | `/api/v1/games/:gameId/players/:playerIndex/model` | Set player's LLM model |

### Roles

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/games/:gameId/role/:role/model` | Set model for a specific role |

### Bulk Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/games/:gameId/models/bulk` | Bulk configure models |

### Models & Pricing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/models/pricing?model=` | Get pricing for a model |
| POST | `/api/v1/models/calculate-cost` | Calculate cost for tokens |
| GET | `/api/v1/models` | List available models |

### Statistics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/stats` | Server statistics |
| GET | `/api/v1/games/:gameId/stats` | Game-specific statistics |
| GET | `/api/v1/players/:playerId/stats` | Player statistics |

### Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/games/:gameId/events` | SSE stream for game events |
| GET | `/api/v1/games/:gameId/sse-status` | SSE connection status |

---

## WebSocket API

### Connection
```
ws://localhost:3001/ws?gameId=:gameId
```

### Client → Server Messages

| Type | Payload | Description |
|------|---------|-------------|
| `subscribe` | `{ type: 'subscribe', gameId: string }` | Subscribe to game events |
| `unsubscribe` | `{ type: 'unsubscribe', gameId: string }` | Unsubscribe |
| `action` | `{ type: 'action', action: string, target?: string }` | Player action |

### Server → Client Messages

| Type | Payload | Description |
|------|---------|-------------|
| `connected` | `{ type: 'connected', gameId: string }` | Connection established |
| `game_phase_change` | `{ type: 'game_phase_change', phase: string }` | Phase changed |
| `player_action` | `{ type: 'player_action', playerId: string, action: string }` | Player acted |
| `game_event` | `{ type: 'game_event', event: GameEvent }` | Game event |

---

## Request/Response Formats

### Game Creation Request
```json
{
  "gameId": "game-123",
  "config": {
    "players": 5,
    "dayDurationSeconds": 60,
    "nightDurationSeconds": 30,
    "roles": ["MAFIA", "DOCTOR", "SHERIFF", "VIGILANTE", "VILLAGER"]
  }
}
```

### Game Creation Response
```json
{
  "success": true,
  "data": {
    "id": "game-123",
    "status": "SETUP",
    "createdAt": "2025-12-28T03:00:00.000Z",
    "config": { ... },
    "players": []
  }
}
```

### Player Model Request
```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "maxTokens": 1000
}
```

### Pricing Response
```json
{
  "success": true,
  "data": {
    "modelId": "gpt-4o-mini",
    "inputPerMillion": 0.15,
    "outputPerMillion": 0.60,
    "hasPricing": true,
    "source": "api"
  }
}
```

### Calculate Cost Response
```json
{
  "success": true,
  "data": {
    "modelId": "gpt-4o-mini",
    "inputTokens": 15000,
    "outputTokens": 5000,
    "costPerMillion": 0.75,
    "totalCost": 0.015,
    "formatted": "$0.0150",
    "hasPricing": true
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Game not found"
  }
}
```

---

## SSE Event Format

```
data: {"type":"connected","gameId":"game-123","timestamp":"2025-12-28T03:00:00.000Z"}

data: {"type":"game_phase_change","gameId":"game-123","phase":"NIGHT","timestamp":"..."}

data: {"type":"player_action","gameId":"game-123","playerId":"p1","action":"VOTE","targetId":"p3"}

: keepalive
```

---

## Pricing Models

### Fallback Pricing (Common Models)

| Model | Input ($/M) | Output ($/M) |
|-------|-------------|--------------|
| gpt-4o-mini | 0.15 | 0.60 |
| gpt-4o | 2.50 | 10.00 |
| claude-sonnet-4-20250514 | 3.00 | 15.00 |
| claude-haiku-4-20250514 | 0.25 | 1.25 |
| gemini-2.5-flash-exp | 0.075 | 0.30 |
| deepseek-chat | 0.28 | 0.42 |

### No Pricing Marker
Models without pricing: `NO_PRICING_MARKER = -6.66`

---

## Game States

| State | Description |
|-------|-------------|
| `SETUP` | Game created, waiting for players |
| `IN_PROGRESS` | Game started |
| `PAUSED` | Game paused |
| `ENDED` | Game completed |
| `CANCELLED` | Game cancelled |

## Game Phases

| Phase | Description |
|-------|-------------|
| `DAY` | Discussion and voting |
| `NIGHT` | Role actions |
| `TRANSITION` | Phase change processing |

---

## Expected Behaviors

### Game Creation
- Auto-generates gameId if not provided
- Returns 201 on success
- Stores game in SQLite database

### Player Addition
- Assigns sequential player indices
- Validates model configuration
- Returns 400 for invalid configs

### Pricing
- Checks fallback pricing first
- Falls back to models.dev API
- Returns -6.66 for unknown models

### SSE
- Sends `connected` event on connection
- Sends keepalive every 30 seconds
- Automatically cleans up disconnected clients

---

## Testing Requirements

### Unit Tests
- [ ] EventBus publish/subscribe
- [ ] Game state transitions
- [ ] Cost calculations
- [ ] Model provider adapters

### Integration Tests
- [ ] All HTTP endpoints
- [ ] SSE connection and events
- [ ] Game creation flow
- [ ] Model configuration
- [ ] Pricing calculations

### CLI Tests
- [ ] `mafiactl games list`
- [ ] `mafiactl games create`
- [ ] `mafiactl games start`
- [ ] `mafiactl stats`
- [ ] `mafiactl benchmark`

---

## Performance Requirements

- API response time: < 100ms
- SSE latency: < 50ms
- Concurrent games: 100+
- Concurrent SSE connections: 1000+
- Memory usage: < 500MB

---

## Error Codes

| Code | Description |
|------|-------------|
| `INTERNAL_ERROR` | Server error |
| `NOT_FOUND` | Resource not found |
| `INVALID_REQUEST` | Bad request |
| `UNAUTHORIZED` | Authentication required |
| `GAME_NOT_FOUND` | Game doesn't exist |
| `PLAYER_NOT_FOUND` | Player doesn't exist |
| `INVALID_MODEL` | Invalid model configuration |
