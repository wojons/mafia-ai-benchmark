╔════════════════════════════════════════════════════════════════════╗
║         🎮 MAFIA AI BENCHMARK — QUICK REFERENCE                    ║
╚════════════════════════════════════════════════════════════════════╝

This is a **pnpm monorepo** (apps/server, apps/cli, apps/web,
packages/shared). Every command below exists in the repo today — nothing
here references legacy one-off scripts.

┌─ FIRST-TIME SETUP ───────────────────────────────────────────────────┐
│                                                                        │
│  pnpm install                       # install all workspaces           │
│  pnpm build                         # build (server imports shared     │
│                                     # from its built dist/ output)     │
│  echo 'OPENAI_API_KEY=sk-or-...' >> .env                            │
│                                     # OpenRouter key (or any OpenAI-   │
│                                     # compatible endpoint) —           │
│                                     # see .env.sample for the template │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ PLAYING GAMES ──────────────────────────────────────────────────────┐
│                                                                        │
│  START THE SERVER (required for games, stats, benchmarks)             │
│  ─────────────────────────────────────────────────────────             │
│  pnpm run server                       # API on :3004, WS /ws          │
│  ./mafia.sh server                     # same thing via the wrapper    │
│  curl localhost:3004/health            # verify it is up               │
│                                                                        │
│  RUN A GAME (server must be running)                                   │
│  ─────────────────────────────────────────────────────                 │
│  pnpm --filter @mafia/cli dev -- run-game --players 10                  │
│  ./mafia.sh new 10                     # same thing via the wrapper    │
│  ./mafia.sh new 8                      # 8-player game                 │
│  ./mafia.sh demo                       # one-off 5-player game         │
│                                                                        │
│  WATCH / INSPECT GAMES                                                 │
│  ─────────────────────                                                 │
│  pnpm --filter @mafia/cli dev -- list-games                             │
│  ./mafia.sh list                       # same thing via the wrapper    │
│  ./mafia.sh watch <gameId>             # follow a game live (WS)       │
│  ./mafia.sh continue                   # how to resume/reopen a game   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ GAME PHASES ─────────────────────────────────────────────────────────┐
│                                                                        │
│  🌙 NIGHT PHASE                                                        │
│  ├── 😈 Mafia Team Chat (multiple messages per mafia member)          │
│  ├── 🎯 Mafia Consensus/Vote on kill target                           │
│  ├── 💉 Doctor Action (can't protect same person twice)               │
│  ├── 👮 Sheriff Investigation (gets exact role)                       │
│  ├── 🔫 Vigilante Action (one-time shot, 6+ players)                  │
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
│  Example 1: Quick Demo (server running)                                │
│  ───────────────────────────────                                       │
│  $ ./mafia.sh demo                                                     │
│  # Watch AI agents play a complete 5-player game                       │
│                                                                        │
│  Example 2: Compare Two Games (same settings, seed differs)            │
│  ──────────────────────────────────────────────                        │
│  $ ./mafia.sh new 10 > /tmp/game1.txt                                  │
│  $ ./mafia.sh new 10 > /tmp/game2.txt                                  │
│  $ diff /tmp/game1.txt /tmp/game2.txt                                  │
│                                                                        │
│  Example 3: Create Tournament                                          │
│  ────────────────────────────                                          │
│  $ ./mafia.sh new 10              # Game 1                            │
│  $ ./mafia.sh new 10              # Game 2                            │
│  $ ./mafia.sh new 10              # Game 3                            │
│  $ ./mafia.sh list                # See all games                     │
│                                                                        │
│  Example 4: Test Different AI Models (per-role override via .env)      │
│  ───────────────────────────────────────────────────────────           │
│  $ echo 'MAFIA_MODEL=anthropic/claude-3-haiku' >> .env                 │
│  $ ./mafia.sh new 10 > /tmp/ai_test1.txt                               │
│  $ echo 'MAFIA_MODEL=openai/gpt-4o-mini' >> .env                       │
│  $ ./mafia.sh new 10 > /tmp/ai_test2.txt                               │
│  $ diff /tmp/ai_test1.txt /tmp/ai_test2.txt                            │
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
│  apps/server/                    # Express + WebSocket game server     │
│  apps/cli/                       # mafiactl CLI (run/list/config)      │
│  apps/web/                       # React dashboard (pnpm run web)      │
│  packages/shared/                # Shared types, FSM, providers        │
│  game-engine.js                  # Legacy 5,303-line engine (root,     │
│                                  # driven by the server adapter)       │
│  mafia.sh                        # Repo wrapper over mafiactl          │
│  mafia.config.json               # CLI/game config (created by         │
│                                  # mafiactl init / config --reset)     │
│  .env                            # API keys + per-role model overrides │
│  docker-compose.yml              # Server (API :3004) + Web (:5174)    │
│  specs/correct-night-flow.md     # Complete game rules                 │
│  GAME_MANAGEMENT.md              # Detailed management guide           │
│  CONFIG_GUIDE.md                 # Configuration guide                 │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─ TROUBLESHOOTING ─────────────────────────────────────────────────────┐
│                                                                        │
│  ❌ "Cannot connect to server at http://localhost:3004"                │
│     → Start it: pnpm run server (or ./mafia.sh server)                 │
│                                                                        │
│  ❌ "Game not found: [id]"                                             │
│     → Run: ./mafia.sh list to see valid IDs                           │
│                                                                        │
│  ❌ Every player repeats canned phrases                                │
│     → Your API key is missing/invalid: check .env (OPENAI_API_KEY);    │
│       games that fell back to mocks are flagged 'mock' and excluded    │
│       from win stats.                                                  │
│                                                                        │
│  ❌ ./mafia.sh: pnpm not found / missing deps                          │
│     → Install pnpm (see QUICK_START.md Prerequisites), then            │
│       pnpm install && pnpm build                                       │
│                                                                        │
│  💡 Want to change the default AI model?                               │
│     → ./mafia.sh config --model openai/gpt-4o-mini                     │
│                                                                        │
│  💡 Want per-role models (mafia/plants/town on different models)?      │
│     → Add MAFIA_MODEL= / DOCTOR_MODEL= / ... overrides to .env         │
│                                                                        │
│  💡 Want a web dashboard?                                              │
│     → pnpm run server (one terminal) + pnpm run web (another),         │
│       then open http://localhost:5174                                  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

🎉 Everything above is wired to the monorepo — run any command to play!

╔════════════════════════════════════════════════════════════════════╗
║  Status: ✅ Monorepo Verified    ✅ Commands Live    ✅ Docs Fresh     ║
╚════════════════════════════════════════════════════════════════════╝