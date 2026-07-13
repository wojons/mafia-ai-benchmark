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

## [x] DOC-SWEEP-001: Fix README.md path from `/config/workspace/mafia` to actual location (completed 2026-07-12)
- **Commit:** bbdd4c6
- **Priority:** low
- **Files:** README.md
- README Quick Start says `cd /config/workspace/mafia` — updated to generic `cd mafia-ai-benchmark`.
- **AC:** README Quick Start section references correct path. Verified: zero matches for `/config/workspace/mafia`.

## [ ] SPEC-SWEEP-001: Write axiom-level spec for benchmark runner
- **Priority:** medium
- **Source:** TODO at apps/server/src/routes/index.ts:859
- Write a 10-section axiom-level spec (Overview→Dependencies→Interface→Behavior→Data→States→Errors→Testing→Security→Performance) for the benchmark runner feature.
- **AC:** Spec file exists under specs/ with exact TypeScript interfaces, test scenarios, error paths, and data flow diagram.

## [ ] SPEC-SWEEP-002: Write axiom-level spec for player model assignment
- **Priority:** medium
- **Source:** TODO at apps/server/src/routes/index.ts:646
- Write a 10-section axiom-level spec for player model assignment in game repository.
- **AC:** Spec file exists under specs/ with exact TypeScript interfaces, repository method signatures, error paths, and data flow diagram.

## [ ] CI-SWEEP-001: Set up GitHub Actions CI pipeline
- **Priority:** medium
- **Files:** .github/workflows/ci.yml (new)
- No CI pipeline currently configured — GitHub Actions returns 404.
- Set up CI workflow: pnpm install → pnpm build → per-package vitest run.
- **AC:** CI runs on push to main, all 4 packages build and 211 tests pass.
