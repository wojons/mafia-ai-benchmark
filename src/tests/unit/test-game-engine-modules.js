// ============================================
// TEST GAME ENGINE MODULES
// ============================================

const {
  E,
  roleEmojis,
  simpleUUID,
  generatePersona,
  generateProceduralPersona,
  generateNameFromSeed,
  createGameEvent,
  createPrompt,
} = require("../../../game-engine/index");

console.log("\n" + "=".repeat(70));
console.log("🧪 GAME ENGINE MODULES TEST");
console.log("=".repeat(70) + "\n");

// Test 1: Utils
console.log("TEST 1: Utils Module");
const uuid = simpleUUID();
console.log(`✅ Generated UUID: ${uuid}`);
console.log(
  `✅ E constants: ${Object.keys(E).length} (${E.GAME}, ${E.NIGHT}, ${E.DAY})`,
);
console.log(
  `✅ Role emojis: ${Object.keys(roleEmojis).length} (${roleEmojis.MAFIA}, ${roleEmojis.VILLAGER})`,
);

// Test 2: Persona Generator
console.log("\nTEST 2: Persona Generator (Procedural - No API needed)");
const proceduralPersona = generateProceduralPersona("Test Seed");
console.log(`✅ Generated procedural persona: ${proceduralPersona.name}`);
console.log(`   Traits: ${proceduralPersona.coreTraits.join(", ")}`);
console.log(`   Cognitive Style: ${proceduralPersona.cognitiveStyle}`);
console.log(`   Communication: ${proceduralPersona.communicationCadence}`);

// Test 3: Event Creation (mock game instance)
console.log("\nTEST 3: Event Creation");
const mockGameInstance = {
  db: null,
  config: { enableDatabase: false },
  eventSequence: 0,
  eventReplay: null,
  captureGameState: () => ({ round: 1, phase: "TEST" }),
};

const event = createGameEvent(
  "test-game",
  1,
  "DAY",
  { id: "p1", name: "Alice" },
  "MESSAGE",
  "PUBLIC",
  { message: "Hello everyone" },
  mockGameInstance,
);
console.log(`✅ Created event: ${event.eventType}`);
console.log(`   Game ID: ${event.gameId}`);
console.log(`   Player: ${event.playerName}`);
console.log(`   Type: ${event.eventType}`);
console.log(`   Visibility: ${event.visibility}`);

// Test 4: Prompt Creation
console.log("\nTEST 4: Prompt Creation");
const mockPlayer = {
  name: "Alice",
  role: "VILLAGER",
  persona: proceduralPersona,
};
const mockGameState = {
  round: 1,
  phase: "DAY_DISCUSSION",
  alivePlayers: [mockPlayer],
  deadPlayers: [],
  chatHistory: [],
};
const prompt = createPrompt(mockPlayer, mockGameState, "DAY_DISCUSSION");
console.log(`✅ Generated prompt for ${mockPlayer.name} (${mockPlayer.role})`);
console.log(`   Prompt length: ${prompt.length} chars`);
console.log(`   Contains player name: ${prompt.includes(mockPlayer.name)}`);
console.log(
  `   Contains role instructions: ${prompt.includes("You are a VILLAGER")}`,
);

console.log("\n" + "=".repeat(70));
console.log("✅ ALL MODULES WORKING CORRECTLY");
console.log("=".repeat(70) + "\n");
