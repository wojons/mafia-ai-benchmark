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

**Response (201 Created):**

The default creation path runs the LEGACY game engine; the response is an
acknowledgment, not the full game object (realigned to the live API,
MAF-GAP-073):

```json
{
  "success": true,
  "data": {
    "gameId": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
    "status": "starting",
    "config": {
      "engineType": "legacy",
      "numPlayers": 5
    }
  }
}
```

Body fields (all optional): `numPlayers` (default 5), `personaSeeds`,
`config` (legacy engine config), `roleModels` (or `config.roleModels` /
`models` — per-role model overrides). When the legacy adapter is unavailable
the server falls back to the standard engine and returns
`{ success: true, data: { gameId, status, config } }`.

The full game (players, roles, state) is read afterwards via
`GET /api/v1/games/:gameId`. There is no `links` object on the live response.

---

#### Get Game Status

**Endpoint:** `GET /api/v1/games/:gameId`

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "game-123",
    "status": "ENDED",
    "winner": "TOWN",
    "config": {
      "numPlayers": 5,
      "engineType": "legacy",
      "winner": "TOWN"
    },
    "createdAt": "2026-08-25T16:27:48.540Z",
    "endedAt": "2026-08-25T16:30:02.132Z",
    "currentState": {
      "phase": "GAME_OVER",
      "dayNumber": 1,
      "turnNumber": 1,
      "timeRemaining": 0,
      "activePlayers": ["p2", "p3"],
      "eliminatedPlayers": ["p1"],
      "votes": [],
      "nightActions": []
    },
    "players": [
      {
        "id": "p1",
        "name": "Alice",
        "role": "MAFIA",
        "isAlive": false,
        "isMafia": true,
        "joinOrder": 0,
        "won": 0,
        "provider": "openai",
        "model": "openai/gpt-4o-mini",
        "tokensUsed": 11539,
        "apiCalls": 1
      }
      // ... all players
    ],
    "events": [
      {
        "id": "evt-1",
        "gameId": "game-123",
        "type": "GAME_STARTED",
        "timestamp": "2026-08-25T16:28:22.463Z",
        "visibility": "PUBLIC",
        "actorId": null,
        "targetId": null,
        "data": {},
        "metadata": {}
      }
      // ... game events
    ]
  }
}
```

**Field availability notes (realigned to the live API):**

- `winner` is emitted only when the game has a decided outcome ("TOWN" | "MAFIA"); running/undecided games omit it. The same result also lives at `config.winner` (legacy engine writes it on completion).
- `endedAt` is present only on ended games; `createdAt` is an ISO-8601 string, not epoch millis.
- Per-player `provider`/`model`/`tokensUsed`/`apiCalls` are attached for completed games (MAF-GAP-029); `won` (1 = winning side, 0 = losing side) is attached when the game has a decided winner (MAF-GAP-056).
- `currentState.phase` for ended games is `GAME_OVER`; `currentState` for running games carries the live FSM state.
- `aliveCount`/`deadCount`/`startedAt`/`finishedAt`/`roundNumber` are NOT part of the live payload — alive/dead players are derived from `players[].isAlive` + `currentState.eliminatedPlayers`.

**Status values:** "SETUP", "IN_PROGRESS", "PAUSED", "ENDED", "CANCELLED" (legacy games map RUNNING → "IN_PROGRESS", everything else → "ENDED")

**Phase values:** "SETUP", "NIGHT_ACTIONS", "MORNING_REVEAL", "DAY_DISCUSSION", "DAY_VOTING", "RESOLUTION", "END", "GAME_OVER"

---

#### List Games

**Endpoint:** `GET /api/v1/games`

**Query Parameters:**

- `limit`: Number of games to return (default: 50, max: 100)
- `offset`: Offset for pagination (default: 0)
- `status`: Filter by status (optional; one of "SETUP", "IN_PROGRESS", "PAUSED", "ENDED", "CANCELLED"; any other value → 400)

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": "game-123",
      "status": "ENDED",
      "players": 5,
      "createdAt": "2026-08-25T16:27:48.540Z",
      "config": {
        "numPlayers": 5,
        "engineType": "legacy",
        "winner": "TOWN"
      }
    }
    // ... more games
  ],
  "count": 2
}
```

**Notes (realigned to the live API):**

- List rows are SUMMARY objects — `players` is the player COUNT (number), not an array; there is no `phase`/`dayNumber`/`aliveCount`/`winner` field at list level (those live on the detail endpoint under `currentState` / top-level `winner`).
- `config` carries the same shape as the detail endpoint's config; `config.winner` is present on ended games.
- `createdAt` is an ISO-8601 string, not epoch millis. The envelope is `{success, data, count}` — there is no `total`/`limit`/`offset` echo.

---

### Game Control (POST /api/v1/games/:gameId/... — realigned MAF-GAP-073)

