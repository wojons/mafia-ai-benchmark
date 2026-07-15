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
- **Commit:** <pending>
- **Resolution:** Both files removed. `src/logging/` directory (now empty) also removed. Build passes (4 tasks, all cached). All 191 tests pass (server 39, shared 150, web 2).

## [x] TODO-ANALYTICS: Decide whether to commit apps/web/src/types/analytics.ts (completed 2026-07-15)
- **Commit:** <pending>
- **Resolution:** analytics.ts has ZERO references in apps/web/src/ (grep confirmed). Left untracked — not committed. Per AC, excluded.

## [ ] Fix CI: wojons/mafia-ai-benchmark — run #7 — server tests ECONNREFUSED
- **Root cause (2026-07-15):** Server API tests in `apps/server` try to connect to `localhost:3000` at test time. CI runner has no server process → ECONNREFUSED. Locally all 39 tests pass (server available). 2 test files fail on CI with 9/39 tests failing. Build workspace step passes green — only test execution fails.
- **Fix needed:** Either (a) start server before tests in CI workflow, (b) use supertest/in-process HTTP testing instead of real connections, or (c) skip API tests in CI with `test.skip` conditionals.
- **Priority:** medium