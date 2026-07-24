# Mafia AI Benchmark — Model Router Task Matrix

**Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability. TypeScript pnpm monorepo — 4 packages: server, web, cli, shared.

## Active Tasks

- [ ] **E2E-001 — E2E Testing Tick (self-improving loop)** 🔁 Every 5-10 ticks
  Spawn Luna (browser/screenshots) or Step 3.7 Flash (CLI/API). Deploy/build, Playwright, screenshots, endpoints, console. → e2e-output/tasks.md → inject into board.

| ID | Task | Pri | Cpx | Deps | Tags | Model | Reasoning | Fallback |
|----|------|-----|-----|------|------|-------|-----------|----------|
| NEVER-DONE | 11-point audit sweep | Medium | 2 | — | +++terminal, +++file-editing, +documentation, +testing | DeepSeek V4 Flash | Audit runs every tick; all checks green | MiniMax-M3 |

**Assumptions:** TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0. 1 critical pnpm audit vuln (vitest CVE) — dev-only transitive, not actionable. ALL PHASES COMPLETE. CI 8+ green. DuckBrain operational.

**Routing Notes:** Project genuinely complete. 20 idle ticks. Cooldown at 43200s (12h) — HELD this tick (no reversion). 0 actionable gaps.

**Execution Order:** NEVER-DONE only.

**Escalation Conditions:** 20 idle ticks. Cooldown held at 43200s this tick. Escalate to Bane — disable at 20 idle ticks + genuine completion.

## Completed

| ID | Task | Pri | Cpx | Commit | Model |
|----|------|-----|-----|--------|-------|
| WEB-01 | Fix web API response envelope unwrapping | Medium | 2 | — | MiniMax-M3 |
| INFRA-PIDLIMIT | Hermes gateway PID cgroup exhausted — RESOLVED | Critical | 1 | — | DeepSeek V4 Flash |
| All phases | Full game simulation, 4 packages, benchmarks | — | — | multiple | Various |
