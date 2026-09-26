#!/bin/bash
# Mafia AI Benchmark — repo wrapper for the pnpm monorepo (mafiactl + server).
#
# All paths are resolved relative to this script (works from any cwd, works
# on a fresh clone). Nothing is written outside the repo.
#
# Usage:
#   ./mafia.sh server                  - Start the game server (API :3004)
#   ./mafia.sh new [players]           - Start a game (default 10 players)
#   ./mafia.sh watch [gameId]          - Watch a game live (most recent if omitted)
#   ./mafia.sh list                    - List games
#   ./mafia.sh continue                - Hint: how to resume/watch a game
#   ./mafia.sh delete [gameId]         - Not supported by the server (no delete API)
#   ./mafia.sh config --show           - Show current CLI configuration
#   ./mafia.sh config --reset          - Reset configuration to defaults (repo-local)
#   ./mafia.sh config --set k v        - Set a configuration value
#   ./mafia.sh config --model m        - Set default LLM model (shorthand)
#   ./mafia.sh config --players n      - Set default player count (shorthand)
#   ./mafia.sh config --menu           - Full interactive setup (mafiactl init)
#   ./mafia.sh models                  - Show the configured model setup
#   ./mafia.sh stats                   - Game/model statistics
#   ./mafia.sh benchmark [--games N]   - Benchmark report / fresh benchmark run
#   ./mafia.sh help                    - Show this help
#
# Server URL: export MAFIA_SERVER_URL=http://host:port to target a non-default
# server (default http://localhost:3004 — same default as mafiactl).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/mafia.config.json"
TSX_BIN="$SCRIPT_DIR/apps/cli/node_modules/.bin/tsx"
CLI_ENTRY="apps/cli/src/index.ts"
DEFAULT_SERVER_URL="http://localhost:3004"
SERVER_URL="${MAFIA_SERVER_URL:-$DEFAULT_SERVER_URL}"

# Run a mafiactl command from the repo root. tsx is invoked directly (not via
# `pnpm --filter exec`, which cd's into apps/cli and would scatter config
# files into the package dir instead of the repo root). Config files resolve
# from cwd, so every write lands inside the repo.
mafiatl() {
    if [ ! -x "$TSX_BIN" ]; then
        echo "📦 Dependencies not installed. Run: pnpm install && pnpm build"
        exit 1
    fi
    (cd "$SCRIPT_DIR" && MAFIA_SERVER_URL="$SERVER_URL" "$TSX_BIN" "$CLI_ENTRY" "$@")
}

# Verify the game server is reachable before commands that need it.
check_server() {
    if command -v curl >/dev/null 2>&1; then
        if ! curl -sf --max-time 3 "$SERVER_URL/health" >/dev/null 2>&1; then
            echo "❌ Server not reachable at $SERVER_URL"
            echo "   Start it first: ./mafia.sh server   (or: pnpm run server)"
            exit 1
        fi
    fi
}

