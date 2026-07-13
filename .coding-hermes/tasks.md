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

## [x] TEST-CLI: Add test files for apps/cli package (completed 2026-07-12)
- **Commit:** 58ec988
- **Priority:** medium
- **Files:** apps/cli/src/__tests__/index.test.ts, base-command.test.ts, init-command.test.ts
- 20 tests across 3 test files. All pass. Guard PASS.

## [x] INFRA-SPECS: Review, organize, and commit untracked specs/docs (completed 2026-07-12)
- **Commit:** 1fd7ed3
- **Priority:** low
- 57 files, 4205 lines: specs/ (7 new files), .memory-bank/ (48 files), VERSION, CHANGELOG.md.
- Guard PASS. Remaining 34 spec files already tracked in git.
