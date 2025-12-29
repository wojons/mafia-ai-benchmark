// ============================================
// RUN FULL GAME WITH COST TRACKING TEST
// ============================================

require("dotenv").config();

const { MafiaGame } = require("./game-engine");

async function runFullGameTest() {
  console.log("\n" + "=".repeat(70));
  console.log("🎮 FULL GAME TEST WITH COST TRACKING");
  console.log("=".repeat(70) + "\n");

  const game = new MafiaGame({
    maxRetries: 2,
    enableDatabase: true,
    allowMultiRole: true, // Test multi-role support
  });

  try {
    // Start game with 6 players
    await game.startGame(6);

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
      for (const player of costReport.players) {
        console.log(`  ${player.playerName}:`);
        console.log(`    Turns: ${player.totalTurns}`);
        console.log(`    Cost: $${player.totalCost.toFixed(6)}`);
        console.log(`    Avg/Turn: $${player.avgCostPerTurn.toFixed(6)}`);
        console.log(`    Warnings: ${player.warnings}, Stops: ${player.stops}`);

        if (player.costsByPhase.length > 0) {
          console.log(`    Phase Costs:`);
          for (const phase of player.costsByPhase) {
            console.log(
              `      ${phase.phase}: ${phase.turns} turns, $${phase.cost.toFixed(6)}`,
            );
          }
        }
      }

      console.log("\nModel Breakdown:");
      for (const model of costReport.models) {
        console.log(`  ${model.provider}/${model.model}:`);
        console.log(`    Turns: ${model.totalTurns}`);
        console.log(`    Cost: $${model.totalCost.toFixed(6)}`);
        console.log(`    Avg/Turn: $${model.avgCostPerTurn.toFixed(6)}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ FULL GAME TEST COMPLETE");
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

runFullGameTest().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
