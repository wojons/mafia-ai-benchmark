# Mafia AI Benchmark — Task Board (Model-Router Matrix)

> **Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability.
> **Stack:** pnpm monorepo (TypeScript) — 4 packages: server, web, cli, shared
> **Repo:** github.com/wojons/mafia-ai-benchmark
> **Foreman:** MiniMax-M3 via minimax | **Schedule:** every 120m
> **DuckBrain:** 18 entries in mafia-ai-benchmark namespace
> **Status:** ALL PHASES COMPLETE. Idle tick 1/7. Cooldown: 14400s (4h). ⚠️ 3rd cooldown reversion.
> **Last tick:** 2026-07-21 00:22 UTC

---

## Task Matrix

| ID | Task | Priority | Complexity | Deps | Tags | Model | Reasoning | Fallback |
|----|------|----------|------------|------|------|-------|-----------|----------|
| NEVER-DONE | 11-point audit sweep | Medium | 2 ± 1 | none | +++terminal, +++file-editing, +documentation, +testing | deepseek-v4-pro | Medium | MiniMax-M3 |

## Assumptions

- Board stable — 11/11 never-done checks all pass. All 36 routes wired. 0 stubs. 0 TODOs.
- 13 `pnpm audit` vulns are all transitive dev tooling (vitest→vite→rollup→esbuild) — non-actionable
- TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0 incompatibility — known, unresolvable
- Cooldown reversion 14400→1800s after daemon restart (3rd occurrence) — needs TOML config fix by Bane

## Routing Notes

- NEVER-DONE audit: deepseek-v4-pro (needs full context, 1M context window, terminal, search)
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
- Cooldown reversion #4 → escalate to Bane for TOML fix
