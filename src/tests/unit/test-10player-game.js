// ============================================
// RUN 10 PLAYER GAME TEST
// Confirms everything works end-to-end
// ============================================

require("dotenv").config();

const { MafiaGame } = require("../../../game-engine");

async function run10PlayerGameTest() {
  console.log("\n" + "=".repeat(70));
  console.log("🎮 10-PLAYER GAME TEST");
  console.log("=".repeat(70) + "\n");

  const game = new MafiaGame({
    maxRetries: 2,
    enableDatabase: true,
    allowMultiRole: true,
  });

  try {
    // Start game with 10 players
    await game.startGame(10);

    console.log("\n" + "=".repeat(70));
    console.log("📊 COST TRACKING REPORT");
    console.log("=".repeat(70));

    // Check cost tracking
    if (game.costTracker) {
      const costReport = game.costTracker.getCostReport(game.gameId);

      console.log("\nSummary:");
      console.log(`  Total Cost: $${costReport.totalCost.toFixed(6)}`);
      console.log(`  Total Tokens: ${formatTokens(costReport.totalTokens)}`);
      console.log(
        `  Budget Used: ${(costReport.budgetUsedPct * 100).toFixed(2)}%`,
      );
      console.log(
        `  Budget Remaining: $${costReport.budgetRemaining.toFixed(6)}`,
      );
      console.log(`  Warnings Triggered: ${costReport.warningsTriggered}`);
      console.log(`  Stops Triggered: ${costReport.stopsTriggered}`);

      console.log("\nPlayer Breakdown:");
      console.log(`  Players tracked: ${costReport.players.length}`);
      for (const player of costReport.players) {
        console.log(`  ${player.playerName}:`);
        console.log(
          `    Turns: ${player.totalTurns}, Cost: $${player.totalCost.toFixed(6)}`,
        );
      }

      console.log("\nModel Breakdown:");
      for (const model of costReport.models) {
        console.log(
          `  ${model.provider}/${model.model}: ${model.totalTurns} turns, $${model.totalCost.toFixed(6)}`,
        );
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ 10-PLAYER GAME TEST COMPLETE");
    console.log("=".repeat(70) + "\n");
  } catch (error) {
    console.error("\n❌ Game test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function formatTokens(tokens) {
  if (!tokens || isNaN(tokens)) return "N/A";
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(2) + "M";
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(2) + "K";
  }
  return tokens.toString();
}

run10PlayerGameTest().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
