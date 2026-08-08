# Mafia AI Benchmark — AGENTS.md

An advanced AI-powered Mafia game simulation that benchmarks different AI models' ability to play the classic social deduction game. Features split-pane consciousness (THINK/SAYS), real-time game mechanics, role-based strategies, and comprehensive event sourcing.

## Architecture

pnpm monorepo with 6 workspace packages:

| Package | Role | Test Runner |
|---------|------|-------------|
| `apps/server` | Express + WebSocket game server | vitest |
| `apps/web` | React + Vite + Chart.js dashboard | vitest |
| `apps/cli` | CLI tooling | vitest |
| `packages/shared` | Shared types, FSM, events, providers, personas | vitest |
| `.opencode` | Axiom/OpenCode agents and plugins | vitest |
| `game-engine.js` | Legacy 5,303-line game engine (root) | N/A |

Key files:
- `docker-compose.yml` — Server (API :3004; internal :3000, WS /ws) + Web (:5174 via nginx, API/WS proxied)
- `.env` — OPENAI_API_KEY, OPENAI_BASE_URL, MODEL
- `pnpm-workspace.yaml` — workspace definition

---

## GitReins Quality Harness (MANDATORY)

This repo uses GitReins as its quality gate. Every commit runs static guards.
If guards fail, the commit is BLOCKED. You cannot skip this.

### Quick check before committing:

```bash
PATH="$HOME/gitreins-poc/.venv/bin:$PATH" gitreins guard
```

### What's checked:
- **secrets** — API keys, tokens, passwords (BLOCKS on fail — no exceptions)
- **build** — compiles the project (BLOCKS on fail)
- **lint** — eslint / tsc --noEmit (WARNS on fail)
- **tests** — runs vitest for changed packages only (BLOCKS on fail)

### Test mode: diff
Only packages with staged changes are tested. Pre-existing failures in
untouched code will NOT block your commit. If you change `pnpm-workspace.yaml`,
`package.json`, `.gitreins/config.yaml`, or a config file, the full suite runs
as a safety net.

### Tasks and evaluation:

```bash
# Create a task with criteria
gitreins task create persona-v2 "Dual-identity persona system" \
  "Mafia players have a mafiaPersona archetype" \
  "Mafia players have a townCover identity" \
  "No mafia role leaked in public SAYS events" \
  "Town players have role-specific behavioral directives"

# Do the work, then evaluate:
gitreins task start persona-v2
# ... implement ...
gitreins task complete persona-v2    # triggers LLM evaluation

# Or evaluate standalone:
gitreins judge persona-v2
```

### If guards fail:
1. READ the output — the guard tells you exactly what failed and where
2. Fix the issues. Do NOT commit with `--no-verify` unless it's a docs-only
   change or a GitReins self-upgrade.
3. Re-run `gitreins guard` until it passes
4. Then commit

### Never:
- Commit API keys or tokens — secrets guard catches these, and it's correct
- Skip guards with `--no-verify` for code changes
- Push if guards failed (let CI catch it if you must, but fix locally)
- Commit `.gitreins/tasks.yaml` — it's local task state
