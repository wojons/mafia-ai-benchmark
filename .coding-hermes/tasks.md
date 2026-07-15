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

## [ ] CHORE-CLEANUP: Remove stale artifacts (index.ts.bak, legacy-logger.js)
- **Priority:** low
- **Files:** apps/server/src/routes/index.ts.bak, src/logging/legacy-logger.js
- **AC:** Stale files removed. `pnpm build` still passes, tests still pass.

## [ ] TODO-ANALYTICS: Decide whether to commit apps/web/src/types/analytics.ts
- **Priority:** low
- **Files:** apps/web/src/types/analytics.ts (95 lines, untracked)
- **Question:** Is this referenced by the web app? If yes, commit it. If no, add to .gitignore or remove.
- **AC:** Either committed (if referenced) or excluded. Build+test pass.
