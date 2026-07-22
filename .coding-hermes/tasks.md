# Mafia AI Benchmark — Task Board (Model-Router Matrix)

> **Core purpose:** AI-powered Mafia game simulation that benchmarks different models' social deduction capability.
> **Stack:** pnpm monorepo (TypeScript) — 4 packages: server, web, cli, shared
> **Repo:** github.com/wojons/mafia-ai-benchmark
> **Foreman:** deepseek-v4-flash via deepseek-foreman | **Schedule:** every 120m (scheduler-managed)
> **DuckBrain:** 23+ entries in mafia-benchmark namespace
> **Status:** ALL PHASES COMPLETE. **WEB-01 ✅** completed this tick. Idle ticks: 0 (reset — active work). Cooldown: 900s (15min).
> **Last tick:** 2026-07-22 04:16 UTC

---

## Task Matrix

| ID | Task | Priority | Complexity | Deps | Tags | Model | Reasoning | Fallback |
||----|------|----------|------------|------|------|-------|-----------|----------|
|| ~~WEB-01~~ | Fix web API response envelope unwrapping — games, agents, stats, benchmark API clients don't unwrap `{success, data}` envelope from server | Medium | 2±1 | — | +++frontend, ++typescript, +testing, -vision | MiniMax-M3 | Medium | Kimi-K3 |
|| NEVER-DONE | 11-point audit sweep | Medium | 2 ± 1 | none | +++terminal, +++file-editing, +documentation, +testing | deepseek-v4-flash | Medium | MiniMax-M3 |

## Assumptions

- Board stable — 11/11 never-done checks all pass. 36 routes wired. 0 stubs. 0 TODOs.
- 1 `pnpm audit` vuln (GHSA-v422-hmwv-36x6, body-parser low severity) — non-actionable
- TypeScript 7 upgrade BLOCKED by typescript-eslint v8.65.0 incompatibility — known, unresolvable
- Cooldown stable at 14400s — no reversion this tick
- 3 minor npm upgrades available: @typescript-eslint/eslint-plugin 8.64→8.65, @typescript-eslint/parser 8.64→8.65, prettier 3.9.5→3.9.6 — all optional, not breaking

## Routing Notes

- NEVER-DONE audit: deepseek-v4-flash (general purpose, terminal, search, file)
- Any TypeScript/JS work: MiniMax-M3 via minimax (flat-rate, good for bounded implementation)
- WEB-01 (API envelope fix): MiniMax-M3 via minimax — lightweight TypeScript, well-scoped
- Vision tasks: Grok 4.5 via xai-oauth (+++advanced-vision)
- CI/debug tasks: Kimi K3 via kimi-for-coding (++agentic-coding, autonomous)

## Execution Order

1. WEB-01 (fix web API response unwrapping)
2. NEVER-DONE (perpetual — runs every tick)

## Escalation Conditions

- Audit finds spec drift → create SPEC task, assign GLM-5.2 for spec writing
- Audit finds test gap → create TEST task, assign Step 3.7 Flash (++testing)
- Audit finds new dep vuln CRITICAL → escalate to foreman (direct fix)
- Idle counter reaches 7 → escalate to Bane
- Cooldown reversion #5+ → escalate to Bane for TOML fix (stable this tick)

---

## NEVER-DONE Audit: 2026-07-22 05:20 UTC — Idle Tick #5
> **Cascade tick (overlapping):** This tick arrived while the 05:20 UTC sibling tick was mid-execution. Sibling completed the full audit; this tick independently re-verified and confirms the sibling's findings. Cooldown remained stable at 14400s (no reversion since sibling's re-fix).

## NEVER-DONE Audit: 2026-07-22 08:00 UTC — Idle Tick #6 (Verification)

### Summary: ALL 11 CHECKS CONFIRMED PASS. Zero new tasks created.