The live server has NO pause/resume/step control routes — the previously
documented `POST /api/v1/games/:gameId/{pause,resume,step}` routes do not
exist in the route table (no `game-pause`/`game-resume`/`game-step` events are
emitted anywhere in the server). Game lifecycle is controlled by
`start` + legacy-engine `stop` only.

#### Start Game

**Endpoint:** `POST /api/v1/games/:gameId/start`

**Request Body:** None.

**Response (200 OK):**

```json
{
  "success": true,
  "data": { "eventId": "evt-uuid-or-null" }
}
```

**Error Cases:**

- `400 Bad Request`: `{ "success": false, "error": "<engine reason>" }` (game already started, etc.)
- `500 Internal Server Error`: `{ "success": false, "error": "Failed to start game" }`

#### Join Game

**Endpoint:** `POST /api/v1/games/:gameId/join`

**Request Body:**

```json
{ "playerName": "Alice", "agentConfig": { /* optional */ } }
```

**Response (201 Created):**

```json
{ "success": true, "data": { "eventId": "evt-uuid-or-null" } }
```

**Error Cases:** `400` (engine rejects — game full, already started, name taken) with the engine's error string; `500` with `"Failed to join game"`.

#### Stop a Legacy Game

**Endpoint:** `POST /api/v1/legacy-games/:gameId/stop`

**Request Body:** None.

**Response (200 OK):**

```json
{ "success": true, "data": { "gameId": "1692df5c...", "stopped": true } }
```

`success` mirrors the adapter's boolean stop result. When the legacy engine
is not available the route answers `503` with
`{ "success": false, "error": "Legacy engine not available" }`.

#### Get Game State

**Endpoint:** `GET /api/v1/games/:gameId/state`

Returns the in-memory engine state for a game the standard (non-legacy)
engine owns.

**Response (200 OK):** `{ "success": true, "data": <GameFsmState> }` — for
ended games this is the `currentState` object documented under
[Get Game Status](#get-game-status):

```json
{
  "success": true,
  "data": {
    "phase": "GAME_OVER",
    "dayNumber": 0,
    "turnNumber": 27,
    "timeRemaining": 0,
    "activePlayers": ["p1", "p2", "p3", "p4"],
    "eliminatedPlayers": ["p5"],
    "votes": [],
    "nightActions": []
  }
}
```

**Error Cases:** `404` (`"Game not found"`), `500` (`"Failed to get game state"`).

---

### Game Data

---

#### Get Event Stream (Polling / SSE)

**Endpoint:** `GET /api/v1/games/:gameId/events`

**Query Parameters:**

- `visibility`: Event filter (default: `"all"`, options: `"all"`, `"public"`, `"private"`, `"admin"`)

**Response (200 OK):** Realigned to the live payload (MAF-GAP-073) — full
event objects under `data`, no `nextSequence` polling contract:

```json
{
  "success": true,
  "data": [
    {
      "id": "48cdd612-bd4d-4b33-a334-b521dd1ede02",
      "gameId": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
      "type": "GAME_STARTED",
      "timestamp": "2026-09-26T10:11:10.745Z",
      "visibility": "ADMIN",
      "actorId": null,
      "targetId": null,
      "data": { "legacyType": "STATE_CHANGE", "status": "STARTED", "playerCount": 5, "playerName": null },
      "metadata": { "turnNumber": 1, "dayNumber": 0, "phase": "SETUP", "sequence": 1 }
    }
    // ... all events for the game
  ],
  "count": 27
}
```

**SSE streaming:** When the request carries `Accept: text/event-stream`, the
same route switches to a Server-Sent-Events stream
(`Content-Type: text/event-stream`): an initial
`data: {"type":"connected","gameId":...,"timestamp":...}` frame, then one
`data: <event JSON>` frame per published event, with `: keepalive` comments
every 30s. The number of live SSE subscribers per game is exposed at
`GET /api/v1/games/:gameId/sse-status`.

---

### Benchmark Report

#### Benchmark Run Lifecycle

Managed benchmark runs are started through the API, persisted in the
`benchmark_runs` / `benchmark_games` tables, and progressed through the status
vocabulary `QUEUED → RUNNING → COMPLETED | CANCELLED | FAILED`. All timestamps
(`createdAt`, `completedAt`) are **epoch milliseconds** (numbers), not ISO strings.

##### Start a Benchmark Run

**Endpoint:** `POST /api/v1/benchmark`

**Request Body:** Optional. `{ config: {...} }` where the config accepts:

- `models`: Required (in the config). Array of at least 2 unique, non-empty model
  strings (provider-prefixed, e.g. `openai/gpt-4o-mini`). Duplicates are rejected.
- `gamesPerPairing`: Optional. Positive integer (floored). Default `2`.
- `numPlayers`: Optional. Integer ≥ 5 (floored). Default `10`.
- `temperature`: Optional. Number. Default `0.7`.

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "runId": "d2953e1e-8a81-4714-b37c-4640f6cc331b",
    "totalGames": 1,
    "pairings": [
      {
        "id": "openai/gpt-4o-mini__vs__openai/gpt-4o",
        "modelA": "openai/gpt-4o-mini",
        "modelB": "openai/gpt-4o",
        "games": 1
      }
    ],
    "message": "Benchmark started with 1 game(s)"
  }
}
```

**Errors:**

- `500` — benchmark failed to start (invalid config, launch failure):

```json
{
  "success": false,
  "error": "Failed to start benchmark: Benchmark config must include at least 2 models"
}
```

##### List Benchmark Runs

**Endpoint:** `GET /api/v1/benchmark/runs`

**Response (200 OK):** All runs, most recent first. Each entry carries the run's
full status record.

```json
{
  "success": true,
  "data": [
    {
      "runId": "d2953e1e-8a81-4714-b37c-4640f6cc331b",
      "status": "RUNNING",
      "config": {
        "models": ["openai/gpt-4o-mini", "openai/gpt-4o"],
        "gamesPerPairing": 1,
        "numPlayers": 10,
        "temperature": 0.7
      },
      "createdAt": 1787446562060,
      "completedAt": null,
      "summary": null,
      "error": null,
      "totalGames": 1
    },
    {
      "runId": "126203e9-bf8f-4dd3-938e-40d6d81f868f",
      "status": "COMPLETED",
      "config": {
        "models": ["openai/gpt-4o-mini", "openai/gpt-4o"],
        "gamesPerPairing": 1,
        "numPlayers": 10,
        "temperature": 0.7
      },
      "createdAt": 1788305422363,
      "completedAt": 1788305684792,
      "summary": null,
      "error": null,
      "totalGames": 1
    }
  ]
}
```

**Field notes:**

- `createdAt` / `completedAt` are **epoch milliseconds** (numbers), never ISO
  strings. `completedAt` is `null` until the run reaches a terminal status.
- `status` is one of `QUEUED`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`.
- `summary` is `null` while the run is active; on terminal status it is the
  persisted run summary object (e.g. `{ "totalGames", "completedGames",
  "failedGames", "recovered" }`). It is `null` in practice for most completed
  runs persisted before the summary was recorded — do not treat non-`null` as
  guaranteed.
