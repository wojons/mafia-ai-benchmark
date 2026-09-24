# CLI Interface Specifications

## Overview
The CLI (`mafiactl`) provides command-line control for running and watching Mafia AI games, listing games and statistics, managing local configuration, and running model benchmarks. It is implemented with Commander in `apps/cli/src/index.ts` (entry point; built to `apps/cli/dist/index.js`).

The real command set (verified against `apps/cli/dist/index.js --help` after `pnpm --filter @mafia/cli build`):

| Command | Purpose |
|---|---|
| `init` | Initialize `mafia.config.json` |
| `run-game` | Run a Mafia game with AI agents |
| `watch-game` | Watch a game in real-time (WebSocket) |
| `list-games` | List recent and active games |
| `config` | View and modify local configuration |
| `stats` | Display game and model statistics |
| `benchmark` | Show the accumulated benchmark report, or run a fresh benchmark |

## Installation
```bash
# From the repository root
pnpm install
pnpm --filter @mafia/cli build

# Run directly
node apps/cli/dist/index.js --help

# Or expose as `mafiactl`
pnpm link
mafiactl --help
```

## Global Options
```
mafiactl [global-options] <command> [command-options]

Global Options:
  -V, --version        Output the version number
  --verbose            Enable verbose logging
  --config <path>      Config file path (default: ./mafia.config.json)
  -h, --help           Display help for command
```

Running `mafiactl` with no arguments prints help. An unknown command exits with code 1 and an error message.

## Commands

### `mafiactl init`
Initialize Mafia AI Benchmark configuration (`./mafia.config.json` in the current directory).

**Usage:**
```bash
mafiactl init [options]
```

**Options:**
```
  -f, --force   Overwrite existing configuration (default: false)
  -q, --quiet   Skip interactive prompts (default: false)
  --default     Use default configuration (default: false)
```

Notes: with an existing config and no `--force`, the command asks interactively whether to overwrite. Either `--default` or `-q/--quiet` skips prompts and writes the default configuration.

**Examples:**
```bash
# Interactive setup (prompts for name, players, roles, durations, provider/model)
mafiactl init

# Non-interactive, defaults, overwriting any existing file
mafiactl init --default --force
```

---

### `mafiactl run-game`
Run a Mafia game with AI agents. Loads `mafia.config.json` if present (accepting both the flat and the nested `init`-generated shape), then POSTs the game to the server.

**Usage:**
```bash
mafiactl run-game [options]
```

**Options:**
```
  -c, --config <path>  Configuration file path (default: ./mafia.config.json)
  --players <n>        Number of players (default: 10)
  --provider <name>    LLM provider (default: openai)
  --model <name>       LLM model (default: openai/gpt-4o-mini)
  --auto               Run without confirmation (default: false)
  --yes                Skip confirmation prompt (alias for --auto)
  --watch              Watch game in real-time (default: false)
  --server <url>       Server base URL (default: http://localhost:3004)
```

**Examples:**
```bash
# Run a game (asks for confirmation)
mafiactl run-game

# Non-interactive with overrides
mafiactl run-game --yes --players 12 --provider openai --model openai/gpt-4o

# Watch while running
mafiactl run-game --yes --watch
```

On success it prints the game ID and the suggested follow-up (`mafiactl watch-game <game-id>`). Exit code 1 if the server cannot be reached or the game fails to start.

---

### `mafiactl watch-game`
Watch a game in real-time via WebSocket.

**Usage:**
```bash
mafiactl watch-game <game-id> [options]
```

**Options:**
```
  -s, --server <url>  Server URL (default: ws://localhost:3004/ws)
  --no-color          Disable colors
```

The command connects to the server's WebSocket endpoint, sends a `JOIN_GAME` message for the given game ID, and renders live messages (game state, phase changes, agent statements, votes, kills, lynchings, winner determination). Disconnects when the server closes the connection or on Ctrl+C (exit 0). Exit code 1 if the connection fails.

**Examples:**
```bash
# Watch a game
mafiactl watch-game game-abc123

# Against a remote server
mafiactl watch-game game-abc123 -s ws://myhost:3004/ws
```

---

### `mafiactl list-games`
List recent and active games.

**Usage:**
```bash
mafiactl list-games [options]
```

**Options:**
```
  --status <status>  Filter by status (setup, in_progress, ended)
  --limit <n>        Maximum games to show (default: 10)
  --json             Output as JSON
  --server <url>     Server base URL (default: http://localhost:3004)
```

The `--status` filter value is uppercased before being sent to the API (`?status=<STATUS>&limit=<n>`).

**Examples:**
```bash
# Recent games (formatted table)
mafiactl list-games

# Filter and limit
mafiactl list-games --status in_progress --limit 20

# JSON for scripting
mafiactl list-games --json
```

---

### `mafiactl config`
View and modify the local `mafia.config.json`.

**Usage:**
```bash
mafiactl config [command]
```

**Subcommands:**

| Subcommand | Options | Behavior |
|---|---|---|
| `show` | `--json` | Print current configuration (JSON or formatted) |
| `set <key> <value>` | — | Set a top-level key; `true`/`false` are parsed as booleans and numeric strings as numbers |
| `reset` | `--force` | Reset the file to defaults; asks for confirmation unless `--force` |

The default config written by `reset`:
```json
{
  "numPlayers": 10,
  "llmProvider": "openai",
  "llmModel": "openai/gpt-4o-mini",
  "nightDuration": 60,
  "dayDuration": 120,
  "votingDuration": 30
}
```