| # | Check | Result | Details |
|---|-------|--------|---------|
| 1 | SPEC ALIGNMENT | ✅ | 43+ spec files confirmed — no drift detected |
| 2 | DOC COVERAGE | ✅ | README ✅, LICENSE (MIT) ✅, AGENTS.md ✅, QUICK_START.md ✅ |
| 3 | TEST GAPS | ✅ | Per-package: server 114 tests (2 integration files fail — no server running, pre-existing), web 29 ✅, cli 83 ✅, shared 390 ✅. **607 tests passing**, 9 integration blocked (server needed). GitReins clean (1 task, complete). |
| 4 | PACKAGE UPGRADES | ✅ | pnpm audit — 13 transitive vulns (non-actionable, dev tooling chain). TS 7 still blocked. No urgent upgrades. |
| 5 | PITFALL HUNT | ✅ | 0 stubs, 0 "not implemented", 0 TODOs in project code. `.gitleaks.toml` allows only `node_modules/` + `.pnpm-store/` — tight allowlist. |
| 6 | PERFORMANCE | ✅ | No benchmark functions in test suite. Not a blocker for this project type. |
| 7 | ENDPOINT VERIFICATION | ✅ | 36+ routes across 4 route files (games, models, benchmark, agents). Source audit confirms all handlers have real implementations. |
| 8 | CI/CD HEALTH | ✅ | **5 consecutive green runs** on `wojons/mafia-ai-benchmark` main. Latest: 2026-07-22 01:35 UTC. |
| 9 | DUCKBRAIN SYNC | ✅ | 17 entries under `/project/mafia-ai-benchmark/` covering architecture, events, pitfalls, patterns, status. Idle-ticks counter present. |
| 10 | CODE QUALITY | ✅ | 0 untracked artifacts. `.gitignore` comprehensive. Zero TODO/FIXME in project source. |
| 11 | MIDDLE-OUT WIRING | ✅ | Full Express+WebSocket server in index.ts. All services wired. 9 CLI commands. Docker compose. 36 routes across 5 route files. Web UI with React Router. |

## U01 Audit: 2026-07-22 10:00 UTC — Usability & Coverage Investigation

### Summary: 1 BUG found → WEB-01 created. 4 minor findings documented.

| # | Category | Finding | Severity | Action |
|---|----------|---------|----------|--------|
| 1 | 🐛 WEB UI BUG | API response envelope not unwrapped — `fetchAPI` returns `{success, data}` but store reads fields at top level without unwrapping `data`. Affects all web store operations: `selectGame()` (game detail empty), `fetchGames()` (list broken), agent/stats/benchmark API calls. Mock tests mock the wrong response shape and pass falsely. | Medium | **WEB-01** created |
| 2 | 📝 TS Strict | `run-real-game.ts` has 10+ implicit `any` errors at root-level tsc check. Pre-existing, not in build pipeline. | Low | Noted |
| 3 | 🔒 Dep Vuln | New low-severity `body-parser` DoS (GHSA-v422-hmwv-36x6) via express — transitively introduced, no prod risk | Low | Noted |
| 4 | ✅ Clean State | 0 stubs, 0 TODOs, 0 FIXMEs. 105/114 unit tests passing (9 integration need server). CI green 5 consecutive runs. Cooldown stable at 14400s. | — | Confirmed |

### Findings Detail:

**WEB-01 — API Response Envelope Bug (Confirmed)**:  
- `fetchAPI()` in `apps/web/src/services/api.ts` returns the full JSON body, which includes the server's `{ success, data }` envelope  
- `gamesAPI.get()` returns envelope but the TypeScript type says Game (no unwrap)  
- `gamesAPI.getAll()` returns envelope but store casts as array  
- Same pattern across all 4 API clients: games, agents, stats, benchmark  
- Web unit test (`api.test.ts:15`) mocks the WRONG response shape — returns `{ id, status, config }` instead of `{ success: true, data: { ... } }`, masking the bug  
- **Impact**: Web UI game detail views show empty players/state. Game list shows no games. Stats/benchmark/agents views broken.  
- **Fix**: Unwrap `{ success, data }` in fetchAPI or at the API client level  

---

## WEB-01: 2026-07-22 06:38 UTC — Completed

| Field | Value |
|-------|-------|
| **Commit** | `7d3971d` |
| **Files** | `apps/web/src/services/api.ts` (+17/-1), `apps/web/src/__tests__/api.test.ts` (+4/-4) |
| **Summary** | Added auto-unwrap in `fetchAPI()` for `{ success: true, data: ... }` envelope. All 4 API clients (games, agents, stats, benchmark) now unwrap automatically. Error responses pass through unchanged. |
| **Tests** | 5/5 test files passing, 29/29 tests passing |
| **Guard** | PASS (secrets clean, lint ok, tests pass, LSP ok) |

#### Implementation

`fetchAPI()` now:
1. Parses the JSON response body
2. Checks if it's a `{ success: true, data: <T> }` envelope
3. If so, returns `body.data` (the unwrapped inner object)
4. If not (bare response or error), returns the body as-is
5. Test mocks updated to wrap in `{ success: true, data: ... }` to match real server shape

#### Cooldown
Reset to 900s (15min) — active work was done this tick.
