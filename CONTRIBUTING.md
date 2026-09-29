# Contributing

## Development Setup

```bash
pnpm install
pnpm build
```

## Architecture

pnpm monorepo with 4 workspace packages:
- apps/server — Express + WebSocket game server
- apps/web — React + Vite + Chart.js dashboard
- apps/cli — CLI tooling
- packages/shared — Shared types, FSM, events, providers, personas

## Quality Gates

Every commit runs GitReins guards (secrets, build, lint, tests). See AGENTS.md for details.

## Testing

```bash
pnpm test          # Run all tests
pnpm --filter @mafia/cli test   # CLI tests only
```

## Commit Convention

- feat: new feature
- fix: bug fix
- chore: maintenance, docs
- refactor: code change without feature/fix

Co-authored-by trailer required for AI-assisted commits.

## Live Benchmark Test (Opt-In, Costs Real Money)

One test in `apps/cli/src/__tests__/benchmark.test.ts` — the `benchmark fresh game run (live server, opt-in via MAFIA_LIVE_BENCHMARK=1)` suite (a single test: `--games 1 --models <pair> POSTs a run, polls progress, and prints the report`) — plays a REAL LLM-driven Mafia game end-to-end. It is the only full end-to-end proof that a real benchmark game completes against the live server, and it is **skipped by default** in every ordinary test run.

### What opting in does

- Fires real games through real model providers (e.g. OpenRouter) and **burns real API credits** (roughly one game per invocation; historically ~4 minutes, test timeout 12 minutes).

- Requires the game server to be running and reachable (default `http://localhost:3004`, override with `TEST_BASE_URL`); without a reachable server the test skips even when opted in.

### How to opt in

```bash
docker compose up -d          # start the server on :3004
MAFIA_LIVE_BENCHMARK=1 pnpm --filter @mafia/cli test   # or test:run
```

Without `MAFIA_LIVE_BENCHMARK=1` (the default), the test reports as skipped and nothing is spent. No other test or code path reads this variable.
