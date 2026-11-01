# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [1.2.0] — 2026-11-01

Third release. The delta since v1.1.0 is dominated by verification and board
traffic; the user-facing changes are reliability and trust repairs: the
`/benchmark/compare` cache now survives live games, header counters reflect
the live `/stats` totals, never-started ghost games are retired at the
lifecycle reconciler, and the leaderboard's seat caveat / population summary
close the remaining attribution gaps. Dependency overrides move to
`qs >=6.16.1` and `body-parser >=2.4.0`. Nothing in this release publishes to
npm — the release surface remains the annotated tag, the GitHub Release
object and the compose stack.

### Added

- Web leaderboard renders the per-role / per-player-count breakdown table
  (DF-MAFIA-AI-BENCHMARK-39-R2) — the dashboard surface for the report
  fields v1.1.0 added to `/api/v1/benchmark/report`.

### Fixed

- Header chrome counters render the live `/stats` totals instead of
  page-local counts (DF-MAFIA-AI-BENCHMARK-32-R2).
- Lifecycle reconciler retires never-started `IN_PROGRESS` ghost games
  (DF-MAFIA-AI-BENCHMARK-23-R3).
- `/benchmark/compare` payload declares unattributed games and uncovered-tail
  leaderboard rows carry the seat caveat (DF-MAFIA-AI-BENCHMARK-39-R3); the
  benchmark population summary is published on the report
  (DF-MAFIA-AI-BENCHMARK-41-R2).
- CLI: `mafiactl config` round-trips reliably (README-9); stale `1.0.0`
  version fallback dropped (RELENG-MAFIA-20261023-05).
- Test infrastructure: the server API integration suite is hermetic — no
  reachable server required, `TEST_BASE_URL` documented (README-7);
  `@mafia/shared/agents` / `@mafia/shared/fsm` subpath imports resolve in
  test environments without a prior build (RELEASE-007); the models-catalog
  test no longer times out at 5 s (INT-CI-005).

### Performance

- `/benchmark/compare` cache is preserved while games are live
  (PERF-MAFIA-5) — compare no longer falls back to a cold ~5 s recomputation
  mid-run.

### Security

- `qs` override raised to `>=6.16.1` (GHSA-6pq8-jhm2-2vcw, `arrayFormat:
  'comma'` DoS) (RELEASE-007); `body-parser` override raised to `>=2.4.0`
  (GHSA-27r3-jxmh-p828) (RELEASE-006). `pnpm audit --prod` reports zero
  known vulnerabilities at the release stamp.

### CI / Docs

- Release script is repeatable after a cut (RELENG-MAFIA-20261023-03);
  the gitreins guard enforces full tests on dependency/lockfile diffs
  (RELENG-MAFIA-20261023-04).
- Docs: README counts and setup guidance refreshed (README-1-R2/5/6),
  `mafiactl init` documented (README-8), sudo-less Node.js bootstrap recipe
  in QUICK_START (DF-MAFIA-AI-BENCHMARK-44), web UI port probe clarified
  (QA-MAFIA-AI-BENCHMARK-11-R2), benchmark export CLI corrected (DOC-20),
  canonical mafia usage caveats (DF-MAFIA-AI-BENCHMARK-48).
- Dependency maintenance: compatible updates reviewed and applied
  (SUP-DEPS-20261018-MAB).

---

## [1.1.0] — 2026-10-23

Second release. The delta since v1.0.0 is dominated by trust repairs: the
win-rate, matchup and per-role numbers the dashboard sells are now derived
from one declared population, and games the server no longer owns are no
longer advertised as LIVE. Nothing in this release publishes to npm — the
release surface remains the annotated tag, the GitHub Release object and the
compose stack.

### Added

- Per-role and per-player-count win breakdown in benchmark rows
  (`rolePerformance`, `byNumPlayers`) on `/api/v1/benchmark/report` and
  `/benchmark/compare` — the leaderboard can separate skill from role
  advantage (DF-MAFIA-AI-BENCHMARK-39).
- Head-to-head matchups derived from `benchmark_games`
  (`GET /api/v1/stats/matchups`), reconciling with the stored pairings
  (DF-MAFIA-AI-BENCHMARK-40).
- Deploy-refresh mechanism: the stack records the sha it was built from and
  recreates containers when the tree moves, with live trigger wiring
  (DF-MAFIA-AI-BENCHMARK-38).
