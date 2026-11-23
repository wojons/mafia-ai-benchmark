# 🎮 Mafia AI Benchmark

An advanced AI-powered Mafia game simulation that benchmarks different AI models' ability to play the classic social deduction game. Features real-time game mechanics, role-based strategies, comprehensive event sourcing, and rich AI personas.

<p align="center">
  <img src="docs/screenshots/mafia-hero.jpg" alt="Mafia AI Benchmark — social deduction for AI models" width="100%">
</p>

## 🖥️ Web Dashboard

<p align="center">
  <img src="docs/screenshots/mafia-webui.png" alt="Mafia AI Benchmark web dashboard" width="100%">
  <br>
  <em>Manage and watch games from the browser — live game states, stats, and benchmarks.</em>
</p>

## ✨ Features

- **🤖 AI Agents**: Autonomous players powered by LLMs (GPT-4o-mini, Claude, etc.)
- **🔀 Multiple AI Providers**: Benchmark any OpenRouter model head-to-head per player — e.g. `benchmark --models openai/gpt-4o-mini,openai/gpt-4o` (see [FLEXIBLE_PLAYER_MODELS.md](FLEXIBLE_PLAYER_MODELS.md) and [PERSONALIZED_AI_MODELS.md](PERSONALIZED_AI_MODELS.md))
- **🎭 Dynamic Personas**: Unique characters with diverse backgrounds, communication styles, and personalities
- **🎛️ Full Configuration**: Control players, phase durations, AI models, and more
- **🎯 Correct Game Flow**: Mafia team discussion with consensus (not single-turn votes)
- **💬 Split-Pane Consciousness**: Private reasoning (THINK) vs public statements (SAYS)
- **🌙 Night Phase**: Mafia discussion, Doctor protection, Sheriff investigation, Vigilante action
- **☀️ Day Phase**: Discussion, voting, lynching
- **📊 Event Sourcing**: Complete game audit trail with visibility levels
- **💰 Cost Tracking**: Track API costs per game and player
- **🧪 1375 Tests**: Comprehensive test coverage (420 shared, 715 server, 136 CLI, 104 web)

## 🚀 Quick Start

**New here?** Start with **[QUICK_START.md](QUICK_START.md)** - 5 minute setup guide!

### TL;DR - Get Running Now

```bash
cd mafia-ai-benchmark

# 1. Install dependencies
pnpm install

# 2. Copy the sample env and add your API key (required!)
cp .env.sample .env
nano .env

# Note: `docker compose up` works without .env (env_file is optional); the
# server boots but LLM-backed games need real keys copied from .env.sample.

# OPENAI_API_KEY=sk-or-v1-YOUR-KEY-HERE
# OPENAI_BASE_URL and DEFAULT_MODEL are also required — see .env.sample for all options

# 3. Build all packages
pnpm build

# 4. Start the server
pnpm --filter @mafia/server dev

# 5. In another terminal, show the accumulated benchmark report
pnpm --filter @mafia/cli dev -- benchmark

# Benchmark multiple models head-to-head (default: openai/gpt-4o-mini,openai/gpt-4o)
pnpm --filter @mafia/cli dev -- benchmark --models openai/gpt-4o-mini,openai/gpt-4o
```

### Docker Quick Path

No Node.js or pnpm on the host? The compose stack builds everything inside
Docker — the only install path that skips the fresh-clone pnpm setup entirely:

```bash
# 1. Copy the sample env and add your API key (required!)
cp .env.sample .env
nano .env
# OPENAI_API_KEY=sk-or-...HERE

# 2. Build and start the full stack (server + web dashboard)
docker compose up -d --build

# 3. Open the dashboard and check the API
#    Dashboard: http://localhost:5174
#    API health: http://localhost:3004/health
```

**Prerequisite:** Docker Engine **plus** the Docker Compose v2 plugin
(`docker compose`, the subcommand — NOT the legacy `docker-compose` binary).
On a bare Debian/Ubuntu host that means installing the `docker-compose-plugin`
(or `docker-compose-v2`) package alongside Docker Engine. If you have no
root/sudo access on the host, there is no compose path — fall back to the pnpm
steps above.

Already have the stack up and just pulled code changes? The container only
runs what it was built with — see the **Docker Deployment** section of
[QUICK_START.md](QUICK_START.md) for the rebuild-after-code-change rule.

### What You'll See

