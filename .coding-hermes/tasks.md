# Mafia AI Benchmark — Foreman Board

> Migrated from Axiom to coding-hermes on 2026-07-06.
> Model: MiniMax-M3 / minimax | Schedule: every 120m

## [x] MIGRATE-001: Audit current state (completed 2026-07-08)

## [x] FIX-EVENTBUS: Fix EventBus implementation — 3 failing tests (completed 2026-07-12)

## [x] TEST-CLI: Add test files for apps/cli package (completed 2026-07-12)

## [x] INFRA-SPECS: Review, organize, and commit untracked specs/docs (completed 2026-07-12)

## [x] DOC-SWEEP-001: Fix README.md path from `/config/workspace/mafia` to actual location (completed 2026-07-12)

## [x] SPEC-SWEEP-001: Write axiom-level spec for benchmark runner (completed 2026-07-12)

## [x] SPEC-SWEEP-002: Write axiom-level spec for player model assignment (completed 2026-07-13)

## [x] CI-SWEEP-001: Set up GitHub Actions CI pipeline (completed 2026-07-13)

## [x] FIX-CI-BUILD: Commit missing build config files — turbo.json + web build pipeline (completed 2026-07-14)
- **Commit:** 8eb1fa9
- **Priority:** CRITICAL
- **Root cause:** CI fails at "Build workspace" because `turbo.json` is untracked. Turborepo requires this file to orchestrate the build pipeline. Without it, all 4 matrix CI jobs fail with exit code 1. Additionally, web build config files (`postcss.config.js`, `tailwind.config.js`, `env.d.ts`, `index.css`) are untracked — needed for web build on fresh checkout.
- **Files:** turbo.json, apps/web/postcss.config.js, apps/web/tailwind.config.js, apps/web/src/env.d.ts, apps/web/src/index.css
- **AC:** All files committed and pushed. CI passes on next push.
- **Verification:** `git status` clean for these files. `pnpm build` still passes.

## [x] INFRA-GITIGNORE: Add infrastructure directories to .gitignore (completed 2026-07-14)
- **Commit:** 7c797e3
- **Priority:** medium
- **Files:** .gitignore
- Directories to gitignore: .githooks/, .gitreins/history/, .vfs/, .worktrees/, .axiom/, .hermes/plans/, apps/server/src/routes/*.bak
- **AC:** All infrastructure dirs + .bak files excluded from git tracking.

## [x] CHORE-CLEANUP: Remove stale artifacts (index.ts.bak, legacy-logger.js) (completed 2026-07-15)
- **Commit:** 81fd5ce
- **Resolution:** Both files removed. `src/logging/` directory (now empty) also removed. Build passes (4 tasks, all cached). All 191 tests pass (server 39, shared 150, web 2).

## [x] TODO-ANALYTICS: Decide whether to commit apps/web/src/types/analytics.ts (completed 2026-07-15)
- **Commit:** 81fd5ce
- **Resolution:** analytics.ts has ZERO references in apps/web/src/ (grep confirmed). Left untracked — not committed. Per AC, excluded.

## [x] Fix CI: wojons/mafia-ai-benchmark — run #7 — server tests ECONNREFUSED (completed 2026-07-15)
- **Root cause (2026-07-15):** Server API tests in `apps/server` try to connect to `localhost:3000` at test time. CI runner has no server process → ECONNREFUSED. Locally all 39 tests pass (server available). 2 test files fail on CI with 9/39 tests failing. Build workspace step passes green — only test execution fails.
- **Fix (2026-07-15):** Added server start/mkdir/health-check/stop steps to CI workflow. Server starts from compiled `dist/index.js` after build, waits up to 30s for health endpoint, runs vitest, then kills server. `mkdir -p data` ensures SQLite DB can be created.
- **Files:** .github/workflows/ci.yml
- **Commit:** 67bf1c8

## [x] SWEEP-001: Fix .gitreins/config.yaml test_command — Docker required but no container (completed 2026-07-15)
- **Commit:** 5555321
- **Resolution:** Changed `test_command` from Docker exec to native `cd apps/server && npx vitest run`. All 39 server tests pass. `gitreins guard` PASS.
- **Priority:** medium
- **Root cause:** `.gitreins/config.yaml` sets `test_command: docker exec mafia-ai-benchmark-server-1 ...` but no Docker container exists locally. Causes `gitreins guard` to always fail tests. Tests pass natively via `cd apps/server && npx vitest run`.
- **Fix:** Change test_command to run natively: `cd apps/server && npx vitest run` or auto-detect.
- **Files:** .gitreins/config.yaml
- **AC:** `gitreins guard` passes locally. All 39 server tests pass.

## [x] SWEEP-002: Wire CLI commands to server — 11 TODO stubs across 5 CLI files (completed 2026-07-15)
- **Commit:** e9ddf05 (+ 73473d6)
- **Priority:** low
- **Files:** apps/cli/src/commands/stats.ts, base-command.ts, list-games.ts, config.ts, run-game.ts
- **Resolution:** All 9 TODO stubs removed. stats.ts fetchStats() → GET /api/v1/stats. list-games.ts fetchGames() → GET /api/v1/games. run-game.ts startGame() → POST /api/v1/games. base-command.ts loadConfig/saveConfig → fs read/write. config.ts setConfig/resetConfig → fs write. 0 TODOs remain. tsc --noEmit clean. gitreins guard PASS.

## [ ] SPEC-SWEEP-003: Implement player model assignment persistence in game repository
- **Priority:** medium
- **Files:** apps/server/src/routes/index.ts:646, apps/server/src/repositories/
- **Issue:** POST /api/v1/games/:gameId/players/:playerIndex/model receives provider/model but constructs a response object inline without persisting to the game repository. The TODO at line 646 says "Implement player model assignment in game repository."
- **AC:** Player model assignments are persisted to the game repository. Game state reflects assigned models when queried. Endpoint validates gameId and playerIndex exist before assignment.

## [ ] SPEC-SWEEP-004: Implement benchmark runner
- **Priority:** medium
- **Files:** apps/server/src/routes/index.ts:859, apps/server/src/benchmark/
- **Issue:** POST /api/v1/benchmark accepts a config but returns a canned response without running any benchmarks. The TODO at line 859 says "Implement benchmark runner."
- **AC:** POST /api/v1/benchmark starts a real benchmark run. GET /api/v1/benchmark/report and /api/v1/benchmark/export return actual data from completed runs. Benchmark results are persisted.

## [ ] SERVER-TODO-001: Implement player model assignment in game repository
- **Priority:** low
- **Files:** apps/server/src/routes/index.ts (line 647), apps/server/src/db/repository.ts
- **Issue:** POST /api/v1/games/:gameId/players/:playerIndex/model accepts provider/model but doesn't persist to the database. Response is hardcoded — no actual storage.
- **AC:** Model assignments are persisted in the game repository and retrievable. POST returns saved assignment with confirmation.

## [ ] SERVER-TODO-002: Implement benchmark runner
- **Priority:** low
- **Files:** apps/server/src/routes/index.ts (line 859)
- **Issue:** POST /api/v1/benchmark accepts a config but doesn't actually run any games. Response is hardcoded "Benchmark started" with no real execution.
- **AC:** POST /api/v1/benchmark creates and runs games, returns real benchmark job ID with progress tracking.