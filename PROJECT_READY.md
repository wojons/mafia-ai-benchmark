# 🎯 Mafia AI Benchmark — Project Ready Summary

An advanced AI-powered Mafia game simulation that benchmarks different AI models'
ability to play the classic social deduction game. Autonomous LLM agents (GPT-4o-mini,
Claude, etc.) take on rich personas, deliberate in private (THINK) and public (SAYS)
channels, and play through full night/day cycles — all while the system tracks
win rates, token usage, and API cost per game.

The full guide is **[README.md](README.md)**; contributor/architecture context lives
in **[AGENTS.md](AGENTS.md)**. This file is a complete-system summary.

## 📦 Monorepo Layout

| Package | Role | Key Surface |
| --- | --- | --- |
| `apps/server` | Express + WebSocket game server | API **:3004**, WS **/ws** |
| `apps/web` | React + Vite + Chart.js dashboard | **:5174** (API/WS proxied) |
| `apps/cli` | `mafiactl` CLI: games, benchmarks, stats, config | `pnpm --filter @mafia/cli <cmd>` |
| `packages/shared` | Shared types, FSM, events, providers, personas | imported by all apps |

Test runners are vitest across all packages; the suite covers shared logic, server
API/WS flows, CLI commands, and the web dashboard.

## 🚀 How to Run

### Option A — Docker (full stack)

```bash
docker compose up -d          # server + web, wired together
docker compose logs -f        # follow logs
```

### Option B — Local dev (pnpm)

```bash
pnpm install                  # install dependencies
# add OPENAI_API_KEY (+ optional OPENAI_BASE_URL, MODEL) to .env
pnpm build                    # build all packages
pnpm --filter @mafia/server dev   # terminal 1: API :3004 + WS /ws
pnpm --filter @mafia/web dev      # terminal 2: dashboard :5174
```

## 🧪 Running a Benchmark

```bash
# Show the accumulated benchmark report (server must be running)
pnpm --filter @mafia/cli benchmark

# Kick off a fresh benchmark run and poll it to completion
pnpm --filter @mafia/cli benchmark --games 2 --models openai/gpt-4o-mini,openai/gpt-4o

# Export results
pnpm --filter @mafia/cli benchmark --export results.json --json
```

The CLI (`mafiactl`) also offers `game:run`, `game:watch`, `stats`, `list-games`,
and `config` subcommands — see `pnpm --filter @mafia/cli --help` for details.

## ✅ Project Status

The project is fully operational: build passes across all packages, the test suite
is green, and live benchmark runs complete end-to-end (real games driven by real
LLM calls — no fabricated results). See **[README.md](README.md)** for feature
details and **[AGENTS.md](AGENTS.md)** for architecture and the GitReins quality
gate every change must pass.
