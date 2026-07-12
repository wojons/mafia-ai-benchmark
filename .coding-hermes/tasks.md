# Mafia AI Benchmark — Foreman Board

> Migrated from Axiom to coding-hermes on 2026-07-06.
> Model: MiniMax-M3 / minimax | Schedule: every 120m

## [x] MIGRATE-001: Audit current state (completed 2026-07-08)
- **Priority:** high
- Run `pnpm install && pnpm build` to verify project builds
- Run `pnpm test` to check test health
- Report: build status, test pass/fail count, any broken deps

## [x] FIX-EVENTBUS: Fix EventBus implementation — 3 failing tests (completed 2026-07-12)
- **Commit:** 8dc0737
- **Priority:** high
- **Files:** apps/server/src/services/event-bus.ts
- **Tests:** apps/server/src/services/event-bus.test.ts (30 pass, 3 fail)
- Failing tests:
  1. `should support event filters` — handler called 2 times instead of 1 (filter not applied)
  2. `should unsubscribe by ID` — `unsubscribe(sub.id)` returns false (subscription ID missing or wrong)
  3. `should unsubscribe wildcard handlers` — handler called 2 times after unsubscribe (wildcard unsubscribe broken)
- **AC:** All 39 tests in event-bus.test.ts pass. Do NOT modify tests — fix the implementation.
- **Verification:** `cd apps/server && npx vitest run src/services/event-bus.test.ts`

## [ ] TEST-CLI: Add test files for apps/cli package
- **Priority:** medium
- **Files:** apps/cli/src/ (create __tests__/ directory with test files)
- The CLI package has zero test files. Add basic smoke tests covering CLI entry point.
- **AC:** At least 3 meaningful tests added. `pnpm test --filter @mafia/cli` exits 0.
- **Verification:** `cd apps/cli && npx vitest run`

## [ ] INFRA-SPECS: Review, organize, and commit untracked specs/docs
- **Priority:** low
- **Files:** specs/ (41 files, 25K lines), VERSION, CHANGELOG.md, .memory-bank/
- All are untracked. Review for quality, organize if needed, add to git, commit.
- **AC:** specs/ committed with a descriptive commit message. `.gitignore` updated for any files that shouldn't be tracked.