```
🎮 Mafia AI Benchmark - Monorepo Edition
🔒 Generating personas...
  😈 Vincent Marino (MAFIA) - Traits: analytical, reserved, meticulous
  😈 Francesco 'Frankie' Moretti (MAFIA) - Traits: empathetic, determined
  💉 Vincent 'Vince' Romano (DOCTOR) - Traits: charismatic, trustworthy
  👮 Margaret 'Maggie' Sinclair (SHERIFF) - Traits: observant, friendly

🌙 NIGHT 1
😈 Mafia Chat: Real strategy discussion...
💉 Doctor: Protects someone...
👮 Sheriff: Investigates someone...

☀️ DAY 1
💬 Discussion and voting...
🏆 Mafia or Town wins!
```

## 📖 Documentation

| Document                                                       | Purpose                            |
| -------------------------------------------------------------- | ---------------------------------- |
| **[README.md](README.md)**                                     | This file - quick start & overview |
| **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)**                   | Command cheat sheet                |
| **[CONFIG_GUIDE.md](CONFIG_GUIDE.md)**                         | Complete configuration guide       |
| **[GAME_MANAGEMENT.md](GAME_MANAGEMENT.md)**                   | Detailed game management           |
| **[ARCHITECTURE.md](ARCHITECTURE.md)**                         | System architecture & design       |
| **[PROJECT_READY.md](PROJECT_READY.md)**                       | Complete system summary            |
| **[POSTER.md](POSTER.md)**                                     | Visual system overview             |
| **[specs/correct-night-flow.md](specs/correct-night-flow.md)** | Game flow specification            |
| **[specs/persona-system.md](specs/persona-system.md)**         | Persona system documentation       |
| **[docs/api-reference.md](docs/api-reference.md)**             | API reference & integration guide  |
| OpenAPI spec: `apps/server/openapi.yaml`                       | Machine-readable API spec          |

## 🎭 Persona System

Each AI agent now has a unique persona!

### Features

- **6 Archetype Categories**: Historical, Fictional, Anime, Stereotypes, Abstract, Fantasy
- **8 Communication Styles**: Formal, Casual, Southern, British, Gangster, Valley Girl, Southern Gentleman, Pirate
- **Diverse Names**: Western, Eastern, Latin, Nordic, African naming conventions
- **Rich Backstories**: Origin stories that inform decision-making
- **Personal Flaws**: Weaknesses that affect gameplay

### Example Persona

```
🎭 James "Ace" Tanaka (Julius Caesar archetype)
   📝 Origin: Former military commander who led successful campaigns
   💬 Communication: Formal with dry, intellectual humor
   ⭐ Traits: Charismatic, Strategic, Ambitious
   💔 Flaw: Prideful - struggles to admit when wrong
   🗣️ Verbal Tics: "Indeed", "Furthermore"
```

See **[specs/persona-system.md](specs/persona-system.md)** for complete documentation.

## 🎛️ Configuration System

The CLI has two configuration surfaces: **run-game flags** (per-game overrides) and **persistent config** (stored in `mafia.config.json`).

### Run-Game Flags

Pass these to `run-game` to override defaults for a single game:

```bash
pnpm --filter @mafia/cli dev -- run-game [options]

Options:
  --players <n>        Number of players (default: 10)
  --provider <name>    LLM provider (default: "openai")
  --model <name>       LLM model (default: "openai/gpt-4o-mini")
  --auto, --yes        Run without confirmation prompt
  --watch              Watch game in real-time
  --server <url>       Server base URL (default: http://localhost:3004)
  -c, --config <path>  Configuration file path (default: "./mafia.config.json")
```

**Example:**

```bash
# 7-player game with GPT-4o, auto-start, watch live
pnpm --filter @mafia/cli dev -- run-game --players 7 --model openai/gpt-4o --auto --watch
```

### Persistent Config Commands

The CLI does not use one fixed config path: `init`, `config set`, `config reset`
and `config show` all resolve `mafia.config.json` **against the directory the CLI
process runs in** (`process.cwd()`). Because `pnpm --filter` runs a package's
script with the package directory as its working directory, the documented
`--filter` commands read and write a file inside the package:

| Invocation | Working directory | Config file |
| --- | --- | --- |
| `pnpm --filter @mafia/cli dev -- init --default` | `apps/cli/` | `apps/cli/mafia.config.json` |
| `pnpm --filter @mafia/cli run config show` | `apps/cli/` | `apps/cli/mafia.config.json` |
| `pnpm --filter @mafia/cli run config set <key> <value>` | `apps/cli/` | `apps/cli/mafia.config.json` |
| `node apps/cli/dist/index.js config show` (run from the repo root) | repo root | `mafia.config.json` |

