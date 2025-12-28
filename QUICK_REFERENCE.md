╔══════════════════════════════════════════════════════════════════════╗
║                   🎮 MAFIA AI BENCHMARK - QUICK REFERENCE            ║
╚══════════════════════════════════════════════════════════════════════╝

┌─ PLAYING GAMES ──────────────────────────────────────────────────────┐
│                                                                        │
│  ONE-OFF GAMES (Quick, not saved)                                     │
│  ─────────────────────────────────                                    │
│  node demo-game-correct-flow-v2.js        # 10 players (default)     │
│  node demo-game-correct-flow-v2.js        # Runs to completion       │
│                                                                        │
│  MANAGED GAMES (Saved, resumable)                                     │
│  ─────────────────────────────────                                    │
│  ./mafia.sh new 10                    # Create 10-player game        │
│  ./mafia.sh new 8                     # Create 8-player game         │
│  ./mafia.sh new 6                     # Create 6-player game         │
│                                                                        │
│  ./mafia.sh list                       # List all saved games        │
│  ./mafia.sh continue                   # Continue most recent game   │
│  ./mafia.sh continue [gameId]          # Continue specific game      │
│  ./mafia.sh delete [gameId]            # Delete a game               │
│                                                                        │
│  ./mafia.sh demo                       # Run one-off demo            │
│  ./mafia.sh help                       # Show all commands           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ GAME PHASES ─────────────────────────────────────────────────────────┐
│                                                                        │
│  🌙 NIGHT PHASE                                                        │
│  ├── 😈 Mafia Team Chat (multiple messages per mafia member)          │
│  ├── 🎯 Mafia Consensus/Vote on kill target                           │
│  ├── 💉 Doctor Action (can't protect same person twice)               │
│  ├── 👮 Sheriff Investigation (gets exact role)                       │
│  ├── 🔫 Vigilante Action (one-time shot)                              │
│  └── 🌅 Night Resolution                                               │
│                                                                        │
│  ☀️ DAY PHASE                                                          │
│  ├── 💬 Discussion (multiple messages per player)                     │
│  ├── 🗳️ Voting                                                        │
│  └── 🏆 Win Condition Check                                            │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ QUICK EXAMPLES ──────────────────────────────────────────────────────┐
│                                                                        │
│  Example 1: Quick Demo                                                 │
│  ─────────────────                                                     │
│  $ node demo-game-correct-flow-v2.js                                   │
│  # Watch AI agents play a complete game                               │
│                                                                        │
│  Example 2: Compare Two Games                                          │
│  ──────────────────────────                                            │
│  $ node demo-game-correct-flow-v2.js > game1.txt                       │
│  $ node demo-game-correct-flow-v2.js > game2.txt                       │
│  $ diff game1.txt game2.txt                                            │
│                                                                        │
│  Example 3: Create Tournament                                          │
│  ─────────────────────────                                             │
│  $ ./mafia.sh new 10              # Game 1                            │
│  $ ./mafia.sh new 10              # Game 2                            │
│  $ ./mafia.sh new 10              # Game 3                            │
│  $ ./mafia.sh list                # See all games                     │
│                                                                        │
│  Example 4: Test Different AI Models                                   │
│  ─────────────────────────────────                                     │
│  # Edit demo-game-correct-flow-v2.js line 73:                         │
│  # Change: "openai/gpt-4o-mini" to "anthropic/claude-3"               │
│  $ node demo-game-correct-flow-v2.js > ai_test1.txt                    │
│  # Change to different model...                                       │
│  $ node demo-game-correct-flow-v2.js > ai_test2.txt                    │
│  $ diff ai_test1.txt ai_test2.txt                                      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ WHAT YOU'LL SEE ─────────────────────────────────────────────────────┐
│                                                                        │
│  🔒 ADMIN PANEL (Secret role assignments):                            │
│    👱 Alice: VILLAGER                                                  │
│    💉 Bob: DOCTOR                                                      │
│    😈 Charlie: MAFIA [MAFIA TEAM]                                      │
│                                                                        │
│  🌙 NIGHT PHASE:                                                       │
│    [Mafia Chat 1/6] Charlie:                                           │
│      🔒 THINK: [Private reasoning]                                     │
│      📢 SAYS:  "I think we should target..."                           │
│                                                                        │
│    🎯 MAFIA CONSENSUS: Kill Alice                                      │
│                                                                        │
│    💉 Bob (DOCTOR): Protects Alice                                     │
│    👮 Diana (SHERIFF): Investigates Charlie                            │
│    🔫 Eve (VIGILANTE): PASSES                                          │
│                                                                        │
│    🌅 NIGHT RESOLUTION:                                                │
│      🛡️ PROTECTED: Alice saved by doctor!                             │
│                                                                        │
│  ☀️ DAY PHASE:                                                         │
│    [Discussion 1/10] Alice:                                            │
│      🔒 THINK: [Private reasoning]                                     │
│      📢 SAYS:  "I think Charlie is suspicious..."                      │
│                                                                        │
│    🗳️ VOTING:                                                          │
│      Alice → Charlie                                                   │
│      Bob → Charlie                                                     │
│      Charlie → Alice                                                   │
│                                                                        │
│    🚨 Charlie (MAFIA) LYNCHED!                                         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ KEY FILES ───────────────────────────────────────────────────────────┐
│                                                                        │
│  demo-game-correct-flow-v2.js   # Main game engine                    │
│  game-manager.js                 # Save/load system                   │
│  mafia.sh                        # Easy CLI wrapper                   │
│  saved-games/                    # Directory for saved games          │
│  specs/correct-night-flow.md     # Complete game rules                │
│  GAME_MANAGEMENT.md              # Detailed management guide          │
│  IMPLEMENTATION_STATUS.md        # Current status & features          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ TROUBLESHOOTING ─────────────────────────────────────────────────────┐
│                                                                        │
│  ❌ "No saved games found"                                             │
│     → Run: ./mafia.sh new                                             │
│                                                                        │
│  ❌ "Game not found: [id]"                                             │
│     → Run: ./mafia.sh list to see valid IDs                           │
│                                                                        │
│  ❌ "ReferenceError: mafiaKillTarget is not defined"                   │
│     → Fixed! (Scope issue resolved)                                    │
│                                                                        │
│  💡 Want to change AI model?                                           │
│     → Edit demo-game-correct-flow-v2.js line 73                       │
│                                                                        │
│  💡 Want to save game for later?                                       │
│     → Use: ./mafia.sh new                                             │
│                                                                        │
│  💡 Want to run multiple games?                                        │
│     → Run script multiple times or use game-manager.js                │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

🎉 Everything is working! Run any command above to play!

╔══════════════════════════════════════════════════════════════════════╗
║  Status: ✅ Bug Fixed    ✅ Tests Passing    ✅ Games Running          ║
╚══════════════════════════════════════════════════════════════════════╝