- `error` is `null` unless the run is `FAILED`, in which case it holds the
  joined per-game failure messages.

**Errors:**

- `500` — `{"success": false, "error": "Failed to list benchmark runs"}`

##### Get Benchmark Run Status

**Endpoint:** `GET /api/v1/benchmark/runs/:runId`

**Path Parameters:**

- `runId`: The benchmark run UUID.

**Response (200 OK):** Status record plus live progress for the run.

```json
{
  "success": true,
  "data": {
    "status": {
      "runId": "d2953e1e-8a81-4714-b37c-4640f6cc331b",
      "status": "RUNNING",
      "config": {
        "models": ["openai/gpt-4o-mini", "openai/gpt-4o"],
        "gamesPerPairing": 1,
        "numPlayers": 10,
        "temperature": 0.7
      },
      "createdAt": 1787446562060,
      "completedAt": null,
      "summary": null,
      "error": null,
      "totalGames": 1
    },
    "progress": {
      "runId": "d2953e1e-8a81-4714-b37c-4640f6cc331b",
      "status": "RUNNING",
      "totalGames": 1,
      "completedGames": 0,
      "validGames": 1,
      "failedGames": 0,
      "pairings": [
        {
          "id": "openai/gpt-4o-mini__vs__openai/gpt-4o",
          "modelA": "openai/gpt-4o-mini",
          "modelB": "openai/gpt-4o",
          "games": 1,
          "completed": 0
        }
      ]
    }
  }
}
```

**Errors:**

- `404` — unknown run:

```json
{
  "success": false,
  "error": "Benchmark run does-not-exist not found"
}
```

- `500` — `{"success": false, "error": "Failed to get benchmark run"}`

##### Get Benchmark Run Status (short path)

**Endpoint:** `GET /api/v1/benchmark/:runId`

Alias of `GET /api/v1/benchmark/runs/:runId` with the same success shape. The
only difference is the 404 error message:

```json
{
  "success": false,
  "error": "Run not found"
}
```

**Errors:** `404` (as above), `500` — same `"Failed to get benchmark run"` shape.

##### Cancel a Benchmark Run

**Endpoint:** `POST /api/v1/benchmark/runs/:runId/cancel`

**Path Parameters:**

- `runId`: The benchmark run UUID.

