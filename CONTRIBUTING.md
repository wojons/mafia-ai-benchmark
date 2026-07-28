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