**Examples:**
```bash
mafiactl config show
mafiactl config show --json
mafiactl config set numPlayers 12
mafiactl config set enable3D true
mafiactl config reset --force
```

---

### `mafiactl stats`
Display game and model statistics fetched from the server.

**Usage:**
```bash
mafiactl stats [options]
```

**Options:**
```
  --json          Output as JSON
  --games         Show game statistics
  --models        Show model comparison
  --verbose       Show detailed statistics (cost summary, API calls, latency, error rate)
  --server <url>  Server base URL (default: http://localhost:3004)
```

The formatted output always includes game statistics and the top-5 model performance table; `--verbose` adds the cost/performance sections. Model data is fetched best-effort from `/api/v1/stats/models` and may be absent.

**Examples:**
```bash
mafiactl stats
mafiactl stats --models --verbose
mafiactl stats --json
```

---

### `mafiactl benchmark`
Show the accumulated benchmark report from the server, or run a fresh benchmark.

**Usage:**
```bash
mafiactl benchmark [options]
```

**Options:**
```
  --quick              Show the accumulated benchmark report (default behavior)
  --export <path>      Export results to file (JSON)
  --json               Output results as JSON
  --server <url>       Server base URL (default: http://localhost:3004)
  --timeout <minutes>  Max minutes to wait for a fresh run (default: 30; 0 = wait indefinitely)
  -g, --games <n>      Run N fresh benchmark games
  --models <models>    Comma-separated models to benchmark (default:
                       openai/gpt-4o-mini,openai/gpt-4o)
  --parallel           Accepted for backward compatibility; ignored
```

Behavior:
- **Report mode** (no `--games`/`--models`): fetches and displays `GET /api/v1/benchmark/report` (summary, per-model results, recommendations).
- **Fresh-run mode** (`--games` and/or `--models` given): `POST /api/v1/benchmark`, polls the run status every 2 s until a terminal status (COMPLETED/CANCELLED/FAILED), then fetches and displays the accumulated report. At least 2 models are required (benchmarks are pairwise). If the run does not finish within the wait window, the command exits 1 and suggests re-checking `mafiactl benchmark --json` later or a larger `--timeout`.
- **Export**: `--export <path>` writes the fetched report as pretty-printed JSON to the given path (after display, in either mode).

**Examples:**
```bash
# Show the accumulated report
mafiactl benchmark
mafiactl benchmark --quick

# Run a fresh 2-game benchmark with specific models
mafiactl benchmark --games 2 --models openai/gpt-4o-mini,openai/gpt-4o

# Run and export the report as JSON
mafiactl benchmark --games 2 --export benchmark-report.json

# Wait up to 60 minutes for the run
mafiactl benchmark --games 2 --timeout 60
```

**Caveat:** `benchmark export` is listed as a subcommand in `--help` but currently does nothing (it is registered without an action handler and exits 0 with no output). Use `benchmark --export <path>` instead.

---

## Ports

Direct runs default to `--server http://localhost:3004` (HTTP commands) and `ws://localhost:3004/ws` (`watch-game`). The compose stack exposes the game server API on host port 3004 with the WebSocket at the `/ws` path on the same port — there is no separate WebSocket port. See `apps/cli/src/config.ts` (`DEFAULT_SERVER_URL`, `DEFAULT_WS_URL`).

## Configuration

### Config File
The CLI reads `./mafia.config.json` from the current working directory (overridable per-command with `-c/--config` on `run-game`, or the global `--config <path>`). Created by `mafiactl init`.

`init` writes a nested shape (`game.numPlayers`, `game.roles`, `game.nightPhaseDuration`, ..., `llm.provider`, `llm.model`, ...); `config` and `run-game` also accept the flat shape (`numPlayers`, `llmProvider`, `llmModel`, `nightDuration`, `dayDuration`, `votingDuration`). `run-game` normalizes both and falls back to defaults for missing keys.

Example (`init --default`):
```json
{
  "name": "Mafia Game",
  "version": "1.0.0",
  "game": {
    "numPlayers": 10,
    "roles": [
      { "role": "MAFIA", "count": 3 },
      { "role": "DOCTOR", "count": 1 },
      { "role": "SHERIFF", "count": 1 },
      { "role": "VIGILANTE", "count": 1 },
      { "role": "VILLAGER", "count": 4 }
    ],
    "nightPhaseDuration": 60,
    "dayPhaseDuration": 120,
    "votingDuration": 30,
    "tieBreaker": "RANDOM",
    "allowSelfVote": false
  },
  "llm": {
    "provider": "openai",
    "model": "openai/gpt-4o-mini",
    "temperature": 0.7,
    "maxTokens": 2000
  },
  "visualization": { "enable3D": false, "enableVoice": false },
  "logging": { "level": "INFO", "file": "./logs/mafia.log" }
}
```

### Environment Variables
- `MAFIA_SERVER_URL`: server base URL used by all server-facing commands when `--server` is not given. For `watch-game`, the value is converted to a WebSocket URL (`http(s)://host` → `ws(s)://host/ws`; `ws://`/`wss://` pass through). Precedence for every command: explicit `--server` flag > `MAFIA_SERVER_URL` > built-in default.

## Exit Codes

The CLI uses simple exit codes; per-command exit-code tables beyond these are not guaranteed:
- `0` — success (including clean disconnect / Ctrl+C on `watch-game`)
- `1` — general error: fatal error, command failure (server unreachable, game failed to start), or unknown command