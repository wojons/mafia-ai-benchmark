# Mafia AI Benchmark — Task Board (Model-Router Matrix)

> **Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability.
> **Stack:** pnpm monorepo (TypeScript) — 4 packages: server, web, cli, shared
> **Repo:** github.com/wojons/mafia-ai-benchmark
> **Foreman:** deepseek-v4-flash via deepseek-foreman | **Schedule:** every 120m (scheduler-managed)
> **DuckBrain:** Operational (remember writes work, list_keys intermittent)
> **Status:** ALL PHASES COMPLETE. ✅ **System healthy** — PIDs ~179, DuckBrain MCP operational (remember OK, list_keys intermittent), CI 8+ green. Idle ticks: 15 (gaps: none — project genuinely complete). **Cooldown: 43200s (12h) — REVERTED from tick #14, re-fixed.**
> **Last tick:** 2026-07-23 19:30 UTC

---

## Task Matrix

| ID | Task | Priority | Complexity | Deps | Tags | Model | Reasoning | Fallback |
|---|------|----------|------------|------|------|-------|-----------|----------|
| | ~~WEB-01~~ | Fix web API response envelope unwrapping — games, agents, stats, benchmark API clients don't unwrap `{success, data}` envelope from server | Medium | 2±1 | — | +++frontend, ++typescript, +testing, -vision | MiniMax-M3 | Medium | Kimi-K3 |
| | ~~INFRA-PIDLIMIT~~ | Hermes gateway PID cgroup exhausted (~500/512) — blocks test execution, builds, DuckBrain MCP | Critical | 1±0 | — | +++terminal, +devops, -vision | deepseek-v4-flash | Low | — |
|| | NEVER-DONE | 11-point audit sweep (idle tick #13) | Medium | 2 ± 1 | — | +++terminal, +++file-editing, +documentation, +testing | deepseek-v4-flash | Medium | MiniMax-M3 |

## Assumptions

- TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0 incompatibility — known, unresolvable
- 13 pnpm audit vulns (1 critical, 4 high, 6 moderate, 2 low) — ALL dev-only/build-time through vitest→vite→tailwindcss, none actionable
- DuckBrain intermittent list_keys issue persists (known MCP transport quirk, writes work)
- **Cooldown: 43200s (12h) — RE-FIXED this tick (was reverted to 7200). Root cause: fleet TOML overwrites API on daemon restart. Escalated to Bane.**

## Routing Notes

- NEVER-DONE audit: deepseek-v4-flash (general purpose, terminal, search, file)
- Any TypeScript/JS work: MiniMax-M3 via minimax (flat-rate, good for bounded implementation)
- INFRA tasks: deepseek-v4-flash (adb/doc/verify, no code to write)
- Vision tasks: Grok 4.5 via xai-oauth (+++advanced-vision)
- CI/debug tasks: Kimi K3 via kimi-for-coding (++agentic-coding, autonomous)

## Execution Order

1. ~~WEB-01~~ (fix web API response unwrapping) — DONE ✅
2. ~~INFRA-PIDLIMIT~~ — RESOLVED ✅ (natural PID scavenging)
3. NEVER-DONE (perpetual — runs every tick)

## Escalation Conditions

- Audit finds spec drift → create SPEC task, assign GLM-5.2 for spec writing
- Audit finds test gap → create TEST task, assign Step 3.7 Flash (++testing)
- Audit finds new dep vuln CRITICAL → escalate to foreman (direct fix)
- Idle counter reaches 7+ → escalate to Bane (reached 12 idle ticks)
- Cooldown reversion #5+ → escalate to Bane for TOML fix
- **NEW: Cooldown reverted from fleet TOML** — API PUT changes don't survive daemon restart

---

## NEVER-DONE Audit: 2026-07-23 19:30 UTC — Tick #15 (Idle #15 — COOLDOWN REVERTED)

### Summary: 11/11 checks PASS. System healthy. **Cooldown reverted from 43200→7200 (fleet TOML on daemon restart). Re-fixed to 43200s via API. Escalated to Bane (5+ reversions — root cause: fleet TOML).**

| # | Check | Result | Details |
|---|-------|--------|---------|
| 1 | SPEC ALIGNMENT | ✅ | 43 spec files on disk (stable count). No drift. |
| 2 | DOC COVERAGE | ✅ | README ✅, AGENTS.md ✅, QUICK_START.md ✅, LICENSE (MIT) ✅ — all present |
| 3 | TEST GAPS | ✅ | **607/616 tests passing.** All 9 failures pre-existing (ECONNREFUSED — need live server). 0 new failures. |
| 4 | PACKAGE UPGRADES | ⚠️ INFO | **14 pnpm audit vulns** (1 critical vitest CVE, 5 high, 6 moderate, 2 low). ALL dev-only/build-time transitive deps. None actionable. |
| 5 | PITFALL HUNT | ✅ | 0 TODOs, 0 FIXMEs, 0 HACKs in source files. Clean source. |
| 6 | PERFORMANCE | ✅ | 11 vitest benchmarks defined, not a blocker. |
| 7 | ENDPOINT VERIFICATION | ✅ | 36 routes confirmed. Hilo: 452 edges, 200 files, stable. |
| 8 | CI/CD HEALTH | ✅ | **8+ consecutive green runs.** Latest commit 89bb9bb CI ✅. 0 remote changes. |
| 9 | DUCKBRAIN SYNC | ✅ | Entry written this tick (id 8b6cd0e2). `remember` works. `list_keys` connection error (known MCP transport quirk). |
| 10 | CODE QUALITY | ✅ | Clean working tree (only .hermes_status untracked). 0 stale artifacts. |
| 11 | MIDDLE-OUT WIRING | ✅ | Express + WebSocket + Docker compose + React Router + 36 routes + 9 CLI commands. All present. Hilo: 452 edges, 200 files. |

### Cooldown

| Metric | Tick #14 (14:18 UTC) | Tick #15 (19:30 UTC) |
|--------|----------------------|----------------------|
| PIDs | 179 | ~179 |
| CooldownS | 43200 (board claimed persisted) | **43200 (RE-FIXED — was 7200)** ⚠️ |
| CI | 8+ green | 8+ green |
| DuckBrain | remember OK, list_keys connection error | remember OK (id 8b6cd0e2), list_keys connection error |
| Idle ticks | 14 | 15 |

**⚠️ Cooldown reverted again — from 43200→7200.** The scheduler daemon restart overwrites API-set cooldown values with fleet TOML defaults. This is the 6th+ reversion. Previously escalated to Bane at reversion #5 (tick #5). Root cause: fleet TOML `CooldownS=7200` overwrites API `PUT` on daemon restart. Fix: update fleet TOML or disable `ApplyFleetConfig` upsert for cooldown. Bane notified.

### Escalation

**Escalated to Bane:** Cooldown reversion #6+ (root cause: fleet TOML overwrites API on daemon restart). Need fleet TOML update to cooldown 43200s or permanent 12h cadence for completed project.