case "$1" in
    server|start)
        if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
            echo "📦 Dependencies not installed. Run: pnpm install && pnpm build"
            exit 1
        fi
        echo "🎮 Starting Mafia AI Benchmark server on $SERVER_URL ..."
        echo "   (Ctrl+C to stop; API docs: curl $SERVER_URL/api/v1)"
        (cd "$SCRIPT_DIR" && pnpm run server)
        ;;

    new)
        if [ -n "$2" ]; then
            mafiatl run-game --players "$2" --auto
        else
            mafiatl run-game --auto
        fi
        ;;

    demo)
        echo "🎮 One-off demo game (not interactive):"
        mafiatl run-game --players 5 --auto
        ;;

    watch)
        if [ -n "$2" ]; then
            mafiatl watch-game "$2"
        else
            LAST_GAME=$(mafiatl list-games --json --limit 1 2>/dev/null | grep -oE '"id":[[:space:]]*"[0-9a-f-]{36}"' | head -1 | grep -oE '[0-9a-f-]{36}')
            if [ -z "$LAST_GAME" ]; then
                echo "❌ No games found. Create one first with: ./mafia.sh new"
            else
                echo "👀 Watching most recent game: $LAST_GAME"
                mafiatl watch-game "$LAST_GAME"
            fi
        fi
        ;;

    list|games)
        check_server
        mafiatl list-games
        ;;

    continue)
        echo "ℹ️  Games run to completion on the server; re-open one with:"
        echo "   ./mafia.sh list              # find the game id"
        echo "   ./mafia.sh watch <gameId>    # follow it live (WebSocket)"
        echo "   Replay data: GET $SERVER_URL/api/v1/games/<gameId>/replay"
        ;;

    delete)
        echo "❌ Not supported: the server API has no game-delete endpoint"
        echo "   (rows are preserved for stats/benchmarks by design)."
        echo "   See: ./mafia.sh list"
        ;;

    config)
        shift
        if [ -z "$1" ]; then
            mafiatl config show
            exit 0
        fi
        case "$1" in
            --show|-s)
                mafiatl config show
                ;;
            --reset|-r)
                # Writes $CONFIG_FILE (repo-local), never anywhere else.
                mafiatl config reset --force
                ;;
            --set)
                if [ -z "$2" ] || [ -z "$3" ]; then
                    echo "❌ Usage: ./mafia.sh config --set <key> <value>"
                    exit 1
                fi
                mafiatl config set "$2" "$3"
                ;;
            --model|-m)
                if [ -z "$2" ]; then
                    echo "❌ Usage: ./mafia.sh config --model <provider/model>"
                    exit 1
                fi
                mafiatl config set llmModel "$2"
                ;;
            --players|-p)
                if [ -z "$2" ]; then
                    echo "❌ Usage: ./mafia.sh config --players <n>"
                    exit 1
                fi
                mafiatl config set numPlayers "$2"
                ;;
            --menu)
                echo "ℹ️  The interactive menu is mafiactl init:"
                mafiatl init --force
                ;;
            *)
                echo "❌ Unknown config option: $1"
                echo "   Use: --show | --reset | --set <k> <v> | --model <m> | --players <n> | --menu"
                exit 1
                ;;
        esac
        ;;

    models)
        echo "🤖 Model configuration:"
        echo ""
        echo "   Default model (mafia.config.json):"
        mafiatl config show 2>/dev/null | grep -E "Model|Provider" || echo "   (no config yet — run: ./mafia.sh config --reset)"
        echo ""
        echo "   Per-role overrides (.env — leave empty to use DEFAULT_MODEL):"
        echo "     DEFAULT_MODEL / MAFIA_MODEL / DOCTOR_MODEL / SHERIFF_MODEL /"
        echo "     VIGILANTE_MODEL / VILLAGER_MODEL"
        echo ""
        echo "   See CONFIG_GUIDE.md for the full model-assignment guide."
        ;;

    stats)
        check_server
        mafiatl stats
        ;;

    benchmark)
        check_server
        shift
        mafiatl benchmark "$@"
        ;;

    help|--help|-h|*)
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║        🎮 MAFIA AI BENCHMARK — MONOREPO WRAPPER             ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        echo "🎮 PLAYING:"
        echo "   ./mafia.sh server            Start the game server (:3004)"
        echo "   ./mafia.sh new [n]           Start a game (default 10 players)"
        echo "   ./mafia.sh watch [gameId]    Watch a game live"
        echo "   ./mafia.sh list              List games"
        echo ""
        echo "🎛️  CONFIGURATION:"
        echo "   ./mafia.sh config --show     View current settings"
        echo "   ./mafia.sh config --reset    Reset to defaults (writes ./mafia.config.json)"
        echo "   ./mafia.sh config --set k v  Set a value (e.g. numPlayers 8)"
        echo "   ./mafia.sh config --model m  Set default LLM model"
        echo "   ./mafia.sh models            Show model configuration"
        echo ""
        echo "📊 BENCHMARKS:"
        echo "   ./mafia.sh benchmark --quick        Show accumulated report"
        echo "   ./mafia.sh benchmark --games 2      Run fresh benchmark games"
        echo "   ./mafia.sh stats                    Game/model statistics"
        echo ""
        echo "🔗 SERVER: export MAFIA_SERVER_URL=http://host:port (default http://localhost:3004)"
        echo "📖 DOCS: QUICK_START.md (setup) · CONFIG_GUIDE.md (configuration)"
        echo "   GAME_MANAGEMENT.md (game lifecycle) · QUICK_REFERENCE.md (cheat sheet)"
        echo ""
        ;;
esac