**Request Body:** None.

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "runId": "d2953e1e-8a81-4714-b37c-4640f6cc331b",
    "message": "Benchmark run cancelled"
  }
}
```

Cancellation marks the run `CANCELLED`; already-launched games are left to wind
down naturally. `FAILED` runs can also be cancelled (only `COMPLETED` and
`CANCELLED` runs refuse).

**Errors:**

- `404` — run not found or already in a terminal status the endpoint refuses:

```json
{
  "success": false,
  "error": "Benchmark run does-not-exist not found or already terminal"
}
```

- `500` — `{"success": false, "error": "Failed to cancel benchmark run"}`

##### Cancel a Benchmark Run (short path)

**Endpoint:** `POST /api/v1/benchmark/:runId/cancel`

Alias of the cancel route above with the same success shape. The only
difference is the 404 error message:

```json
{
  "success": false,
  "error": "Run not found"
}
```

**Errors:** `404` (as above), `500` — same `"Failed to cancel benchmark run"` shape.

#### Get Benchmark Report

**Endpoint:** `GET /api/v1/benchmark/report`

**Query Parameters:**

- `gameId`: Optional. Include a per-game detail block for the given game.
- `format`: Optional. `json` (default) or `csv`.

**Response (200 OK):** Standard `{ success, data }` envelope (realigned to
the live API, MAF-GAP-073 — an earlier revision of this section claimed the
payload was NOT wrapped in a `data` field; the route has always wrapped it).

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-13T00:00:00.000Z",
    "summary": {
      "totalGames": 1058,
      "activeGames": 76,
      "completedGames": 982,
      "failedGames": 0,
      "failedGameIds": [],
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
}
```

**`summary` semantics:** `mafiaWinRate` is the mafia win count over completed games. The winner is derived from the game's `GAME_OVER`-phase event (`data.winner`), falling back to the `games.winner` column.

**`summary.failedGames` / `failedGameIds` semantics (MAF-GAP-050):** `failedGames` counts games whose status is neither `IN_PROGRESS` nor `ENDED` (the `SETUP`, `PAUSED`, `CANCELLED` statuses from the shared `GameStatus` union, or any unknown status) — i.e. games that never reached a terminal outcome. The bucket is defined by exclusion so the summary always reconciles: `totalGames === activeGames + completedGames + failedGames`. `failedGameIds` lists those games for auditing — one object per failed game with `id`, `status`, `createdAt` (ISO 8601), and `endedAt` (ISO 8601 or `null` when the game never recorded an end time). It is `[]` when no failed games exist.

**`modelPerformance[].wins` / `winRate` semantics (MAF-GAP-039):**

Per-model wins are games the model's side won, attributed from real per-game model participation:

1. `players.won = 1` rows — explicit per-player win flags.
2. Side attribution — a player row's `is_mafia` compared to the game winner (`games.winner`, falling back to the `GAME_OVER` event winner — the same derivation as `summary.mafiaWinRate`): the model's side won iff `is_mafia = 1` and MAFIA won, or `is_mafia = 0` and TOWN won. A game counts at most once per model.

`winRate = wins / gamesPlayed`. `wins` is **0 when unattributable** — legacy usage-only games (e.g. `token_usage` rows with `player_id = 'ALL'`) record real usage but no side/role data, so their wins are never guessed. A row with `gamesPlayed > 0` and `wins = 0` therefore means "no attributable wins," not "lost every game." Game-level winners are never assigned to every model in a game, and one row per model string is guaranteed (provider-prefixed spellings are normalized).

**`agentStats[]`:** per-agent execution aggregates (`executions`, `successes`, totals). Rows with zero executions legitimately show `totalLatency: 0`.

---

### Benchmark Compare (MAF-GAP-073)

#### Compare Models Head-to-Head

**Endpoint:** `GET /api/v1/benchmark/compare`

**Query Parameters:**

- `models`: Optional. Comma-separated model strings to include (e.g. `openai/gpt-4o-mini,openai/gpt-4o`); whitespace around entries is trimmed, empty entries dropped. When omitted, ALL models are included.

**Response (200 OK):** `{ success, data }` envelope.