- Optional `ADMIN_AUTH_TOKEN` gating for ADMIN-visibility events
  (MAF-REV-004).
- Input validation on `POST /api/v1/games`: malformed payloads get a `400`
  with a named field instead of a half-created game (MAF-REV-001).
- Game lifecycle reconciler: persisted `IN_PROGRESS` rows are reconciled
  against the live owner registry at startup and again on every game read,
  retiring rows left behind by a restart (DF-MAFIA-AI-BENCHMARK-23-R2).
- `db:migrate` actually initialises the database instead of silently
  no-oping (QA-MAFIA-AI-BENCHMARK-20).

### Fixed

- Winner population metrics: `mafiaWins + townWins == completedGames` and
  `mafiaWinRate` is derived from the same census as `/api/v1/stats`
  (DF-MAFIA-AI-BENCHMARK-41).
- Games list / stats disagreement: stale `IN_PROGRESS` games are retired and
  stop being served as LIVE; the dashboard gates LIVE on
  `status === 'IN_PROGRESS'` (DF-MAFIA-AI-BENCHMARK-23-R2).
- Dashboard headline counts come from `/stats`, not the current page
  (DF-MAFIA-AI-BENCHMARK-32); watch view survives a blank stream via
  `ErrorBoundary` + WebSocket watchdog (DF-MAFIA-AI-BENCHMARK-31).
- New Game model presets are sourced from the server catalog, including
  `VIGILANTE`, instead of a hardcoded list (DF-MAFIA-AI-BENCHMARK-42).
- `POST /api/v1/games` accepts the documented nested `config.numPlayers`
  shape (DF-MAFIA-AI-BENCHMARK-35).
- `GET /api/v1/games/:gameId/events` honours `?limit`.
- Benchmark verdicts reflect the run's own results and
  `benchmark_runs.summary` is populated (DF-MAFIA-AI-BENCHMARK-28);
  `CUSTOM/*` ghost rows are bucketed out of `/benchmark/compare`
  (DF-MAFIA-AI-BENCHMARK-36); `roleModels` objects are normalised to
  `provider/model` strings before env injection
  (DF-MAFIA-AI-BENCHMARK-43).
- Adapter-created games serve live state on `/state` and `/game/:id`
  (DF-MAFIA-AI-BENCHMARK-30).
- `AGENT_THINK_STARTED` / `AGENT_THINK_COMPLETED` are emitted per agent turn
  (MAF-REV-003); historical mock games are retroactively flagged at startup
  (MAF-REV-002).
- CLI: `game:run` / `game:watch` route through the commander entry point —
  the documented invocation was a silent no-op.
- `compose` `env_file` is optional: a fresh clone boots without `.env`
  (QA-MAFIA-AI-BENCHMARK-10); `dev --port` passthrough works as documented.
- Deploy refuses to recreate the server while a benchmark game is live
  (DF-MAFIA-AI-BENCHMARK-47); the E2E smoke script boots the entrypoint the
  build actually emits (DF-MAFIA-AI-BENCHMARK-46).
- `response-parser.js` ships a dual ESM+CJS shape so `require()` resolves
  without an `act` dance (QA-MAFIA-AI-BENCHMARK-15).

### Performance

- `/api/v1/benchmark/report` is watermark-memoised (PERF-MAFIA-2);
  `/benchmark/compare` is memoised, 2.3-2.5 s cold to ~0.20 s warm at 4.3 k
  games (PERF-MAFIA-3); the Stats tab no longer fires an N+1 query storm —
  39-43 requests down to 5 (PERF-MAFIA-4).

### Security

- WebSocket path gated on `ADMIN_AUTH_TOKEN`.
- `proxy-addr` IP-spoofing advisory remediated; workspace overrides aligned
  with the bumped floors (`ws >=8.22.0`, `uuid >=14.0.3`).

### CI / Docs

- CI repairs: `@types/uuid` committed specifier restored so
  `--frozen-lockfile` installs pass, `db:migrate` import-safety arm is
  checkout-independent, same-millisecond `generatedAt` assertions removed,
  post-commit hook test skipped in CI.
- README / QUICK_START / port docs realigned to the verified surface.

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

[1.2.0]: https://github.com/wojons/mafia-ai-benchmark/releases/tag/v1.2.0
[1.1.0]: https://github.com/wojons/mafia-ai-benchmark/releases/tag/v1.1.0
[1.0.0]: https://github.com/wojons/mafia-ai-benchmark/releases/tag/v1.0.0
