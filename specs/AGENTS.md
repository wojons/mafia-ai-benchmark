# AGENTS.md — specs/ directory

This directory holds the canonical specification and API-reference documents for the
Mafia AI Benchmark project (wojons/mafia-ai-benchmark) — a TypeScript pnpm monorepo
that simulates Mafia games between AI models and benchmarks their performance.

## What lives here

- `api-specs.md` — canonical API reference for the server (routes, request/response
  shapes, vocabulary). Source of truth for the live HTTP API.
- `system-spec.md` — architecture and system design (event sourcing, game FSM,
  benchmark pipeline, cost tracking).
- Other spec/docs files covering the game engine, CLI, and web dashboard.

## Ground rules for agents

- This is a CODE repository. The specs here describe the implementation; they are
  not a separate documentation-only repo.
- When a spec and the live code disagree, the live code + tests are truth — file a
  board task (MAF-GAP-*) to realign the spec rather than silently editing either.
- The authoritative repo-level AGENTS.md lives at the repository root; this file
  only scopes the specs/ directory.

## Key references

- Root `AGENTS.md` — repo architecture, GitReins quality gates, commit rules.
- `apps/server` — Express + WebSocket game server (API :3004).
- `apps/cli` — mafiactl CLI. `apps/web` — React dashboard. `packages/shared` — types/FSM.
