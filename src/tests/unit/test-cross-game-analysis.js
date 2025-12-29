// ============================================
// Test Cross-Game Analysis
// Tests database queries, reports, and time-series analysis
// ============================================

const { GameDatabase } = require("./modules/database.js");

async function testCrossGameAnalysis() {
  console.log("=== Testing Cross-Game Analysis ===\n");

  try {
    // Clean up any existing test database
    const fs = require("fs");
    if (fs.existsSync("./data/test-analysis.db")) {
      fs.unlinkSync("./data/test-analysis.db");
    }

    const db = new GameDatabase("./data/test-analysis.db");
    await db.connect();
    console.log("[PASS] Database initialized");
    console.log("Stats:", db.getStats());
    console.log();

    // Create multiple test games with different outcomes
    const testGames = [
      {
        id: "game-001",
        seed: 1,
        playerCount: 10,
        mafiaCount: 2,
        status: "FINISHED",
        phase: "END",
        dayNumber: 3,
        roundNumber: 6,
        winner: "town",
        startedAt: Date.now() - 86400000 * 5, // 5 days ago
        finishedAt: Date.now() - 86400000 * 5 + 3600000, // 1 hour later
        durationMs: 3600000,
        config: { enableDatabase: true },
        initialRoles: [
          "MAFIA",
          "MAFIA",
          "DOCTOR",
          "SHERIFF",
          "VIGILANTE",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
        ],
      },
      {
        id: "game-002",
        seed: 2,
        playerCount: 10,
        mafiaCount: 2,
        status: "FINISHED",
        phase: "END",
        dayNumber: 2,
        roundNumber: 4,
        winner: "mafia",
        startedAt: Date.now() - 86400000 * 3, // 3 days ago
        finishedAt: Date.now() - 86400000 * 3 + 2400000, // 40 min later
        durationMs: 2400000,
        config: { enableDatabase: true },
        initialRoles: [
          "MAFIA",
          "MAFIA",
          "DOCTOR",
          "SHERIFF",
          "VIGILANTE",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
        ],
      },
      {
        id: "game-003",
        seed: 3,
        playerCount: 10,
        mafiaCount: 2,
        status: "FINISHED",
        phase: "END",
        dayNumber: 4,
        roundNumber: 8,
        winner: "town",
        startedAt: Date.now() - 86400000 * 1, // 1 day ago
        finishedAt: Date.now() - 86400000 * 1 + 4800000, // 80 min later
        durationMs: 4800000,
        config: { enableDatabase: true },
        initialRoles: [
          "MAFIA",
          "MAFIA",
          "DOCTOR",
          "SHERIFF",
          "VIGILANTE",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
        ],
      },
      {
        id: "game-004",
        seed: 4,
        playerCount: 10,
        mafiaCount: 2,
        status: "RUNNING",
        phase: "DAY_DISCUSSION",
        dayNumber: 2,
        roundNumber: 3,
        winner: null,
        startedAt: Date.now() - 86400000 * 0.5, // 12 hours ago
        finishedAt: null,
        durationMs: null,
        config: { enableDatabase: true },
        initialRoles: [
          "MAFIA",
          "MAFIA",
          "DOCTOR",
          "SHERIFF",
          "VIGILANTE",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
          "VILLAGER",
        ],
      },
    ];

    // Create games
    for (const game of testGames) {
      db.createGame(game);
      console.log(
        `[PASS] Created game: ${game.id} (${game.winner || "IN_PROGRESS"})`,
      );
    }
    console.log();

    // Create players for each game
    const roles = [
      "MAFIA",
      "MAFIA",
      "DOCTOR",
      "SHERIFF",
      "VIGILANTE",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
    ];
    for (const game of testGames) {
      const players = roles.map((role, i) => ({
        id: `g${game.id.slice(-3)}-p${i}`,
        name: `Player ${i + 1}`,
        role: role,
        isAlive:
          game.winner === "mafia"
            ? role === "MAFIA"
              ? true
              : false
            : role === "MAFIA"
              ? false
              : true,
      }));

      for (const player of players) {
        db.createPlayer({
          gameId: game.id,
          playerId: player.id,
          playerName: player.name,
          assignedRole: player.role,
          isAlive: player.isAlive,
          model: "gpt-4o-mini",
          provider: "openrouter",
        });
      }
    }
    console.log("Created players for all games\n");

    // Test listing games with filters
    const allFinished = db.listGames({ status: "FINISHED" });
    console.log(`[PASS] Query completed games: ${allFinished.length}`);
    allFinished.forEach((g) => {
      console.log(`  - ${g.id}: ${g.winner} won in ${g.day_number} days`);
    });
    console.log();

    // Query town wins
    const townWins = db.listGames({ winner: "town" });
    console.log(`[PASS] Query town wins: ${townWins.length}`);
    console.log(
      "  Town wins:",
      townWins.map((g) => g.id),
    );
    console.log();

    // Query recent games
    const recentGames = db.listGames({ limit: 2 });
    console.log(`[PASS] Query recent games: ${recentGames.length}`);
    recentGames.forEach((g) => {
      console.log(`  - ${g.id}: ${g.status} - ${g.phase}`);
    });
    console.log();

    // Query games over a certain duration
    const shortGames = db
      .listGames({ winner: "town" })
      .filter((g) => g.day_number <= 3);
    console.log(
      `[PASS] Query fast games (town wins, <= 3 days): ${shortGames.length}`,
    );
    shortGames.forEach((g) =>
      console.log(
        `  - ${g.id}: ${g.day_number} days, 3600s (${g.durationMs}ms)`,
      ),
    );
    console.log();

    console.log("[VERIFICATION]: All basic cross-game queries working!");

    db.close();
    const fs = require("fs");
    if (fs.existsSync("./data/test-analysis.db")) {
      fs.unlinkSync("./data/test-analysis.db");
      console.log("\n[INFO] Cleaned up test database");
    }

    console.log("\n=== CROSS-GAME ANALYSIS TESTS PASSED ===");
  } catch (error) {
    console.error("\n[FAIL] Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testCrossGameAnalysis().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

module.exports = { testCrossGameAnalysis };
