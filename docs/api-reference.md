# API Reference & Integration Guide

The canonical API specification lives at **[`specs/api-specs.md`](../specs/api-specs.md)**.

That document covers:

- **Endpoints** — `/api/v1/games`, `/api/v1/players`, `/api/v1/agents`, `/api/v1/stats`, `/api/v1/benchmark`, `/api/v1/benchmark/report`, health checks
- **WebSocket protocol** — `/ws` connection, event shapes, streaming
- **Request/response payloads** — game creation, player model assignment, report shapes
- **Integration examples** — how to drive a game and read the benchmark report

## Health checks

- `GET /health` and `GET /api/v1/health` — identical payload (`status`, `timestamp`, `uptime`, `memory`)

## Quick links

| Document | Purpose |
| --- | --- |
| [`specs/api-specs.md`](../specs/api-specs.md) | Full API reference & integration guide |
| [`specs/benchmark-methodology.md`](../specs/benchmark-methodology.md) | Benchmark methodology |
| [`specs/cli-interface.md`](../specs/cli-interface.md) | CLI tooling reference |
| [`COST_TRACKING.md`](COST_TRACKING.md) | Token/cost tracking for benchmark runs |
