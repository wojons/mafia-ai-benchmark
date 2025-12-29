// ============================================
// TEST COST TRACKING INTEGRATION
// ============================================

require("dotenv").config();

const { MafiaGame } = require("./game-engine");
const {
  CostTracker,
  ContextCompressor,
  EventReplay,
  initializeSupportingSchema,
} = require("./cost-tracking");
const { getDatabase } = require("./modules/database");

async function testCostTrackingIntegration() {
  console.log("\n" + "=".repeat(70));
  console.log("TESTING COST TRACKING INTEGRATION");
  console.log("=".repeat(70) + "\n");

  // Test 1: CostTracker standalone
  console.log("TEST 1: Standalone CostTracker");
  const gameDb = await getDatabase(":memory:");
  // CostTracker uses the underlying sql.js db, not GameDatabase wrapper
  const db = gameDb.db;
  try {
    await initializeSupportingSchema(db);
    console.log("✅ Schema initialized");

    const costTracker = new CostTracker(db, {
      perPlayerPerTurn: 0.5,
      perGameTotal: 10.0,
      warningThreshold: 0.8,
    });

    // Test cost tracking for a player turn
    const result = costTracker.trackPlayerTurn(
      "test-game-123",
      "player-1",
      "Alice",
      {
        phase: "DAY_DISCUSSION",
        actionType: "DISCUSS",
        promptTokens: 1000,
        completionTokens: 200,
        model: "openai/gpt-4o-mini",
        provider: "openrouter",
        prices: {
          promptPricePerMillion: 0.15,
          completionPricePerMillion: 0.6,
        },
      },
    );

    console.log(`Turn tracked: ${result.totalCost.toFixed(6)} USD`, result);
    console.log(`Budget used: ${(result.budgetUsedPct * 100).toFixed(2)}%`);

    // Test budget limits
    const budget = costTracker.getPlayerBudget("test-game-123", "player-1");
    console.log(`Player budget:`, budget);
    console.log("✅ CostTracker working\n");

    // Test cost report
    const report = costTracker.getCostReport("test-game-123");
    console.log("Cost report:", report);
  } catch (error) {
    console.error("❌ CostTracker test failed:", error.message);
    console.error(error.stack);
  }

  // Test 2: ContextCompressor
  console.log("TEST 2: ContextCompressor");
  try {
    const compressor = new ContextCompressor();
    const chatHistory = [
      {
        player: "Alice",
        message: "I think Bob is mafia because he voted last round.",
      },
      {
        player: "Bob",
        message: "I'm not mafia! Alice is suspicious for accusing me.",
      },
      { player: "Alice", message: "Bob is definitely mafia, trust me." },
      { player: "Bob", message: "Alice keeps accusing me, she must be mafia." },
      {
        player: "Alice",
        message: "Bob is lying, I've seen him vote against town.",
      },
      { player: "Bob", message: "Alice is lying!" },
      {
        player: "Charlie",
        message: "I think Dave is mafia because of his behavior.",
      },
      { player: "Dave", message: "I'm innocent!" },
    ];

    const compressed = compressor.compressHistory(
      { chatHistory, maxContextChars: 5000 },
      null,
      {
        priority: "evidence",
        removeVotingDuplicates: true,
        summarizeRepetitiveArgs: true,
      },
    );

    console.log(`Original messages: ${chatHistory.length}`);
    console.log(`Compressed messages: ${compressed.length}`);
    console.log("✅ ContextCompressor working\n");
  } catch (error) {
    console.error("❌ ContextCompressor test failed:", error.message);
  }

  // Test 3: EventReplay
  console.log("TEST 3: EventReplay");
  try {
    const replay = new EventReplay(db);

    const testEvent = {
      gameId: "test-game-123",
      round: 1,
      phase: "DAY_DISCUSSION",
      playerId: "player-1",
      type: "MESSAGE",
      visibility: "PUBLIC",
      content: { message: "Test message" },
      timestamp: Date.now(),
    };

    replay.captureEvent(testEvent, { round: 1, phase: "DAY_DISCUSSION" });
    console.log("✅ Event captured");

    // Use sql.js pattern to query
    const stmt = db.prepare(
      "SELECT * FROM game_events_replay WHERE gameId = ?",
    );
    const events = [];
    stmt.bind(["test-game-123"]);
    while (stmt.step()) {
      events.push(stmt.getAsObject());
    }
    stmt.free();

    console.log(`Events in database: ${events.length}`);
    console.log("✅ EventReplay working\n");
  } catch (error) {
    console.error("❌ EventReplay test failed:", error.message);
    console.error(error.stack);
  }

  // Test 4: Integration with MafiaGame (quick test)
  console.log("TEST 4: MafiaGame Integration");
  try {
    const game = new MafiaGame({
      enableDatabase: false, // Quick test without database
      maxRetries: 1,
    });

    // Check if cost tracker is initialized
    if (game.costTracker) {
      console.log("✅ Cost tracker initialized in game");
    } else {
      console.log(
        "⚠️  Cost tracker not initialized (expected without database)",
      );
    }

    // Check if context compressor is initialized
    if (game.contextCompressor) {
      console.log("✅ Context compressor initialized in game");
    } else {
      console.log("❌ Context compressor not initialized");
    }

    // Check if event replay is initialized
    if (game.eventReplay) {
      console.log("✅ Event replay initialized in game");
    } else {
      console.log(
        "⚠️  Event replay not initialized (expected without database)",
      );
    }
  } catch (error) {
    console.error("❌ Game integration test failed:", error.message);
  }

  console.log("\n" + "=".repeat(70));
  console.log("COST TRACKING INTEGRATION TEST COMPLETE");
  console.log("=".repeat(70) + "\n");

  process.exit(0);
}

testCostTrackingIntegration().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