```json
{
  "success": true,
  "data": {
    "models": [
      {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "gamesPlayed": 1632,
        "wins": 1629,
        "winRate": 0.9981617647058824,
        "avgTokensPerGame": 0,
        "avgCostPerGame": 0.0132,
        "avgLatency": 827,
        "avgRolePerformance": 0,
        "rolePerformance": {
          "DOCTOR":   { "gamesPlayed": 1545, "wins": 1540, "winRate": 0.9967637540453075 },
          "MAFIA":    { "gamesPlayed": 1630, "wins": 24,   "winRate": 0.014723926380368098 },
          "SHERIFF":  { "gamesPlayed": 1630, "wins": 1605, "winRate": 0.9846625766871165 },
          "VIGILANTE":{ "gamesPlayed": 83,   "wins": 63,   "winRate": 0.7590361445783133 },
          "VILLAGER": { "gamesPlayed": 1549, "wins": 1541, "winRate": 0.9948353776630084 }
        }
      }
      // ... one row per model, sorted by gamesPlayed DESC
    ],
    "headToHead": [
      {
        "modelA": "openai/gpt-4o-mini",
        "modelB": "openai/gpt-4o",
        "gamesPlayed": 40,
        "modelAWins": 20,
        "modelBWins": 18,
        "ties": 2
      }
    ],
    "trends": [
      {
        "model": "openai/gpt-4o-mini",
        "games": [
          {
            "gameId": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
            "won": true,
            "role": "VILLAGER",
            "tokensUsed": 5731,
            "createdAt": "2026-09-26T10:10:46.731Z"
          }
          // ... per-game participation rows
        ],
        "cumulativeWinRate": [1, 1, 0.5, 0.75]
        // running winRate after each game, same length as `games`
      }
    ]
  }
}
```

**`data.models[].rolePerformance` semantics:** keys are the roles the model
actually played (`DOCTOR`, `MAFIA`, `SHERIFF`, `VIGILANTE`, `VILLAGER` — any
role in the game's role vocabulary); values are per-role `gamesPlayed`,
`wins`, `winRate`. `avgRolePerformance` is the average stored per-player
`role_performance` score (0 for games that never recorded one).

**`data.headToHead` / `data.trends` availability:** both are populated only
when the underlying data exists — head-to-head rows need recorded model
pairings and trends need per-game model participation; both are `[]`
otherwise (a live probe with an explicit `models` filter can legitimately
return an empty `headToHead`).

**Exclusions:** degenerate games (all-empty SAYS + short duration / flagged)
and mock games (every provider call fell back to the canned-mock fallback)
are excluded from the aggregates. The source type also declares a
`mockGames` count on the report for auditability; the running container at
documentation time does not emit it — do not treat its absence as an error,
and expect it on newer builds.

**Errors:** `500` — `{ "success": false, "error": "Failed to generate comparison report" }`.

---

### Benchmark Export (MAF-GAP-073)

#### Export Comprehensive Benchmark Report

**Endpoint:** `GET /api/v1/benchmark/export`

**Query Parameters:**

- `format`: Optional. `json` (default) or `csv`.
- `games`: Optional. Integer. Cap on the number of games included in the
  per-game `games[]` array (default 50 when omitted).

**Response (200 OK, `format=json`):** `{ success, data }` envelope.

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-09-26T11:51:46.358Z",
    "summary": {
      "totalGames": 2875,
      "activeGames": 97,
      "completedGames": 2759,
      "failedGames": 19,
      "mafiaWins": 230,
      "townWins": 2529,
      "avgDuration": 150,
      "totalTokens": 328180267,
      "totalCost": 63.6959
    },
    "games": [
      {
        "gameId": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
        "status": "ENDED",
        "dayCount": 1,
        "playerCount": 5,
        "duration": 81366,
        "winner": "TOWN",
        "players": [
          {
            "playerId": "p17904174505850",
            "name": "Lysandra Tzeng",
            "role": "VILLAGER",
            "provider": "unknown",
            "model": "unknown",
            "survived": true,
            "won": true,
            "tokensUsed": 5731,
            "apiCalls": 1
          }
          // ... one row per player
        ],
        "events": [
          {
            "id": "48cdd612-bd4d-4b33-a334-b521dd1ede02",
            "type": "GAME_STARTED",
            "description": "...",
            "playerId": null,
            "timestamp": "2026-09-26T10:11:10.745Z",
            "turnNumber": 1,
            "phase": "SETUP"
          }
          // ... per-game events
        ],
        "costBreakdown": {
          "totalCost": 0.0072,
          "totalTokens": 0,
          "promptTokens": 0,
          "completionTokens": 0,
          "apiCalls": 0,
          "errorRate": 0,
          "byModel": [
            { "provider": "openai", "model": "gpt-4o-mini", "cost": 0.0072, "tokens": 5731 }
          ]
        }
      }
    ],
    "modelAggregates": [
      {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "gamesPlayed": 1632,
        "wins": 1629,
        "winRate": 0.9981617647058824,
        "avgTokensPerGame": 0,
        "avgCostPerGame": 0.0132,
        "avgLatency": 827,
        "avgRolePerformance": 0,
        "rolePerformance": { "MAFIA": { "gamesPlayed": 1630, "wins": 24, "winRate": 0.014723926380368098 } }
      }
    ],
    "headToHead": []
  }
}
```

**Notes:**

- `data.modelAggregates` / `data.headToHead` are the same shapes as
  `GET /api/v1/benchmark/compare`'s `data.models` / `data.headToHead`.
- `winner` is `null` for games without a decided outcome; `duration` is
  `null` when the game never recorded an end time.
- `games[].events[].description` / `playerId` come from the per-game event
  projection and may be `null` for legacy-sourced events.

**Response (`format=csv`):** `text/csv; charset=utf-8` body with
`Content-Disposition: attachment; filename="benchmark-export.csv"`.

**Errors:** `500` — `{ "success": false, "error": "Failed to export benchmark data" }`.

---

### Statistics (MAF-GAP-073)

#### Get Game Statistics

**Endpoint:** `GET /api/v1/stats`

**Response (200 OK):** `{ success, data }` envelope over the aggregated game
stats (same source as `GET /api/v1/benchmark/report`'s `summary`, minus the
per-model/agent sections):

```json
{
  "success": true,
  "data": {
    "totalGames": 2875,
    "activeGames": 97,
    "completedGames": 2759,
    "failedGames": 19,
    "avgDuration": 150,
    "mafiaWins": 230,
    "townWins": 2529
  }
}
```

`data` also carries a `degenerateGames` count (count of games excluded from
win stats as degenerate, DF-MAFIA-AI-BENCHMARK-18) on current builds.

**Errors:** `500` — `{ "success": false, "error": "Failed to get statistics" }`.

#### Get Model Comparison

**Endpoint:** `GET /api/v1/stats/models`

**Response (200 OK):** `{ success, data }` envelope over per-model comparison
rows (the same row shape as `benchmark/report`'s `modelPerformance[]`):

```json
{
  "success": true,
  "data": [
    {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "gamesPlayed": 2284,
      "wins": 1629,
      "winRate": 0.7132224168126094,
      "avgTokens": 68191.8795971979,
      "avgCost": 0.013164966571803853,
      "avgLatency": 826.7087515407642
    }
  ]
}
```

**Errors:** `500` — `{ "success": false, "error": "Failed to get model comparison" }`.

#### Get Matchups

**Endpoint:** `GET /api/v1/stats/matchups`

Head-to-head matchup rows from the `model_matchups` table, ordered by
`games_played` DESC, capped at 20. `[]` when no matchup data has been
recorded.

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "modelA": "openai/gpt-4o-mini",
      "modelB": "openai/gpt-4o",
      "gamesPlayed": 40,
      "modelAWins": 20,
      "modelBWins": 18,
      "ties": 2
    }
  ]
}
```

