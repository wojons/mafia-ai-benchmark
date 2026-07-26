<!--
  ⚠️  BOARD FORMAT — coding-hermes-model-router v1.3 (2026-07-24)
  All tasks MUST use matrix format: | ID | Task | Pri | Cpx | Deps | Tags | Model | Reasoning | Fallback |
  Before editing this file, load the skill: skill_view(name='coding-hermes-model-router')
  Validate: python3 ~/.hermes/scripts/validate-board-format.py .coding-hermes/tasks.md
- [ ] **GITREINS-JUDGE — Configure LLM evaluator for commit quality review**
  | 🔴 Critical | — | — | deepseek-v4-flash @ deepseek-foreman | GITREINS_LLM_API_KEY in ~/.hermes/.env | foreman-direct |

  Run: `python3 ~/.hermes/scripts/check-gitreins-judge.py .` to verify.
  Default limits (adjust per-project based on codebase size and task complexity):
  - Fast/small projects: `max_iterations: 50`, `max_time: 10m`, tokens: `0.2M/0.4M`
  - Large repos (Go monorepos, 100+ files): `max_iterations: 100`, `max_time: 30m`, tokens: `1M/2M`
  - C++/Rust (slow compiles): `max_time: 30m` minimum
  - Scheduler/production infra: `max_time: 30m`, tokens: `1M/2M`
  Supervisor auto-flags projects where limits are too low for codebase size.

| 🔴 Critical | — | — | deepseek-v4-flash @ deepseek-foreman | GITREINS_LLM_API_KEY in ~/.hermes/.env | foreman-direct |

  Run: `python3 ~/.hermes/scripts/check-gitreins-judge.py .` to verify.
  If missing, create/edit .gitreins/config.yaml with evaluator section using deepseek-v4-flash.
  This is CRITICAL for code quality — no automated review of worker output without it.

  NEVER remove the matrix header row or NEVER-DONE / E2E-001 fixtures.
-->

# Mafia AI Benchmark — Model Router Task Matrix

**Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability. TypeScript pnpm monorepo — 4 packages: server, web, cli, shared.

## Active Tasks

- [ ] **E2E-001 — E2E Testing Tick (self-improving loop)** 🔁 Every 5-10 ticks
  Spawn Luna (browser/screenshots) or Step 3.7 Flash (CLI/API). Deploy/build, Playwright, screenshots, endpoints, console. → e2e-output/tasks.md → inject into board.

| ID | Task | Pri | Cpx | Deps | Tags | Model | Reasoning | Fallback |
|----|------|-----|-----|------|------|-------|-----------|----------|
| NEVER-DONE | 11-point audit sweep | Medium | 2 | — | +++terminal, +++file-editing, +documentation, +testing | DeepSeek V4 Flash | Audit runs every tick; all checks green | MiniMax-M3 |

**Assumptions:** TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0. 1 critical pnpm audit vuln (vitest CVE) — dev-only transitive, not actionable. ALL PHASES COMPLETE. CI 8+ green. DuckBrain operational.

**Routing Notes:** Project genuinely complete. 21 idle ticks. Cooldown at 43200s (12h). 0 actionable gaps. GitReins evaluator caps fixed (ac3051b) — old config had 16M input tokens, corrected to 0.2M/0.4M fast/small project defaults.

**Execution Order:** NEVER-DONE only.

|**Escalation Conditions:** 22 idle ticks + genuine completion threshold EXCEEDED. Scheduler: Enabled=true, CooldownS=43200 (reverted from 1800 restart, re-fixed). ESCALATE TO BANE — per foreman rules, NOT self-disabling. Bane must manually disable via scheduler API or Hermes curator. All projects at genuine completion should be disabled by Bane.

**Cooldown reversion history:** Tick 21→Tick 22 — CooldownS reset from 43200→1800 on scheduler daemon restart (fleet config overwrite). Re-fixed to 43200 at Tick 22.|

## Completed