So under every `pnpm --filter @mafia/cli ...` form the file lives at
`apps/cli/mafia.config.json`, and **`config show` reads that same
`apps/cli/mafia.config.json`** — a `mafia.config.json` at the repo root is
invisible to it. The root-level file is only read by a direct invocation whose
working directory is the repo root. The `-c, --config <path>` flag listed under
[Run-Game Flags](#run-game-flags) belongs to `run-game` (its relative paths are
also resolved against the working directory); the `config` subcommands do not
read it.

Those paths are gitignored (the `mafia.config.json` pattern matches at any
depth); `init` (or `config set`) creates the file on first use.
Initialize it non-interactively before using the config commands:

```bash
# Create the nested default configuration without prompts
pnpm --filter @mafia/cli dev -- init --default

# Show the normalized configuration
pnpm --filter @mafia/cli run config show

# Set a displayed scalar value, then prove it round-trips
pnpm --filter @mafia/cli run config set numPlayers 8
pnpm --filter @mafia/cli run config show
# Players:           8

# Reset to default settings (asks for confirmation; --force skips the prompt)
pnpm --filter @mafia/cli run config reset
```

`config set` accepts only displayed scalar keys: `name`, `numPlayers`,
`nightDuration`, `dayDuration`, `votingDuration`, `llmProvider`, `llmModel`,
`temperature`, `enable3D`, and `enableVoice`. It rejects other keys with the
valid-key list instead of silently writing a value that `config show` cannot
report. For configurations created by `init`, those keys update the matching
nested `game`, `llm`, or `visualization` field.

Role configuration is read from the `roles` array in the game config, where
each entry has the form `{ "role": "MAFIA", "count": 3 }`. It is not a
`config set` scalar; edit the `game.roles` array directly when needed. Messaging
limits and day-rounds are not CLI configuration keys and have no config reader.

`config reset` overwrites `mafia.config.json` with the built-in defaults
(`numPlayers: 10`, `llmProvider: openai`, `llmModel: openai/gpt-4o-mini`,
night/day/voting 60/120/30 s) — flat keys, unlike the nested `game` / `llm` /
`visualization` sections `init --default` writes; `config show` normalizes both
shapes. Because it destroys the current values it asks first:

```
⚠️  This will reset all configuration to defaults.

? Continue? (y/N)
```

The prompt defaults to **no**: answering `n` prints `Cancelled.` and leaves the
file untouched. Both answers exit `0`. `--force` skips the prompt and is the
only form that resets a file without a terminal:

```bash
pnpm --filter @mafia/cli run config reset --force
✓ Configuration reset to defaults
```

In a non-TTY shell (cron, CI, agents) without `--force` the prompt is printed,
stdin is already at EOF, and the prompt is aborted: **nothing is written and no
`Cancelled.` line is printed** — but the process exits **130** (inquirer aborts
on EOF), not `0`. Only a real reset and a declined (`n`) prompt exit `0`. So
check the `✓ Configuration reset to defaults` line (or the file) rather than the
exit code: a non-interactive run and a real reset are distinguishable only by
the output and the file, not by status.

> **Note:** `pnpm --filter @mafia/cli config ...` is intercepted by pnpm's built-in `config` command, which rejects the recursive filter (`[ERROR] Unknown option: 'recursive'`, exit 1), so config subcommands use the `run config ...` form (see the note under **Commands Guide** below).

See **[CONFIG_GUIDE.md](CONFIG_GUIDE.md)** for complete documentation of all configurable parameters.

## 🎯 Game Flow (Corrected)

### Night Phase