`modelA`/`modelB` are `provider/model` composite strings.

**Errors:** `500` — `{ "success": false, "error": "Failed to get matchups" }`.

---

### Dashboard (MAF-GAP-073)

#### Get Dashboard Data

**Endpoint:** `GET /api/v1/dashboard`

**Response (200 OK):** `{ success, data }` envelope.

```json
{
  "success": true,
  "data": {
    "totals": { "total": 2875, "active": 97, "completed": 2759 },
    "statusBreakdown": { "ENDED": 2759, "IN_PROGRESS": 97, "CANCELLED": 0 },
    "wins": { "mafia": 5, "town": 994 },
    "avgDuration": 150,
    "recentGames": [
      {
        "id": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
        "status": "ENDED",
        "createdAt": 1790417446731,
        "endedAt": 1790417552115
      }
    ]
  }
}
```

**Notes:**

- `wins.mafia`/`wins.town` come from the aggregated-wins collector (falling
  back to the raw game stats); `statusBreakdown.CANCELLED` is always `0`.
- `recentGames` is the 10 most recent games with **epoch-millisecond**
  `createdAt`/`endedAt` (numbers, not ISO strings).

**Errors:** `500` — `{ "success": false, "error": "Failed to get dashboard data" }`.

---

### Analytics (MAF-GAP-073)

#### Get Analytics Data

**Endpoint:** `GET /api/v1/analytics`

**Response (200 OK):** `{ success, data }` envelope.

```json
{
  "success": true,
  "data": {
    "totals": { "games": 2875, "events": 0, "agents": 0, "models": 5 },
    "eventBreakdown": {},
    "gameTimeline": [
      {
        "id": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
        "status": "ENDED",
        "players": 5,
        "createdAt": 1790417446731
      }
    ],
    "performance": {
      "models": [ /* up to 10 rows, same shape as stats/models */ ],
      "agents": [ /* up to 10 rows, same shape as agents/stats */ ]
    }
  }
}
```

**Notes:**

- `totals.events` / `totals.agents` are currently always `0`; `models` is the
  number of rows in the model comparison.
- `eventBreakdown` is `{}` unless the collector exposes an event distribution.
- `gameTimeline` is the 50 most recent games with epoch-millisecond
  `createdAt`.

**Errors:** `500` — `{ "success": false, "error": "Failed to get analytics data" }`.

---

### Models (MAF-GAP-073)

#### List Available Models

**Endpoint:** `GET /api/v1/models`

**Query Parameters:**

