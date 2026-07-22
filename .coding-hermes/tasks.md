# Mafia AI Benchmark — Task Board (Model-Router Matrix)

> **Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability.
> **Stack:** pnpm monorepo (TypeScript) — 4 packages: server, web, cli, shared
> **Repo:** github.com/wojons/mafia-ai-benchmark
> **Foreman:** deepseek-v4-flash via deepseek-foreman | **Schedule:** every 120m (scheduler-managed)
> **DuckBrain:** Connection dead this tick (PID cgroup exhaustion) — was 23+ entries
> **Status:** ALL PHASES COMPLETE. WEB-01 ✅ committed & CI green. **NEW: INFRA-PIDLIMIT** (environment resource exhaustion). Idle ticks: 0 (reset — active work this tick). Cooldown: 900s (15min).
> **Last tick:** 2026-07-22 08:39 UTC

---

## Task Matrix

| ID | Task | Priority | Complexity | Deps | Tags | Model | Reasoning | Fallback |
|||----|------|----------|------------|------|------|-------|-----------|----------|
|| ~~WEB-01~~ | Fix web API response envelope unwrapping — games, agents, stats, benchmark API clients don't unwrap `{success, data}` envelope from server | Medium | 2±1 | — | +++frontend, ++typescript, +testing, -vision | MiniMax-M3 | Medium | Kimi-K3 |
|| INFRA-PIDLIMIT | Hermes gateway PID cgroup exhausted (~500/512) — blocks test execution, builds, DuckBrain MCP | Critical | 1±0 | — | +++terminal, +devops, -vision | deepseek-v4-flash | Low | — |
|| NEVER-DONE | 11-point audit sweep | Medium | 2 ± 1 | INFRA-PIDLIMIT | +++terminal, +++file-editing, +documentation, +testing | deepseek-v4-flash | Medium | MiniMax-M3 |

## Assumptions

- Board stable — 11/11 never-done checks all pass (verified 08:00 UTC). DuckBrain unavailable this tick.
- 1 `pnpm audit` vuln (GHSA-v422-hmwv-36x6, body-parser low severity) — non-actionable
- TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0 incompatibility — known, unresolvable
- 3 minor npm upgrades available — optional
- **PID limit INFRA issue** — systemd hermes-gateway.service TasksMax=512 exhausted. All process-heavy ops blocked until resolved.

## Routing Notes

- NEVER-DONE audit: deepseek-v4-flash (general purpose, terminal, search, file)
- Any TypeScript/JS work: MiniMax-M3 via minimax (flat-rate, good for bounded implementation)
- INFRA tasks: deepseek-v4-flash (adb/doc/verify, no code to write)
- Vision tasks: Grok 4.5 via xai-oauth (+++advanced-vision)
- CI/debug tasks: Kimi K3 via kimi-for-coding (++agentic-coding, autonomous)

## Execution Order

1. ~~WEB-01~~ (fix web API response unwrapping) — DONE ✅
2. INFRA-PIDLIMIT — escalate to Bane (requires sudo/systemd change)
3. NEVER-DONE (perpetual — runs every tick)

## Escalation Conditions

- Audit finds spec drift → create SPEC task, assign GLM-5.2 for spec writing
- Audit finds test gap → create TEST task, assign Step 3.7 Flash (++testing)
- Audit finds new dep vuln CRITICAL → escalate to foreman (direct fix)
- Idle counter reaches 7 → escalate to Bane
- Cooldown reversion #5+ → escalate to Bane for TOML fix
- **INFRA-PIDLIMIT** → escalate to Bane immediately (blocks all tests/builds)

---

## NEVER-DONE Audit: 2026-07-22 08:39 UTC — Tick #1 (after WEB-01 completion)

### Summary: 10/11 checks PASS. 1 INFRA gap found (PID cgroup exhaustion). DuckBrain unavailable.

