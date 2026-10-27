# API Reference & Integration Guide

The canonical API specification lives at **[`specs/api-specs.md`](../specs/api-specs.md)**.

The DuckBrain sync-twin integration contract — per-tick /sync markers (`/sync/write-test-YYYY-MM-DD`, `/sync/last-run`), the mafia-benchmark namespace data-skill flow (POST `/api/memories`, X-API-Key auth), and the config/ vs event/ domain split — is documented in [`specs/sync-integration.md`](../specs/sync-integration.md).

That document covers:

- **Endpoints** — `/api/v1/games`, `/api/v1/agents`, `/api/v1/stats`, `/api/v1/benchmark`, `/api/v1/benchmark/report`, `/api/v1/benchmark/runs/{runId}/report`, `/api/v1/models`, health checks. (There is NO `/api/v1/players` route on the server — an earlier revision of this list advertised one and it 404'd; per-player data lives at `/api/v1/games/:gameId/players`.)
- **WebSocket protocol** — `/ws` connection, event shapes, streaming (the
  code-extracted reference for the live protocol is
  [`api/websocket.md`](api/websocket.md))
- **Request/response payloads** — game creation, player model assignment, report shapes
- **Integration examples** — how to drive a game and read the benchmark report

### Benchmark report `wins` / `winRate` semantics (MAF-GAP-039)

`GET /api/v1/benchmark/report` returns `modelPerformance[]` rows with per-model
`wins` / `winRate`. Wins are the games the model's side won, attributed from
real per-game participation: `players.won = 1` flags plus side attribution
(`players.is_mafia` vs the game winner from `games.winner` or the `GAME_OVER`
event — the same derivation as `summary.mafiaWinRate`). `winRate = wins /
gamesPlayed`. Legacy usage-only games (e.g. `token_usage` rows with
`player_id = 'ALL'`) have no side data, so their wins stay **0** — 0 means
"no attributable wins," not "lost every game." Game-level winners are never
attributed to models that did not play. See [`specs/api-specs.md`](../specs/api-specs.md)
→ "Benchmark Report" for the full contract.

### Run-scoped benchmark report (DF-MAFIA-AI-BENCHMARK-28)

`GET /api/v1/benchmark/runs/{runId}/report` returns the report for a single
benchmark run, derived from that run's own `benchmark_games` + `players` rows
only. The global `GET /api/v1/benchmark/report` mixes every run ever recorded,
so a fresh 2-game run's closing verdict would quote lifetime aggregates; the
run-scoped endpoint answers "what did THIS run show" instead.

**Path parameter:** `runId` (string) — the identifier returned by the run
start endpoint.

**Response — `200`** under the standard `{ success, data }` envelope:

```json
{
  "success": true,
  "data": {
    "runId": "string",
    "status": "QUEUED | RUNNING | COMPLETED | CANCELLED | FAILED",
    "generatedAt": "ISO-8601 timestamp",
    "summary": {
      "totalGames": 0,
      "completedGames": 0,
      "validGames": 0,
      "failedGames": 0,
      "gamesWithWinner": 0
    },
    "modelPerformance": [
      {
        "provider": "string",
        "model": "string",
        "gamesPlayed": 0,
        "wins": 0,
        "losses": null,
        "winRate": 0,
        "avgTokens": 0,
        "avgCost": 0
      }
    ],
    "pairings": [
      {
        "id": "string",
        "modelA": "string",
        "modelB": "string",
        "games": 0,
        "completed": 0,
        "aWins": 0,
        "bWins": 0,
        "unattributed": 0
      }
    ]
  }
}
```

- `status` is the run's current lifecycle state; the endpoint is available
  **regardless of run status** and fields are computed live — an in-flight
  run shows partial counts.
- `summary.gamesWithWinner` counts games with a decided side winner
  (attributable games); the rest carry games but no wins.
- `modelPerformance.losses` counts defeats only when the model has at least
  one win somewhere in the run (`null` = "no attributable losses", the same
  honest floor as the CLI display). Only real (comparable) models are ranked.
- `pairings` are run-scoped head-to-heads; `aWins` / `bWins` / `unattributed`
  partition `completed` (winner = which model side won that game).

**`404`** — unknown `runId`: `{ "success": false, "error": "Benchmark run
<runId> not found" }` (RouteError envelope). **`500`** — report generation
failure: `{ "success": false, "error": "Failed to generate benchmark run
report" }`.

## Health checks

- `GET /health` and `GET /api/v1/health` — identical payload (`status`, `timestamp`, `uptime`, `memory`)

## WebSocket protocol

Real-time game events stream over `/ws` (server :3004). The per-game channel
is **`JOIN_GAME {gameId}`**: the client is registered on that game's event
stream and receives `GAME_EVENT` frames for every event the game publishes
(`LEAVE_GAME` ends the stream). The legacy
**`SUBSCRIBE {gameId}`** (or `game_id`) now aliases to that same
`JOIN_GAME` registration — it replies `SUBSCRIBED` with
`{ eventTypes: ["GAME_EVENT"], gameId }` and the client really receives the
game's frames; it previously acked while registering nothing (silent no-op,
DF-MAFIA-AI-BENCHMARK-19). **`SUBSCRIBE {eventTypes: [...]}`** (no gameId)
is unchanged: it registers event-type subscriptions and echoes
`{ eventTypes }`. The full code-extracted protocol reference (all message
types, envelopes, error cases) lives in
[`api/websocket.md`](api/websocket.md).

## Quick links

| Document | Purpose |
| --- | --- |
| [`specs/api-specs.md`](../specs/api-specs.md) | Full API reference & integration guide |
| [`specs/benchmark-methodology.md`](../specs/benchmark-methodology.md) | Benchmark methodology |
| [`specs/cli-interface.md`](../specs/cli-interface.md) | CLI tooling reference |
| [`specs/sync-integration.md`](../specs/sync-integration.md) | Sync-twin (DuckBrain) integration contract — /sync markers, data-skill flow, domain split |
| [`COST_TRACKING.md`](COST_TRACKING.md) | Token/cost tracking for benchmark runs |
