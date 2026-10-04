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

## Repo layout exceptions

Documented by CLN-1 (2026-09-24), conservative root-hygiene pass:

- **Root docs intentionally left at root.** README-linked docs stay: ARCHITECTURE.md,
  CONFIG_GUIDE.md, GAME_MANAGEMENT.md, PROJECT_READY.md, POSTER.md, QUICK_REFERENCE.md,
  FLEXIBLE_PLAYER_MODELS.md, PERSONALIZED_AI_MODELS.md (all referenced from README.md /
  QUICK_START.md; moving them would break links). CHANGELOG.md and PROMPT.md have no
  load-bearing reference scan hits but stay: CHANGELOG.md is a root convention, PROMPT.md
  is listed in the project tree diagram in `specs/implementation-overview.md`.
- **docs/SYSTEM_STATUS.md** was moved from the root (the only misplaced doc: zero
  references anywhere outside itself).
- **Tooling dirs stay at root by design**: `.memory-bank/`, `.opencode/`, `.axiom/`,
  `.mafia-config`, `.graph-harness/`, `.vfs/`, `.worktrees/`, `.hermes/` — agent/tooling
  state, not doc content.
- **`.gitignore`** now covers Python cache dirs (`__pycache__/`, `.pytest_cache/`,
  `.ruff_cache/`) as legacy-tooling hygiene; the repo's build/test pipeline is
  TypeScript/pnpm only.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
