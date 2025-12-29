// ============================================
// Test Database Integration
// Tests basic database functionality
// ============================================

const { GameDatabase } = require("./modules/database.js");

async function testDatabase() {
  console.log("=== Testing Database Integration ===\n");

  try {
    // Create database instance
    const db = new GameDatabase("./data/test-mafia.db");
    await db.connect(); // Wait for connection/initialization
    console.log("[PASS] Database initialized");
    console.log("Stats:", db.getStats());
    console.log();

    // Test creating a game
    const gameId = "game-test-" + Date.now();
    const gameData = {
      id: gameId,
      seed: 42,
      playerCount: 5,
      mafiaCount: 1,
      status: "CREATED",
      phase: "SETUP",
      dayNumber: 0,
      roundNumber: 0,
      config: { maxContextChars: 100000 },
      initialRoles: ["MAFIA", "DOCTOR", "SHERIFF", "VILLAGER", "VILLAGER"],
    };

    db.createGame(gameData);
    console.log(`[PASS] Created test game: ${gameId}`);

    // Test retrieving game
    const retrievedGame = db.getGame(gameId);
    console.log(
      "[PASS] Retrieved game:",
      retrievedGame.status,
      "-",
      retrievedGame.phase,
    );
    console.log();

    // Test appending events
    db.appendEvent(gameId, {
      event_type: "PHASE_CHANGE",
      timestamp: Date.now(),
      private: false,
      payload: { from: "SETUP", to: "NIGHT_ACTIONS", dayNumber: 1 },
    });
    console.log("[PASS] Appended event #0");

    db.appendEvent(gameId, {
      event_type: "MAFIA_CHAT",
      timestamp: Date.now(),
      private: true,
      payload: { playerId: "p1", message: "Let's kill someone" },
    });
    console.log("[PASS] Appended event #1");

    db.appendEvent(gameId, {
      event_type: "NIGHT_RESOLVE",
      timestamp: Date.now(),
      private: false,
      payload: { killedPlayer: "Alice", role: "VILLAGER" },
    });
    console.log("[PASS] Appended event #2");
    console.log();

    // Test retrieving events
    const allEvents = db.getEvents(gameId);
    console.log(`[PASS] Retrieved ${allEvents.length} events:`);
    allEvents.forEach((e) => {
      console.log(
        `  - #${e.sequence}: ${e.eventType} (${e.private ? "PRIVATE" : "PUBLIC"})`,
      );
    });
    console.log();

    // Test filtering events
    const publicEvents = db.getEvents(gameId, { excludePrivate: true });
    console.log(`[PASS] Retrieved ${publicEvents.length} public events`);

    const sinceEvents = db.getEvents(gameId, { since: 0 });
    console.log(
      `[PASS] Retrieved ${sinceEvents.length} events since sequence 0`,
    );
    console.log();

    // Test updating game
    db.updateGame(gameId, {
      status: "RUNNING",
      phase: "NIGHT_ACTIONS",
      dayNumber: 1,
    });
    console.log("[PASS] Updated game status");

    const updatedGame = db.getGame(gameId);
    console.log(
      "[PASS] New status:",
      updatedGame.status,
      "-",
      updatedGame.phase,
    );
    console.log();

    // Test snapshot
    db.createSnapshot(gameId, 2, {
      players: [],
      round: 1,
      phase: "NIGHT_ACTIONS",
    });
    console.log("[PASS] Created snapshot");

    const snapshot = db.getSnapshot(gameId, 2);
    console.log("[PASS] Retrieved snapshot:", snapshot ? "Found" : "Not found");
    console.log();

    // Test players
    db.createPlayer({
      gameId: gameId,
      playerId: "p1",
      playerName: "Alice",
      assignedRole: "MAFIA",
      isAlive: true,
      model: "gpt-4o-mini",
      provider: "openrouter",
    });
    console.log("[PASS] Created player: p1 (Alice - MAFIA)");

    db.createPlayer({
      gameId: gameId,
      playerId: "p2",
      playerName: "Bob",
      assignedRole: "SHERIFF",
      isAlive: true,
      model: "gpt-4o-mini",
      provider: "openrouter",
    });
    console.log("[PASS] Created player: p2 (Bob - SHERIFF)");

    const players = db.getPlayers(gameId);
    console.log(`[PASS] Retrieved ${players.length} players:`);
    players.forEach((p) => {
      console.log(
        `  - ${p.player_name} (${p.assigned_role}): ${p.is_alive ? "ALIVE" : "DEAD"}`,
      );
    });

    db.updatePlayer(gameId, "p1", { isAlive: false });
    console.log("[PASS] Player p1 marked as dead");

    const updatedPlayers = db.getPlayers(gameId);
    console.log(
      `[PASS] Player p1 status: ${updatedPlayers.find((p) => p.player_id === "p1").is_alive ? "ALIVE" : "DEAD"}`,
    );
    console.log();

    // Test listing games
    const games = db.listGames({ limit: 5 });
    console.log(`[PASS] Listed ${games.length} recent games`);
    console.log();

    // Get final stats
    console.log("Final Database Stats:", db.getStats());

    console.log("\n=== ALL TESTS PASSED ===");

    // Cleanup
    db.close();

    // Delete test database file
    if (require("fs").existsSync("./data/test-mafia.db")) {
      require("fs").unlinkSync("./data/test-mafia.db");
      console.log("[INFO] Cleaned up test database");
    }
  } catch (error) {
    console.error("\n[FAIL] Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  testDatabase().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

module.exports = { testDatabase };
