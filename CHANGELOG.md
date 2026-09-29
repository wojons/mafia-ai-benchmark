# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [1.0.0] — 2026-09-29

First public release of the Mafia AI Benchmark: an AI-powered Mafia game
simulation that benchmarks AI models' ability to play social deduction,
with split-pane THINK/SAYS consciousness, event-sourced game records, a
REST + WebSocket API, a React dashboard, and a CLI (`mafiactl`).

### Added

- Game API: player roles surfaced on `GET /api/v1/games/:id`
  (MAFIA/DOCTOR/SHERIFF/VILLAGER) with correct `isMafia` flags, mapped
  from `ROLES_ASSIGNED`/`MORNING_REVEAL`/night events.
- Terminal `GAME_OVER`-class event in the events stream for completed
  games, carrying winner data (legacy `STATE_CHANGE` no longer mislabeled
  as `GAME_STARTED`).
- Benchmark runner with per-model win-rate reporting
  (`/api/v1/benchmark/report`), split-pane THINK/SAYS deliberation, and
  broadcast quality gating (empty/repeated agent says dropped).
- `games.winner` backfill migration: at server boot, ENDED games with a
  NULL winner are backfilled from their latest `GAME_ENDED` event
  payload (MAFIA/TOWN), making the headline win-rate stats verifiable.
- CLI (`mafiactl`): run-game, list-games, watch-game, export, stats —
  defaulting to the compose API at `http://localhost:3004`, working in
  non-TTY shells (CI/cron/agent harnesses).
- React dashboard with live game view and model leaderboard.
- Docker compose stack: server (API :3004, WS /ws) + web (:5174).

### Fixed

- CLI commands default to the compose API port :3004 instead of :3000
  (previously hit whatever else lived on :3000).
- CLI non-TTY invocation: documented `pnpm --filter @mafia/cli dev -- <cmd>`
  form exits 0 in cron/CI shells; root `pnpm test` runs headless without
  hanging (`test:run` wired through turbo; server API tests auto-skip
  with a clear message when no server is reachable).
- Server test suite paths aligned with the `/api/v1` router mount.
- Dependency audit at release: 0 known vulnerabilities in production
  dependencies (react-router >=7.18.4, qs >=6.16.0, body-parser >=1.20.6,
  fflate >=0.6.11 overrides).

### Docs

- All user-facing port references corrected to :3004; QUICK_START
  documents the server prerequisite and `TEST_BASE_URL` override.

### Security

- All 5 workspace manifests marked `private: true` (npm publish surface
  is intentionally closed; the release surface is the Docker stack +
  GitHub Release objects).

[1.0.0]: https://github.com/wojons/mafia-ai-benchmark/releases/tag/v1.0.0
