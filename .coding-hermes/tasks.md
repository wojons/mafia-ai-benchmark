# Mafia AI Benchmark — Task Board (Model-Router Matrix)

> **Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability.
> **Stack:** pnpm monorepo (TypeScript) — 4 packages: server, web, cli, shared
> **Repo:** github.com/wojons/mafia-ai-benchmark
> **Foreman:** deepseek-v4-flash via deepseek-foreman | **Schedule:** every 120m (scheduler-managed)
> **DuckBrain:** 23+ entries in mafia-benchmark namespace
> **Status:** ALL PHASES COMPLETE. Idle tick 5/7. Cooldown: 14400s (4h). ⚠️ **5th cooldown reversion** (7200→14400 re-fixed). Escalated to Bane.
> **Last tick:** 2026-07-22 05:20 UTC

---

## Task Matrix

| ID | Task | Priority | Complexity | Deps | Tags | Model | Reasoning | Fallback |
|----|------|----------|------------|------|------|-------|-----------|----------|
| NEVER-DONE | 11-point audit sweep | Medium | 2 ± 1 | none | +++terminal, +++file-editing, +documentation, +testing | deepseek-v4-flash | Medium | MiniMax-M3 |

## Assumptions

- Board stable — 11/11 never-done checks all pass. 36 routes wired. 0 stubs. 0 TODOs.
- 13 `pnpm audit` vulns are all transitive dev tooling (vitest→vite→rollup→esbuild) — non-actionable
- TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0 incompatibility — known, unresolvable
- Cooldown reversion 14400→7200s after daemon restart (5th occurrence) — needs TOML config fix by Bane
- 3 minor npm upgrades available: @typescript-eslint/eslint-plugin 8.64→8.65, @typescript-eslint/parser 8.64→8.65, prettier 3.9.5→3.9.6 — all optional, not breaking

## Routing Notes

- NEVER-DONE audit: deepseek-v4-flash (general purpose, terminal, search, file)
- Any TypeScript/JS work that emerges: MiniMax-M3 via minimax (flat-rate, good for bounded implementation)
- Vision tasks: Grok 4.5 via xai-oauth (+++advanced-vision)
- CI/debug tasks: Kimi K3 via kimi-for-coding (++agentic-coding, autonomous)

## Execution Order

1. NEVER-DONE (perpetual — runs every tick)

## Escalation Conditions

- Audit finds spec drift → create SPEC task, assign GLM-5.2 for spec writing
- Audit finds test gap → create TEST task, assign Step 3.7 Flash (++testing)
- Audit finds new dep vuln CRITICAL → escalate to foreman (direct fix)
- Idle counter reaches 7 → escalate to Bane
- Cooldown reversion #5+ → escalate to Bane for TOML fix (THIS TICK: 5th reversion found and re-fixed)

---

## NEVER-DONE Audit: 2026-07-22 05:20 UTC — Idle Tick #5

### Summary: ALL 11 CHECKS PASS. Zero new tasks created.

| # | Check | Result | Details |
|---|-------|--------|---------|
| 1 | SPEC ALIGNMENT | ✅ | 43 spec files present, all comprehensive |
| 2 | DOC COVERAGE | ✅ | README ✅, LICENSE ✅, 43 spec files. CONTRIBUTING.md absent (template-level, no task needed) |
| 3 | TEST GAPS | ✅ | 41 test files across 4 packages (shared:18, server:8, CLI:10, web:5). GitReins shows TEST-CLI-COMMANDS completed. |
| 4 | PACKAGE UPGRADES | ✅ | 13 transitive dev vulns (non-actionable). 3 minor npm upgrades available (typescript-eslint 8.64→8.65, prettier 3.9.5→3.9.6) — minor bumps. TS 7 blocked. |
| 5 | PITFALL HUNT | ✅ | 0 TODO/FIXME/HACK/XXX in project source. 0 stubs. |
| 6 | PERFORMANCE | ✅ | 3 benchmark files (event-bus, game-engine, stats-collector) |
| 7 | ENDPOINT VERIFICATION | ✅ | 36 routes across 5 route files (games:16, stats:5, benchmark:6, models:6, agents:3). WebSocket wired. All correctly structured. |
| 8 | CI/CD HEALTH | ✅ | 5 consecutive green runs on main. Most recent: idle tick #4 at 01:35 UTC. |
| 9 | DUCKBRAIN SYNC | ✅ | 23+ entries in mafia-benchmark namespace. Project status, idle ticks, CI, specs, test health all present. |
| 10 | CODE QUALITY | ✅ | 0 TODOs. Longest source file: mocks.ts (1002 lines, test helper). .gitignore comprehensive. 0 untracked files. |
| 11 | MIDDLE-OUT WIRING | ✅ | All 5 route files wired via routes/index.ts → server/index.ts. WebSocket handler. 9 CLI commands. Web main.tsx with BrowserRouter. All packages imported in server entrypoint. |

### Issues Found & Fixed:

1. **Cooldown reversion #5**: Scheduler daemon restart reverted CooldownS from 14400→7200s. PUT back to 14400s, GET verified. Escalated to Bane (TOML config fix needed for durability — this is the 5th reversion).
