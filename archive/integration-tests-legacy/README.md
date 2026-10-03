# Legacy standalone integration tests (archived MAF-GAP-074, 2026-10-02)

These two files were the repo's original integration suites, written as
**standalone custom runners**: plain ESM scripts with their own HTTP client,
their own pass/fail counters, and a `process.exit()` summary at the end. They
use no `describe`/`it`, so vitest could not import them as-is, and the vitest
configs of both packages (`include: ['src/**/*.test.ts', ...]`) excluded them.
No package.json script, turbo task, or CI workflow ever referenced them —
their claimed coverage (ARCHITECTURE.md's "31 API integration tests ✅")
silently did not exist.

Both had also gone stale relative to the live API:

- They expected `POST /api/v1/games` to answer `status: 'SETUP'` with a
  `game-`-prefixed id; the current API answers `status: 'starting'` with a
  UUID `gameId` and validates `numPlayers` (MAF-GAP-013-era changes).
- They expected `POST /api/v1/models/calculate-cost` to return
  `data.totalCost`; the current envelope is `{ cost, pricing, formatted }`
  (`NO_PRICING_MARKER` = -6.66 pricing for unknown models).
- They expected `GET /api/v1/models` to be an array; today it is an object
  `{ providers, models, totalCached, cacheAge }`.
- The CLI file drove `mafiactl games list|create|watch`, `config get|set`,
  `init --force`, `stats --model` — subcommands that no longer exist
  (commands are init/run-game/watch-game/list-games/config/stats/benchmark) —
  and asserted an "Unknown command" exit-1 path the current default help
  action replaced (unknown top-level args now print help and exit 0).

## What was preserved (option 1 ports)

The orphaned coverage that no existing suite duplicated was PORTED to vitest
against the current wire shapes (probed live against a running server):

- `apps/server/src/__tests__/api-live-endpoints.test.ts` — 19 tests carrying
  the server file's coverage of `/api/v1` info, games-list filters, stats,
  models catalog, pricing, calculate-cost, the model-assignment routes'
  deterministic 400/404 validation arms, SSE streaming (+ `sse-status`
  counter moving 0→1→0), 404 NOT_FOUND, and malformed-JSON 400 envelopes.
  It runs under `describe.skipIf(!SERVER_PROBE.available)` (same
  `probeMafiaServer` guard as `api.test.ts`), so it skips cleanly when no
  server is up and honors `TEST_BASE_URL` (CI starts its own server on :3004).
- `apps/cli/src/__tests__/surface.test.ts` — 2 tests pinning the real-argv
  surface arms that were covered nowhere else: `--version` bare-version
  stdout/exit 0, and the unknown-option stderr + exit-1 path.

## What was dropped (duplicated or superseded elsewhere)

- Health endpoint, plain game CRUD (create/get/list/404), events listing:
  already covered live by `apps/server/src/__tests__/api.test.ts` /
  `health.test.ts` (337+ tests inc. TEST_BASE_URL live-API suites).
- CLI command behavior (stats output, benchmark report, init writes, parse
  parity): already covered by `apps/cli/src/__tests__/` (index/stats/parse/
  benchmark/list-games/init-command suites).

## Known live-server defect found while probing (NOT fixed here)

The model-assignment routes' happy paths return 500 on a live server:
`repository.assignPlayerModel`/`assignRoleModel` INSERT into
`player_model_assignments` without `player_id`, but the column is
`NOT NULL` (schema.sql:229), so every assignment fails with
"NOT NULL constraint failed: player_model_assignments.player_id"
(`legacy-game-adapter.ts` works around it with a `player_id='ALL'`
sentinel; the routes never did). The port pins the routes' 400/404 arms and
documents this in its header; the happy-path repair needs its own row.