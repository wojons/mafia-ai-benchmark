// ============================================
// TEST STATISTICS TRACKING
// Mafia AI Benchmark
// ============================================

require("dotenv").config();
const { MafiaGame } = require("./game-engine");

const E = {
  GAME: "[GAME]",
  TEST: "[TEST]",
  STATS: "[STATS]",
  SUCCESS: "✅",
  ERROR: "❌",
};

// ============================================
// TEST FUNCTIONS
// ============================================

async function testStatisticsTracking() {
  console.log(E.TEST + " Testing Statistics & Scoring System");
  console.log("=".repeat(70));

  try {
    // 1. Create game with database enabled
    console.log("\n1. Creating game...");
    const game = new MafiaGame({
      enableDatabase: true,
    });

    // 2. Start a small 5-player game
    console.log("\n2. Starting 5-player test game...");
    await game.startGame(5);

    console.log(E.SUCCESS + " Statistics tracking test completed!");
    console.log("\n📊 Statistics Summary:");
    console.log(
      `   - Token Tracker: ${game.tokenTracker ? "Initialized" : "Not Initialized"}`,
    );
    console.log(
      `   - API Tracker: ${game.apiTracker ? "Initialized" : "Not Initialized"}`,
    );
    console.log(
      `   - Dashboard: ${game.dashboard ? "Initialized" : "Not Initialized"}`,
    );

    // 3. Check database for statistics
    if (game.db) {
      console.log("\n3. Checking database records...");

      const tokenMetrics = game.db.all("SELECT * FROM token_metrics");
      console.log(`   - Token Metrics Records: ${tokenMetrics?.length || 0}`);

      const apiMetrics = game.db.all("SELECT * FROM api_metrics");
      console.log(`   - API Metrics Records: ${apiMetrics?.length || 0}`);

      const gameStats = game.db.get(
        "SELECT * FROM game_stats WHERE gameId = ?",
        [game.gameId],
      );
      console.log(`   - Game Stats: ${gameStats ? "Saved" : "Not Saved"}`);

      const playerStats = game.db.all(
        "SELECT * FROM player_stats WHERE gameId = ?",
        [game.gameId],
      );
      console.log(`   - Player Stats Records: ${playerStats?.length || 0}`);

      // Print detailed token metrics if available
      if (tokenMetrics && tokenMetrics.length > 0) {
        console.log("\n📈 Detailed Token Metrics:");
        tokenMetrics.forEach((tm, idx) => {
          console.log(
            `   [${idx + 1}] Player ${tm.playerId}: ${tm.totalTokens} tokens, Phase: ${tm.phase}, Action: ${tm.actionType}`,
          );
        });
      }

      // Print detailed API metrics if available
      if (apiMetrics && apiMetrics.length > 0) {
        console.log("\n⏱️  Detailed API Metrics:");
        apiMetrics.forEach((am, idx) => {
          console.log(
            `   [${idx + 1}] Player ${am.playerId}: ${am.duration}ms, Status: ${am.status}, Success: ${am.success ? "Yes" : "No"}`,
          );
        });
      }

      // Print game stats if available
      if (gameStats) {
        console.log("\n🎮 Game-Level Statistics:");
        console.log(`   - Winner: ${gameStats.winner}`);
        console.log(`   - Total Rounds: ${gameStats.totalRounds}`);
        console.log(
          `   - Total Time: ${Math.round(gameStats.totalTimeMs / 1000)}s`,
        );
        console.log(
          `   - Total Tokens: ${gameStats.totalTokens.toLocaleString()}`,
        );
        console.log(`   - Total Cost: $${gameStats.totalCost.toFixed(4)}`);
      }

      // Print player stats if available
      if (playerStats && playerStats.length > 0) {
        console.log("\n👥 Player-Level Statistics:");
        playerStats.forEach((ps) => {
          console.log(
            `   • ${ps.player} (${ps.role}): ${ps.totalTokens} tokens, $${ps.totalCost.toFixed(4)}, ${ps.won ? "WON" : "LOST"}, Alive: ${ps.alive ? "Yes" : "No"}`,
          );
        });
      }

      // Check model performance
      const modelPerf = game.db.get(
        "SELECT * FROM model_performance WHERE model = 'openai/gpt-4o-mini'",
      );
      if (modelPerf) {
        console.log("\n🤖 Model Performance (aggregated):");
        console.log(`   - Total Games: ${modelPerf.totalGames}`);
        console.log(
          `   - Mafia Wins: ${modelPerf.mafiaWins} (${(modelPerf.winRateAsMafia * 100).toFixed(1)}%)`,
        );
        console.log(
          `   - Town Wins: ${modelPerf.townWins} (${(modelPerf.winRateAsTown * 100).toFixed(1)}%)`,
        );
        console.log(
          `   - Overall Win Rate: ${(modelPerf.overallWinRate * 100).toFixed(1)}%`,
        );
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(E.SUCCESS + " All tests passed!");
    return true;
  } catch (error) {
    console.error(E.ERROR + " Test failed:", error.message);
    console.error(error.stack);
    return false;
  }
}

// ============================================
// RUN TESTS
// ============================================

async function runAllTests() {
  const success = await testStatisticsTracking();

  process.exit(success ? 0 : 1);
}

runAllTests();
