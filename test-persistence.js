// ============================================
// Test Game Persistence & Recovery
// Tests pause/resume, checkpoint, and recovery
// ============================================

const { GameDatabase } = require("./modules/database.js");

async function testPersistence() {
  console.log("=== Testing Game Persistence & Recovery ===\n");

  try {
    const db = new GameDatabase("./data/test-persistence.db");
    await db.connect();
    console.log("[PASS] Database initialized\n");

    const gameId = "game-persistence-test-" + Date.now();

    // 1. Create a game with players
    db.createGame({
      id: gameId,
      seed: 42,
      playerCount: 5,
      mafiaCount: 1,
      status: "RUNNING",
      phase: "DAY_DISCUSSION",
      dayNumber: 2,
      roundNumber: 2,
      createdAt: Date.now(),
      config: { enableDatabase: true },
      initialRoles: ["MAFIA", "DOCTOR", "SHERIFF", "VILLAGER", "VILLAGER"],
    });
    console.log(`[PASS] Created game: ${gameId}`);

    // 2. Add players
    const players = [
      { id: "p1", name: "Alice", role: "MAFIA", isAlive: true },
      { id: "p2", name: "Bob", role: "DOCTOR", isAlive: true },
      { id: "p3", name: "Charlie", role: "SHERIFF", isAlive: true },
      { id: "p4", name: "Dana", role: "VILLAGER", isAlive: false }, // Dead
      { id: "p5", name: "Eve", role: "VILLAGER", isAlive: true },
    ];

    for (const player of players) {
      db.createPlayer({
        gameId: gameId,
        playerId: player.id,
        playerName: player.name,
        assignedRole: player.role,
        isAlive: player.isAlive,
        model: "gpt-4o-mini",
        provider: "openrouter",
      });
    }
    console.log(`[PASS] Created ${players.length} players`);

    // 3. Create chat events with full context
    const chatEvents = [
      {
        event_type: "PLAYER_MESSAGE",
        player: "Alice",
        visibility: "PUBLIC",
        payload: {
          thinks: "As mafia, I need to be careful...",
          says: "I think Bob seems suspicious.",
        },
        gameState: {
          round: 2,
          phase: "DAY_DISCUSSION",
          alivePlayers: 4,
        },
      },
      {
        event_type: "PLAYER_MESSAGE",
        player: "Bob",
        visibility: "PUBLIC",
        payload: {
          thinks: "I'm the doctor, I need to protect Charlie...",
          says: "Alice, why are you accusing me?",
        },
        gameState: {
          round: 2,
          phase: "DAY_DISCUSSION",
          alivePlayers: 4,
        },
      },
      {
        event_type: "MAFIA_CHAT",
        player: "Alice",
        visibility: "PRIVATE_MAFIA",
        payload: {
          thinks: "Kill Charlie tonight...",
          says: "Let's target the sheriff.",
        },
      },
    ];

    for (const event of chatEvents) {
      db.appendEvent(gameId, {
        event_type: event.event_type,
        timestamp: Date.now(),
        private: event.visibility === "PRIVATE_MAFIA",
        payload: event.payload,
      });
    }
    console.log(`[PASS] Created ${chatEvents.length} events`);

    // 4. Create a game state snapshot (checkpoint)
    const gameState = {
      gameId: gameId,
      round: 2,
      phase: "DAY_DISCUSSION",
      players: players,
      votingHistory: [{ round: 1, votes: ["Alice", "Bob"] }],
      mafiaKillTarget: { id: "p3", name: "Charlie" },
      lastCheckpoint: Date.now(),
    };

    db.createSnapshot(gameId, 10, gameState);
    console.log("[PASS] Created snapshot at sequence 10");

    // 5. Pause the game
    db.updateGame(gameId, { status: "PAUSED" });
    console.log("[PASS] Paused game\n");

    // 6. SIMULATE CRASH: Clear all memory
    console.log("--- SIMULATING CRASH ---\n");
    db.close();

    // 7. RECOVERY: Reload from database
    console.log("--- RECOVERING FROM DATABASE ---\n");
    const db2 = new GameDatabase("./data/test-persistence.db");
    await db2.connect();

    // 7a. Load game
    const recoveredGame = db2.getGame(gameId);
    console.log(
      `[PASS] Recovered game: ${recoveredGame.status} - ${recoveredGame.phase}`,
    );

    // 7b. Load players
    const recoveredPlayers = db2.getPlayers(gameId);
    console.log(`[PASS] Recovered ${recoveredPlayers.length} players:`);
    recoveredPlayers.forEach((p) => {
      console.log(
        `  - ${p.player_name} (${p.assigned_role}): ${p.is_alive ? "ALIVE" : "DEAD"}`,
      );
    });

    // 7c. Load events (public only)
    const publicEvents = db2.getEvents(gameId, { excludePrivate: true });
    console.log(`[PASS] Recovered ${publicEvents.length} public events:`);
    publicEvents.forEach((e) => {
      console.log(
        `  - ${e.eventType}: ${e.payload.says || e.payload.payload?.says || "no message"}`,
      );
    });

    // 7d. Load snapshot (checkpoint)
    const snapshot = db2.getLatestSnapshot(gameId);
    console.log(`\n[PASS] Recovered checkpoint:`);
    console.log(`  - Round: ${snapshot.gameState.round}`);
    console.log(`  - Phase: ${snapshot.gameState.phase}`);
    console.log(`  - Mafia Target: ${snapshot.gameState.mafiaKillTarget.name}`);
    console.log(
      `  - Voting History: ${JSON.stringify(snapshot.gameState.votingHistory)}`,
    );

    // 8. Verify state integrity
    const playersMatch = recoveredPlayers.length === players.length;
    const eventsMatch = publicEvents.length === 2; // 2 public events
    const stateMatch = snapshot.gameState.round === 2;
    const phaseMatch = recoveredGame.phase === "DAY_DISCUSSION";

    console.log(`\n[VERIFICATION]:`);
    console.log(`  Players match: ${playersMatch ? "✅" : "❌"}`);
    console.log(`  Events match: ${eventsMatch ? "✅" : "❌"}`);
    console.log(`  State match: ${stateMatch ? "✅" : "❌"}`);
    console.log(`  Phase match: ${phaseMatch ? "✅" : "❌"}`);

    if (playersMatch && eventsMatch && stateMatch && phaseMatch) {
      console.log("\n=== PERSISTENCE & RECOVERY TESTS PASSED ===");
    } else {
      throw new Error("State verification failed");
    }

    // Cleanup
    db2.close();
    const fs = require("fs");
    if (fs.existsSync("./data/test-persistence.db")) {
      fs.unlinkSync("./data/test-persistence.db");
      console.log("\n[INFO] Cleaned up test database");
    }
  } catch (error) {
    console.error("\n[FAIL] Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testPersistence().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

module.exports = { testPersistence };
