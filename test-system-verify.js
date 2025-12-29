// ============================================
// QUICK SYSTEM VERIFICATION TEST
// Confirms all systems initialize correctly
// ============================================

require("dotenv").config();

const { MafiaGame } = require("./game-engine");
const {
  CostTracker,
  ContextCompressor,
  EventReplay,
} = require("./cost-tracking");
const { EvidenceManager, SuspectMeter } = require("./evidence-system");
const { getRandomName } = require("./name-database");

console.log("\n" + "=".repeat(70));
console.log("🧪 SYSTEM VERIFICATION TEST");
console.log("=".repeat(70) + "\n");

// Test 1: Name Database
console.log("TEST 1: Name Database");
try {
  const names = Array.from({ length: 10 }, () => getRandomName());
  console.log(
    `✅ Generated 10 unique names: ${names.slice(0, 5).join(", ")}...`,
  );
  const hasDuplicates = names.length !== new Set(names).size;
  if (hasDuplicates) {
    console.warn("⚠️  Warning: Duplicate names detected");
  } else {
    console.log("✅ All names unique");
  }
} catch (error) {
  console.error("❌ Name database test failed:", error.message);
}

// Test 2: Cost Tracker
console.log("\nTEST 2: Cost Tracker");
try {
  const mockDb = {
    run: () => {},
    all: () => [],
    get: () => null,
    exec: () => {},
  };
  const tracker = new CostTracker(mockDb);
  const result = tracker.trackPlayerTurn("test-game", "p1", "Alice", {
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
  });
  console.log(`✅ Cost tracked: $${result.totalCost.toFixed(6)}`);
} catch (error) {
  console.error("❌ Cost tracker test failed:", error.message);
}

// Test 3: Evidence System
console.log("\nTEST 3: Evidence System");
try {
  const manager = new EvidenceManager("p1", "Alice");
  manager.addEvidence("suspicious", {
    target: "Bob",
    type: "behavior",
    description: "Bob voted late",
    confidence: 60,
  });
  const suspects = manager.getSuspects();
  console.log(`✅ Evidence tracked: ${suspects.length} suspects`);
  console.log(
    `   Top suspect: ${suspects[0]?.target} (${suspects[0]?.cumulativeScore}%)`,
  );
} catch (error) {
  console.error("❌ Evidence system test failed:", error.message);
}

// Test 4: Context Compressor
console.log("\nTEST 4: Context Compressor");
try {
  const compressor = new ContextCompressor();
  const history = Array.from({ length: 100 }, (_, i) => ({
    player: `Player${i % 10}`,
    message: `Message ${i}: I think Player${(i + 1) % 10} is suspicious.`,
  }));
  const compressed = compressor.compressHistory(
    { chatHistory: history, maxContextChars: 5000 },
    null,
    { priority: "evidence", removeVotingDuplicates: true },
  );
  console.log(
    `✅ Compressed: ${history.length} → ${compressed.length} messages`,
  );
  console.log(
    `   Reduction: ${((1 - compressed.length / history.length) * 100).toFixed(1)}%`,
  );
} catch (error) {
  console.error("❌ Context compressor test failed:", error.message);
}

// Test 5: Game Engine Initialization
console.log("\nTEST 5: Game Engine");
try {
  const game = new MafiaGame({
    maxRetries: 1,
    enableDatabase: false,
  });

  // Verify all systems initialized
  const checks = [
    { name: "Context Compressor", exists: !!game.contextCompressor },
    { name: "Evidence Managers Map", exists: !!game.evidenceManagers },
    { name: "Suspect Meter", exists: !!game.suspectMeter },
  ];

  checks.forEach((check) => {
    if (check.exists) {
      console.log(`✅ ${check.name} initialized`);
    } else {
      console.log(`❌ ${check.name} not initialized`);
    }
  });

  // Test role calculation
  const roles = game.calculateRoles(10);
  const roleCounts = {
    MAFIA: roles.filter(
      (r) => r === "MAFIA" || (Array.isArray(r) && r.includes("MAFIA")),
    ).length,
    DOCTOR: roles.filter(
      (r) => r === "DOCTOR" || (Array.isArray(r) && r.includes("DOCTOR")),
    ).length,
    SHERIFF: roles.filter(
      (r) => r === "SHERIFF" || (Array.isArray(r) && r.includes("SHERIFF")),
    ).length,
    VIGILANTE: roles.filter(
      (r) => r === "VIGILANTE" || (Array.isArray(r) && r.includes("VIGILANTE")),
    ).length,
    VILLAGER: roles.filter(
      (r) => r === "VILLAGER" || (Array.isArray(r) && r.includes("VILLAGER")),
    ).length,
  };

  console.log(`   10-player role distribution:`);
  console.log(
    `   Mafia: ${roleCounts.MAFIA}, Doctor: ${roleCounts.DOCTOR}, Sheriff: ${roleCounts.SHERIFF}, Vigilante: ${roleCounts.VIGILANTE}, Villagers: ${roleCounts.VILLAGER}`,
  );

  // Validate role counts
  const total =
    roleCounts.MAFIA +
    roleCounts.DOCTOR +
    roleCounts.SHERIFF +
    roleCounts.VIGILANTE +
    roleCounts.VILLAGER;
  if (total !== 10) {
    console.warn(`⚠️  Warning: Role count mismatch (${total} != 10)`);
  } else {
    console.log(`✅ Role distribution correct`);
  }
} catch (error) {
  console.error("❌ Game engine test failed:", error.message);
  console.error(error.stack);
}

console.log("\n" + "=".repeat(70));
console.log("✅ SYSTEM VERIFICATION COMPLETE");
console.log("=" + "=".repeat(69) + "\n");
