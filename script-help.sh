#!/bin/bash
# Mafia AI Benchmark - Script Cleanup & Organization Helper
#
# This script helps organize the demo scripts and explains which to use

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       MAFIA AI BENCHMARK - SCRIPT MANAGEMENT                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "📋 CURRENT SCRIPTS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ls -1 demo-game*.js 2>/dev/null | while read file; do
    if [[ "$file" == "demo-game-correct-flow-v2.js" ]]; then
        echo "  ✅ $file          ← MAIN SCRIPT - USE THIS!"
    elif [[ "$file" == "demo-game-correct-flow.js" ]]; then
        echo "  ⚠️  $file      Old version (use v2)"
    else
        echo "  ❌ $file         Legacy/duplicate"
    fi
done
echo ""

echo "📖 RECOMMENDED USAGE:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  🎮 RUN A GAME:"
echo "     node demo-game-correct-flow-v2.js"
echo ""
echo "  💾 SAVE/RESUME GAMES:"
echo "     ./mafia.sh new"
echo "     ./mafia.sh list"
echo "     ./mafia.sh continue [gameId]"
echo ""
echo "  📚 DOCUMENTATION:"
echo "     cat README.md"
echo "     cat QUICK_REFERENCE.md"
echo "     cat ARCHITECTURE.md"
echo ""

echo "🧹 CLEANUP OPTIONS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Remove old/legacy scripts:"
echo "    rm demo-game.js demo-game-correct-flow.js"
echo ""
echo "  Keep only main script:"
echo "    rm demo-game.js demo-game-correct-flow.js && ls demo-game*.js"
echo ""

echo "✅ ACTIVE DEVELOPMENT:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Main script:      demo-game-correct-flow-v2.js"
echo "  Game manager:     game-manager.js"
echo "  CLI wrapper:      mafia.sh"
echo "  Game storage:     saved-games/"
echo ""

echo "🔧 FOR DEVELOPERS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Tests:            cd packages/shared && npm test"
echo "  Add tests:        packages/shared/src/__tests__/"
echo "  Game specs:       specs/"
echo ""

# Optional: Ask to remove old scripts
if [[ "$1" == "--clean" ]]; then
    echo "🧹 Cleaning up old scripts..."
    rm -f demo-game.js demo-game-correct-flow.js
    echo "✅ Removed: demo-game.js, demo-game-correct-flow.js"
    echo ""
    echo "Remaining demo scripts:"
    ls -1 demo-game*.js
fi
