# API Reference & Integration Guide

The canonical API specification lives at **[`specs/api-specs.md`](../specs/api-specs.md)**.

The DuckBrain sync-twin integration contract — per-tick /sync markers (`/sync/write-test-YYYY-MM-DD`, `/sync/last-run`), the mafia-benchmark namespace data-skill flow (POST `/api/memories`, X-API-Key auth), and the config/ vs event/ domain split — is documented in [`specs/sync-integration.md`](../specs/sync-integration.md).

That document covers:

- **Endpoints** — `/api/v1/games`, `/api/v1/players`, `/api/v1/agents`, `/api/v1/stats`, `/api/v1/benchmark`, `/api/v1/benchmark/report`, health checks
- **WebSocket protocol** — `/ws` connection, event shapes, streaming
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

## Health checks

- `GET /health` and `GET /api/v1/health` — identical payload (`status`, `timestamp`, `uptime`, `memory`)

## Quick links

| Document | Purpose |
| --- | --- |
| [`specs/api-specs.md`](../specs/api-specs.md) | Full API reference & integration guide |
| [`specs/benchmark-methodology.md`](../specs/benchmark-methodology.md) | Benchmark methodology |
| [`specs/cli-interface.md`](../specs/cli-interface.md) | CLI tooling reference |
| [`specs/sync-integration.md`](../specs/sync-integration.md) | Sync-twin (DuckBrain) integration contract — /sync markers, data-skill flow, domain split |
| [`COST_TRACKING.md`](COST_TRACKING.md) | Token/cost tracking for benchmark runs |