- `provider`: Optional. Filter to a single provider (case-sensitive, e.g. `DEEPSEEK`). Returns `{ success, data: [...], count }` with `[]`/`0` when the provider has no cached models.

**Response (200 OK, no filter):** `{ success, data }` envelope.

```json
{
  "success": true,
  "data": {
    "providers": ["OPENAI", "ANTHROPIC", "GOOGLE", "DEEPSEEK", "GROQ", "OLLAMA", "LM_STUDIO", "CUSTOM", "META", "QWEN", "XAI"],
    "models": [
      { "provider": "OPENAI", "modelId": "gpt-4o-mini", "displayName": "GPT-4o mini" },
      { "provider": "OPENAI", "modelId": "gpt-4o", "displayName": "GPT-4o" }
      // ... up to 20 models per provider
    ],
    "totalCached": 3839,
    "cacheAge": 45
  }
}
```

`cacheAge` is the metadata cache age in seconds.

**Errors:** `500` — `{ "success": false, "error": "Failed to list models" }`.

#### Get Model Pricing

**Endpoint:** `GET /api/v1/models/pricing`

**Query Parameters:**

- `model`: Optional. A provider-prefixed model string (e.g. `openai/gpt-4o-mini`).

**Response (200 OK, `model` given):**

```json
{
  "success": true,
  "data": {
    "modelId": "openai/gpt-4o-mini",
    "inputPerMillion": 0.15,
    "outputPerMillion": 0.6,
    "cacheReadPerMillion": 0.075,
    "hasPricing": true,
    "isMissingPricing": false,
    "noPricingMarker": -6.66
  }
}
```

**Response (200 OK, no `model`):** cache overview + hint.

```json
{
  "success": true,
  "data": {
    "message": "Use ?model= to get specific model pricing",
    "cachedModels": 3839,
    "cacheAge": 45,
    "noPricingMarker": -6.66
  }
}
```

`noPricingMarker` (-6.66) is the sentinel the cost calculator emits for
models without recorded pricing — treat any per-token price equal to it as
"no pricing available," not as a real rate.

**Errors:** `500` — `{ "success": false, "error": "Failed to get model pricing" }`.

#### Calculate Cost

**Endpoint:** `POST /api/v1/models/calculate-cost`

**Request Body:**

```json
{ "modelId": "openai/gpt-4o-mini", "inputTokens": 1000, "outputTokens": 500 }
```

**Response (200 OK):** `{ "success": true, "data": <calculated cost result> }`.

**Errors:** `400` — `{ "success": false, "error": "modelId, inputTokens, and outputTokens are required" }`; `500` — `"Failed to calculate cost"`.

---

### Agents (MAF-GAP-073)

#### List Registered Agents

**Endpoint:** `GET /api/v1/agents`

**Response (200 OK):** `{ "success": true, "data": [] }` — the coordinator's
registered agents; empty in the default single-process setup.

**Errors:** `500` — `{ "success": false, "error": "Failed to list agents" }`.

#### Register Agent

**Endpoint:** `POST /api/v1/agents`

**Request Body:**

```json
{
  "id": "agent-1",
  "name": "Alice",
  "provider": "openai",
  "model": "openai/gpt-4o-mini",
  "temperature": 0.7,
  "maxTokens": 500,
  "apiKey": "optional",
  "baseUrl": "optional"
}
```

**Response (201 Created):**

```json
{ "success": true, "data": { "id": "agent-1", "name": "Alice", "provider": "openai", "model": "openai/gpt-4o-mini" } }
```

**Errors:** `500` — `{ "success": false, "error": "Failed to register agent" }`.

#### Get Agent Stats

**Endpoint:** `GET /api/v1/agents/stats`

**Response (200 OK):** `{ success, data }` envelope over per-agent execution
aggregates (grouped by provider/model in live data):

```json
{
  "success": true,
  "data": [
    {
      "agentId": "ALL",
      "name": "Unknown",
      "provider": "openai",
      "model": "openai/gpt-4o-mini",
      "executions": 2267,
      "successRate": 1,
      "avgLatency": 743.9797088663432
    }
  ]
}
```

**Errors:** `500` — `{ "success": false, "error": "Failed to get agent stats" }`.

---

### Legacy Games (MAF-GAP-073)

#### List Active Legacy Games

**Endpoint:** `GET /api/v1/legacy-games`

**Response (200 OK):** `{ success, data }` envelope over the legacy engine's
ACTIVE game list (one row per game the legacy adapter is still tracking —
completed games stop being listed here):

```json
{
  "success": true,
  "data": [
    {
      "gameId": "585f06fe-a37e-4664-a4f7-5364aee99e5f",
      "status": "COMPLETED",
      "eventCount": 27,
      "startedAt": "2026-09-26T00:32:11.602Z",
      "error": null
    }
  ]
}
```