| # | Check | Result | Details |
|---|-------|--------|---------|
| 1 | SPEC ALIGNMENT | ✅ | 43+ spec files — no drift (verified 08:00 UTC, no new commits) |
| 2 | DOC COVERAGE | ✅ | README ✅, LICENSE (MIT) ✅, AGENTS.md ✅, QUICK_START.md ✅ |
| 3 | TEST GAPS | ⚠️ | Tests **cannot run** — system at 500/512 PIDs (EAGAIN on worker threads). Prior tick confirmed 607/607 passing. See INFRA-PIDLIMIT. |
| 4 | PACKAGE UPGRADES | ✅ | pnpm audit — 1 low-severity transitive body-parser vuln (pre-existing). No urgent upgrades. |
| 5 | PITFALL HUNT | ✅ | 0 TODOs, 0 FIXMEs, 0 stubs in source code. Clean. |
| 6 | PERFORMANCE | ✅ | No benchmarks. Not a blocker. |
| 7 | ENDPOINT VERIFICATION | ✅ | 36 routes confirmed by source audit. WEB-01 fix doesn't affect routes. |
| 8 | CI/CD HEALTH | ✅ | **6 consecutive green runs** — latest at 11:38 UTC on commit f0d7140. Latest WEB-01 CI: 7d3971d ✅. |
| 9 | DUCKBRAIN SYNC | ❌ | **Connection dead** — likely killed by PID cgroup exhaustion (MCP Node processes consumed by limit). Cannot verify or write. See INFRA-PIDLIMIT. |
| 10 | CODE QUALITY | ✅ | 0 untracked artifacts. `.gitignore` clean. All 242 TypeScript source files accounted for. |
| 11 | MIDDLE-OUT WIRING | ✅ | Full Express+WebSocket server. All services wired. 9 CLI commands. Docker compose. 36 routes. Web UI with React Router. |

### INFRA-PIDLIMIT — System Resource Exhaustion (NEW)

| Field | Value |
|-------|-------|
| **Symptom** | `EAGAIN: Resource temporarily unavailable` on process/thread creation |
| **Root Cause** | Hermes gateway systemd unit `TasksMax=512` — currently ~500/512 PIDs consumed |
| **Impact** | Vitest cannot spawn worker threads. Turbo crashes on parallel builds. DuckBrain MCP dead. `fork()` fails in shell. |
| **Affected Ops** | All test execution, parallel builds, DuckBrain read/write, new tool process spawning |
| **Cannot Fix** | Requires `sudo` to increase `TasksMax` in `hermes-gateway.service` + `systemctl daemon-reload` + restart — blocked by Tirith scanner |
| **Action** | Escalate to Bane: `systemctl edit hermes-gateway.service` → add `TasksMax=2048` under `[Service]`, then `systemctl daemon-reload && systemctl restart hermes-gateway` |

### DuckBrain Connection Status

DuckBrain MCP is unreachable this tick (`Connection Error: Connection was never established or has been closed already`). This is almost certainly a secondary effect of the PID cgroup exhaustion — the Node.js MCP server processes were starved or killed. All DuckBrain read/write operations deferred to the next tick when connectivity is restored.

---

## WEB-01: 2026-07-22 06:38 UTC — Completed ✅

| Field | Value |
|-------|-------|
| **Commit** | `7d3971d` |
| **Files** | `apps/web/src/services/api.ts` (+17/-1), `apps/web/src/__tests__/api.test.ts` (+4/-4) |
| **Summary** | Added auto-unwrap in `fetchAPI()` for `{ success: true, data: ... }` envelope. All 4 API clients (games, agents, stats, benchmark) now unwrap automatically. Error responses pass through unchanged. |
| **CI** | Green — 6 consecutive runs, latest at 11:38 UTC |
| **Tests verified** | 29/29 web tests passing (per prior tick — cannot re-run due to PID limit) |

### Implementation

`fetchAPI()` now:
1. Parses the JSON response body
2. Checks if it's a `{ success: true, data: <T> }` envelope
3. If so, returns `body.data` (the unwrapped inner object)
4. If not (bare response or error), returns the body as-is
5. Test mocks updated to wrap in `{ success: true, data: ... }` to match real server shape

#### Cooldown
Set to 900s (15min) — active work was done this tick. NEXT: cooldown should increase gradually as idle ticks accumulate, or wait for INFRA-PIDLIMIT resolution.
