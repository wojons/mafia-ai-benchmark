// ============================================
// TEST GAME-ENGINE.JS WITH NEW IMPORTS
// ============================================

const { MafiaGame } = require("./game-engine");

console.log("\n" + "=".repeat(70));
console.log("🧪 TESTING GAME-ENGINE.JS WITH REFACTORED MODULES");
console.log("=".repeat(70) + "\n");

try {
  const game = new MafiaGame({
    maxRetries: 1,
    enableDatabase: false,
  });

  // Test that core functionality works
  console.log("✅ MafiaGame class instantiated");

  // Test role calculation
  const roles = game.calculateRoles(6);
  console.log(`✅ Roles calculated: ${roles.length} roles for 6 players`);
  console.log(`   Roles: ${roles.join(", ")}`);

  console.log("\n" + "=".repeat(70));
  console.log("✅ GAME-ENGINE.JS WORKING WITH NEW MODULES");
  console.log("=".repeat(70) + "\n");
} catch (error) {
  console.error("❌ Test failed:", error.message);
  console.error(error.stack);
  process.exit(1);
}