1. **😈 Mafia Team Chat** - Mafia discuss (multiple messages each) and reach consensus
2. **💉 Doctor Action** - Doctor protects someone (can't repeat twice)
3. **👮 Sheriff Investigation** - Sheriff learns exact role of target
4. **🔫 Vigilante Action** - Vigilante can shoot once (or pass)
5. **🌅 Night Resolution** - Deaths revealed, game continues

### Day Phase

1. **💬 Discussion** - All players discuss
2. **🗳️ Voting** - Players vote to lynch someone
3. **🏆 Win Check** - Mafia wins if ≥ town, Town wins if all mafia eliminated

See **[specs/correct-night-flow.md](specs/correct-night-flow.md)** for complete specification.

## 📁 Commands Guide

### CLI Commands (via `mafiactl`)

| Command | Purpose | When to Use |
| --- | --- | --- |
| `pnpm --filter @mafia/cli dev -- init --default` | **Initialize config** | Create a non-interactive default config |
| `pnpm --filter @mafia/cli game:run` | **Run a game** | Playing Mafia with AI agents |
| `pnpm --filter @mafia/cli dev -- benchmark` | **Show accumulated report** | View accumulated model evaluation |
| `pnpm --filter @mafia/cli stats` | **View stats** | Game and model statistics |
| `pnpm --filter @mafia/cli list-games` | **List games** | Browse recent games |
| `pnpm --filter @mafia/cli run config show` | **View config** | Check current settings |
| `pnpm --filter @mafia/cli run config set <key> <value>` | **Configure** | Customize game params |

> **Note:** `pnpm --filter @mafia/cli config ...` is intercepted by pnpm's built-in `config` command instead of the `config` script, and that command has no recursive mode: on pnpm 11.13.1 it prints `[ERROR] Unknown option: 'recursive'` / `For help, run: pnpm help config` and exits 1. (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` is a different call — `pnpm --filter <pkg> run <missing-script>` reports `None of the selected packages has a "<script>" script`.) So config subcommands use the `run config ...` form. `stats` and `list-games` work directly as scripts.

> **Note — non-interactive shells (cron / CI / agents):** pnpm 11 runs a
> dependency check before every script and aborts in non-TTY shells with
> `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` whenever it decides
> `node_modules` must be re-provisioned (stale or symlinked `node_modules` —
> the normal state in worktrees, fresh automation checkouts, and after config
> changes). This repo sets `confirmModulesPurge: false` in
> `pnpm-workspace.yaml`, so the documented invocations above work unattended.
> In checkouts without that setting (older clones, forks), prefix the command
> with `CI=true` (e.g. `CI=true pnpm --filter @mafia/cli dev -- benchmark`)
> or run the built CLI directly: `node apps/cli/dist/index.js <cmd>`.

### Server Commands

| Command | Purpose | When to Use |
| --- | --- | --- |
| `pnpm --filter @mafia/server dev` | **Start server** | Run REST API + WebSocket |
| `pnpm --filter @mafia/server test:run` | **Run tests** | Verify server tests (715) |

### Root Commands

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (4/4)
pnpm --filter @mafia/server test:run    # Server tests (715)
pnpm --filter @mafia/shared test:run    # Shared tests (420)
pnpm --filter @mafia/cli test:run       # CLI tests (136)
pnpm --filter @mafia/web test:run       # Web tests (104)
```

## 🎭 Roles

| Role          | Ability                           | Win Condition        |
| ------------- | --------------------------------- | -------------------- |
| **Mafia**     | Kill one player each night        | Survive until ≥ town |
| **Doctor**    | Protect one player each night     | Town victory         |
| **Sheriff**   | Investigate exact role each night | Town victory         |
| **Vigilante** | Shoot one player once             | Town victory         |
| **Villager**  | Vote and discuss                  | Town victory         |

## 🔧 Development

### Project Structure

```
mafia-ai-benchmark/
├── apps/
│   ├── server/                  ✅ HTTP/WebSocket server + game engine
│   ├── cli/                     ✅ TypeScript CLI (mafiactl)
│   └── web/                     ✅ React frontend
├── packages/shared/             ✅ Shared types, FSM, roles, personas
│   ├── src/
│   │   ├── fsm/                 ✅ Game state machine
│   │   ├── roles/               ✅ Role definitions
│   │   ├── events/              ✅ Event definitions
│   │   ├── providers/           ✅ AI provider configs
│   │   └── persona/             ✅ Persona generation
│   └── __tests__/               ✅ 420 tests
├── specs/                       ✅ Technical specifications
├── pnpm-workspace.yaml          ✅ Monorepo workspace config
├── turbo.json                   ✅ Build pipeline config
└── .env                         ✅ API keys (create from .env.sample)
```

### Running Tests

```bash
# All tests from root
pnpm --filter @mafia/server test:run   # Server (715 tests)
pnpm --filter @mafia/shared test:run   # Shared (420 tests)
pnpm --filter @mafia/cli test:run      # CLI (136 tests)
pnpm --filter @mafia/web test:run      # Web (104 tests)
```

**Live-server integration tests (`TEST_BASE_URL`).** A handful of server
suites (`health.test.ts`, `api-live-endpoints.test.ts`) run against a REAL
mafia server. They run ONLY when `TEST_BASE_URL` is set explicitly, e.g.:

```bash
TEST_BASE_URL=http://localhost:3004 pnpm --filter @mafia/server test:run
```

The server suite itself (`api.test.ts` and friends) is hermetic: it boots the
real games router on an ephemeral port over an in-memory SQLite database, so
`pnpm --filter @mafia/server test:run` with no `TEST_BASE_URL` never touches a
live server or writes to the benchmark database. CI starts its own disposable
server and pins `TEST_BASE_URL` to it (see `.github/workflows/ci.yml`).

> ⚠️ **Isolation warning**: never point tests at a compose stack whose data
> matters. Live integration tests can write games to the server they run
> against (a pinned `TEST_BASE_URL` arms real-game coverage that appends
> games to that stack's SQLite volume), which moves `GET /api/v1/stats` and
> the leaderboard. Use a scratch server, or make sure the stack's data is
> disposable, before setting `TEST_BASE_URL`.

**Test Coverage**: 1375 tests (420 shared, 715 server, 136 CLI, 104 web) —
**1355 passing, 20 skipped**. Both skip groups are opt-in live-integration
suites, so they run only when a server is pinned: server `health.test.ts` (2) +
`api-live-endpoints.test.ts` (17), and the CLI `benchmark.test.ts` real-game run
gated on `MAFIA_LIVE_BENCHMARK=1` (1).

**Test counts are generated from live vitest output — don't invent them.**
`pnpm test:counts` (`scripts/sync-test-counts.mjs`) rewrites every count on this
page — the feature bullet, both command blocks, the coverage sentence, the
summary block below and the status line — from the suites' own "Tests" summary
lines; run it after adding or removing tests. The generator publishes the
passed/skipped split it parses from those lines and fails loudly rather than
assuming a suite skipped nothing, so a stale "all passing" claim cannot come
back. `--dry-run` prints the rewrites without touching the file, and `--check`
exits 1 when any count on the page is stale. The four lines behind the numbers
above are:

```
shared  Tests  420 passed (420)
server  Tests  696 passed | 19 skipped (715)
cli     Tests  135 passed | 1 skipped (136)
web     Tests  104 passed (104)
```

so the passing figure is `420 + 696 + 135 + 104 = 1355` out of `420 + 715 + 136 + 104 = 1375` collected, with the remaining 20 skipped.

### Game Events

Each game action is stored as an event with visibility levels:

```json
{
  "gameId": "game-123",
  "round": 1,
  "phase": "NIGHT",
  "playerName": "James Tanaka",
  "personaArchetype": "Julius Caesar",
  "eventType": "MESSAGE",
  "visibility": "PRIVATE_MAFIA", // PUBLIC, PRIVATE_MAFIA, ADMIN_ONLY
  "content": {
    "think": "Private reasoning in character...",
    "says": "Public statement in character...",
    "personaTraits": ["Charismatic", "Strategic", "Ambitious"]
  }
}
```

## 🐛 Bug Fixes Applied

### ✅ Information Leakage Fixed

**Issue**: Doctor/Sheriff/Vigilante could see mafia's target in their prompts
**Fix**: Removed `mafiaKillTarget` from their `previousPhaseData`

### ✅ Variable Scope Fixed

**Issue**: `mafiaKillTarget` not accessible across phases
**Fix**: Declared at class level: `this.mafiaKillTarget = null`

### ✅ Configuration System Added

**Feature**: Comprehensive CLI configuration with 15+ options

- Player/role settings
- Messaging limits
- AI model selection
- Persistent config file
- Interactive menu

### ✅ Persona System Added

**Feature**: Rich, dynamic characters with:

- 6 archetype categories
- 8 communication styles
- Diverse naming conventions
- Personal backstories and flaws

## 🚀 Coming Soon

- **Pre-made Scenarios** - Test specific game states
- **Persona Memory** - Characters remember past events

## 📝 Notes

- **Use `pnpm --filter @mafia/cli game:run`** to run games
- Games persist between sessions in the server database
- AI models use GPT-4o-mini via OpenRouter (configurable via `--model`)
- Role assignments are random each game
- Personas are unique each game, generated by the LLM from personality descriptions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request

## 📄 License

MIT License - see LICENSE file

---

**Status**: ✅ Production Ready | ✅ Fully Documented | ✅ 1355 of 1375 Tests passing (20 skipped; 420 shared, 715 server, 136 CLI, 104 web)

**Quick Start**: See [QUICK_START.md](QUICK_START.md) for 5-minute setup guide!

Built with ❤️ for AI research and game theory exploration