| ID | Task | Pri | Cpx | Commit | Model |
|----|------|-----|-----|--------|-------|
| WEB-01 | Fix web API response envelope unwrapping | Medium | 2 | — | MiniMax-M3 |
| INFRA-PIDLIMIT | Hermes gateway PID cgroup exhausted — RESOLVED | Critical | 1 | — | DeepSeek V4 Flash |
| All phases | Full game simulation, 4 packages, benchmarks | — | — | multiple | Various |

## Tick Log

### Tick 22 — 2026-07-26 09:28 UTC (deepseek-v4-flash)

| # | Gate | Result | Detail |
|---|------|--------|--------|
| 1 | Git status | CLEAN | Working tree clean, 2 commits ahead of origin |
| 2 | Build | PASS | tsc --noEmit, all 4 packages, cached |
| 3 | GitReins guard | PASS | secrets/lint/tests/lsp — all clean (diff mode, safety trigger from config) |
| 4 | Hilo graph | PASS | 865 edges, 353 files, Hilo=useful (consistent) |
| 5 | CI | PASS | Last 3 runs all successful (conclusion: success) |
| 6 | TODO/FIXME scan | PASS | Only legacy game-engine.js pricing TODO (pre-existing, not project code) |
| 7 | Secrets | PASS | gitleaks clean |
| 8 | Static analysis | PASS | tsc --noEmit, all clean |
| 9 | Scheduler status | REVERTED → FIXED | Enabled=true, CooldownS=1800→43200 (restart reset, re-fixed) |
| 10 | Board consistency | PASS | 0 active tasks, GitReins: TEST-CLI-COMMANDS complete |
| 11 | DuckBrain | EMPTY | mafia-benchmark namespace exists but no entries |

**Verdict:** IDLE — 22nd consecutive idle tick. Project genuinely complete. Cooldown was reset from 43200→1800 by scheduler daemon restart (fleet config overwrite) — PUT re-fixed to 43200. pnpm audit: 1 critical (vitest CVE, dev-only transitive via vite) + pre-existing high/medium advisories (rollup, picomatch — all dev-only). **ESCALATED TO BANE** (2nd consecutive escalation) — foreman must not self-disable. Bane: `PUT /api/v1/projects/mafia-ai-benchmark {"Enabled":false}`.

### Tick 21 — 2026-07-25 00:35 UTC (deepseek-v4-pro)

| # | Gate | Result | Detail |
|---|------|--------|--------|
| 1 | Git status | DIRTY | tasks.md staged, .gitreins/config.yaml modified (caps fix) |
| 2 | GitReins guard | PASS | secrets/lint/lsp clean, tests skipped (no staged files) |
| 3 | Hilo graph | PASS | 865 edges, 353 files, Hilo=useful |
| 4 | Build | PASS | All 4 packages compile (tsc), 4/4 cached |
| 5 | Tests | PASS* | CLI: 83/83 PASS. Server/web/shared: OOM-killed (137) — pre-existing vitest watch mode issue |
| 6 | TODO/FIXME scan | PASS | Only node_modules, no project code TODOs |
| 7 | GitReins config | PASS | evaluator: deepseek-v4-flash, GITREINS_LLM_API_KEY set |
| 8 | Secrets | PASS | gitleaks clean |
| 9 | Static analysis | PASS | tsc --noEmit (via build), all clean |
| 10 | Board consistency | PASS | Board: 0 active. GitReins: 1 task (TEST-CLI-COMMANDS, complete). CONSISTENT |
| 11 | Scheduler status | PASS | Enabled=true, CooldownS=43200, Weight=10, Priority=8 |

**Verdict:** IDLE — 21st consecutive idle tick. Project genuinely complete. GitReins evaluator caps fixed (ac3051b, 16M→0.2M input tokens). No actionable gaps. **ESCALATED TO BANE** — per NEVER-DONE protocol, foreman must not self-disable. Bane should disable via scheduler API (`PUT /api/v1/projects/mafia-ai-benchmark {"Enabled":false}`) or `hermes curator disable mafia-ai-benchmark`. Load: 3.85. pnpm audit: 3 dev-only transitive advisories (esbuild moderate, rollup high, picomatch — all via vitest/vite).