`status` is the legacy engine's own vocabulary (e.g. `RUNNING`, `COMPLETED`)
— NOT the canonical `GameStatus` union; `error` is `null` unless the game
recorded an error. When the legacy engine is not available the route answers
`503` with `{ "success": false, "error": "Legacy engine not available" }`.

---

### Game Players & Replay (MAF-GAP-073)

#### Get Game Players

**Endpoint:** `GET /api/v1/games/:gameId/players`

**Response (200 OK):** `{ success, data }` envelope over the persisted
player rows (a slimmer projection than the detail endpoint's `players[]` —
no usage attribution here):

```json
{
  "success": true,
  "data": [
    {
      "id": "p17904174505850",
      "name": "Lysandra Tzeng",
      "role": "VILLAGER",
      "isAlive": true,
      "isMafia": false,
      "joinOrder": 0,
      "won": 1
    }
  ]
}
```

**Errors:** `500` — `{ "success": false, "error": "Failed to get players" }`.

#### Get Full Game Replay

**Endpoint:** `GET /api/v1/games/:gameId/replay`

Returns the game's full event timeline sorted chronologically (oldest
first). Works for both repository and legacy games; `404` when the game
exists in neither.

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": "48cdd612-bd4d-4b33-a334-b521dd1ede02",
      "gameId": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
      "type": "GAME_STARTED",
      "timestamp": "2026-09-26T10:11:10.745Z",
      "visibility": "ADMIN",
      "actorId": null,
      "targetId": null,
      "data": { "legacyType": "STATE_CHANGE", "status": "STARTED", "playerCount": 5, "playerName": null },
      "metadata": { "turnNumber": 1, "dayNumber": 0, "phase": "SETUP", "sequence": 1 }
    }
  ],
  "count": 27
}
```

Each element is the same full event object as
`GET /api/v1/games/:gameId/events`, sorted chronologically. Legacy engine
events surface their original type under `data.legacyType` with the
normalized `type` on top.

**Errors:** `404` — `{ "success": false, "error": "Game not found" }`; `500` — `"Failed to get replay"`.

#### Get SSE Connection Status

**Endpoint:** `GET /api/v1/games/:gameId/sse-status`

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "gameId": "1692df5c-f844-4abd-ad78-ae7e00d2fe64",
    "activeConnections": 0,
    "isStreaming": false
  }
}
```

`isStreaming` is `true` iff at least one SSE client is attached to the
game's `GET /api/v1/games/:gameId/events` stream.

---

### Player Model Configuration (POST, MAF-GAP-073)

Per-player/per-role model assignment for a game. All three routes return
`404 { "success": false, "error": "Game not found: <id>" }` for unknown
games and `500` on repository failure.

#### Set Model for a Player

**Endpoint:** `POST /api/v1/games/:gameId/players/:playerIndex/model`

**Request Body:** `{ "provider", "model" }` required; optional
`temperature` (default 0.7), `maxTokens` (default 500), `priority`
(default 0).

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "gameId": "1692df5c...",
    "playerIndex": 0,
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "maxTokens": 500,
    "priority": 0,
    "createdAt": "2026-09-26T10:10:46.000Z"
  }
}
```

**Errors:** `400` — `"provider and model are required"`.

#### Set Model for a Role

**Endpoint:** `POST /api/v1/games/:gameId/role/:role/model`

Same body/response as the per-player route, with `role` (e.g. `MAFIA`) as
the path parameter; the response's `data` carries `role` instead of
`playerIndex`.

#### Bulk Update Player Models

**Endpoint:** `POST /api/v1/games/:gameId/models/bulk`

**Request Body:**

```json
{ "assignments": [ { "playerIndex": 0, "provider": "openai", "model": "gpt-4o-mini" } ] }
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "message": "1 of 1 assignments saved",
    "results": [
      { "status": "saved", "id": 1, "playerIndex": 0, "role": null, "provider": "openai", "model": "gpt-4o-mini" }
    ]
  }
}
```

Per-row results are `{ "status": "saved", ... }` or
`{ "status": "failed", "error": "..." }`. Missing/invalid `assignments`
array → `400 { "success": false, "error": "assignments array is required" }`.

---

## WebSocket API

> **Note (DF-MAFIA-AI-BENCHMARK-5):** the sections below describe the
> originally *planned* per-game `/ws/:gameId` protocol (sequence numbers,
> heartbeats, `since`-based replay). The **live** server today implements a
> simpler single-endpoint protocol at `ws://host:3004/ws` — message types
> `PING`, `SUBSCRIBE`, `UNSUBSCRIBE`, `JOIN_GAME`, `LEAVE_GAME`,
> `SEND_ACTION`, `REQUEST_STATE`. The accurate, code-extracted reference is
> **[`docs/api/websocket.md`](../docs/api/websocket.md)**.

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
