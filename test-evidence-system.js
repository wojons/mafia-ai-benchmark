// ============================================
// TEST EVIDENCE SYSTEM
// Mafia AI Benchmark
// ============================================

require("dotenv").config();
const { MafiaGame } = require("./game-engine");
const {
  EvidenceManager,
  SuspectMeter,
  EvidenceRecord,
  PlayerCaseFile,
} = require("./evidence-system");

const E = {
  GAME: "[GAME]",
  TEST: "[TEST]",
  STATS: "[STATS]",
  EVID: "[EVIDENCE]",
  SUCCESS: "✅",
  ERROR: "❌",
};

// ============================================
// TEST FUNCTIONS
// ============================================

async function testEvidenceSystem() {
  console.log(E.TEST + " Testing Evidence & Case Building System");
  console.log("=".repeat(70));

  try {
    // 1. Test EvidenceRecord
    console.log("\n1. Testing EvidenceRecord...");
    const evidence = new EvidenceRecord({
      type: "observation",
      targetPlayerId: "player-1",
      targetPlayerName: "Alice",
      description: "Voted late in the discussion",
      reasoning: "Late voting can indicate waiting to align with majority",
      confidence: 75,
      strength: 60,
      category: "voting",
      suspicionDelta: 15,
      manipulable: true,
      round: 1,
      phase: "DAY_VOTE",
    });

    console.log(E.SUCCESS + " EvidenceRecord created");
    console.log("   ID:", evidence.id);
    console.log("   Confidence:", evidence.confidence + "%");
    console.log("   Suspicion Delta:", evidence.suspicionDelta);
    console.log("   Manipulable:", evidence.manipulable);
    console.log("   Summary: " + evidence.getSummary().split("\n")[0]);

    // 2. Test PlayerCaseFile
    console.log("\n2. Testing PlayerCaseFile...");
    const caseFile = new PlayerCaseFile("player-1", "Alice");

    caseFile.addEvidence(
      new EvidenceRecord({
        type: "observation",
        targetPlayerId: "player-1",
        targetPlayerName: "Alice",
        description: "Voted late",
        category: "voting",
        confidence: 70,
        strength: 60,
        suspicionDelta: 10,
        round: 1,
        phase: "DAY_VOTE",
      }),
    );

    caseFile.addEvidence(
      new EvidenceRecord({
        type: "deduction",
        targetPlayerId: "player-1",
        targetPlayerName: "Alice",
        description: "Defensive when accused",
        category: "statement",
        confidence: 60,
        strength: 50,
        suspicionDelta: 5,
        round: 2,
        phase: "DAY_DISCUSSION",
      }),
    );

    console.log(E.SUCCESS + " PlayerCaseFile created");
    console.log("   Evidence count:", caseFile.evidence.length);
    console.log(
      "   Suggested suspicion:",
      Math.round(caseFile.suggestedSuspicion) + "%",
    );
    console.log("   Suggested alignment:", caseFile.suggestedAlignment);

    const topEvidence = caseFile.getTopSuspiciousEvidence(2);
    console.log("\n   Top evidence:");
    topEvidence.forEach((ev, idx) => {
      console.log(
        `     [${idx + 1}] ${ev.description} [Strength: ${ev.strength}]`,
      );
    });

    // 3. Test EvidenceManager
    console.log("\n3. Testing EvidenceManager...");
    const manager = new EvidenceManager("observer-1", "Observer");

    // Test bias system
    manager.setBias("trustsLateVoters", true);
    manager.setBias("skepticalOfRoleClaims", true);

    console.log(E.SUCCESS + " EvidenceManager created");
    console.log("   Biases:", JSON.stringify(manager.biases));

    // Add some evidence
    manager.addObservation({
      type: "observation",
      targetPlayerId: "player-2",
      targetPlayerName: "Bob",
      description: "Changed vote during voting phase",
      category: "voting",
      confidence: 80,
      strength: 70,
      suspicionDelta: 15,
      round: 1,
      phase: "DAY_VOTE",
    });

    // Get most suspicious player
    const suspicious = manager.getMostSuspiciousPlayer();
    if (suspicious) {
      console.log(
        `   Most suspicious: ${suspicious.playerName} (${Math.round(suspicious.suspicion)}%)`,
      );
    }

    // Get prompt summary
    console.log("\n   Prompt Summary:");
    const summary = manager.getPromptSummary({
      includeSelfNote: false,
      topPlayersCount: 1,
      includeCaseDetails: false,
    });
    console.log("   " + summary.split("\n").slice(0, 10).join("\n   "));
    console.log("   ...");

    // 4. Test SuspectMeter
    console.log("\n4. Testing SuspectMeter...");
    const suspectMeter = new SuspectMeter();

    const mockGameState = {
      alivePlayers: [
        { id: "p1", name: "Alice", isAlive: true },
        { id: "p2", name: "Bob", isAlive: true },
        { id: "p3", name: "Charlie", isAlive: true },
      ],
    };

    const mockHistory = [
      { type: "VOTE", voterId: "p2", voter: "Bob", isLateVote: true },
      { type: "VOTE", voterId: "p2", voter: "Bob", voteChanged: true },
    ];

    const scores = suspectMeter.calculate(mockGameState, mockHistory);

    console.log(E.SUCCESS + " SuspectMeter calculated");
    console.log("   Scores:");
    for (const [playerId, score] of scores) {
      const emoji = score > 70 ? "🔴" : score > 40 ? "🟡" : "🟢";
      console.log(`     ${playerId}: ${emoji} ${Math.round(score)}%`);
    }

    // 5. Test integration with game engine
    console.log("\n5. Testing integration with MafiaGame...");
    const game = new MafiaGame({
      enableDatabase: true,
    });

    await game.startGame(5); // Minimum 5-player game for testing

    console.log(E.SUCCESS + " Evidence system integrated in game");
    console.log("   Evidence managers:", game.evidenceManagers.size);

    // Check each player has an evidence manager
    for (const [playerId, manager] of game.evidenceManagers) {
      console.log(`   - Player ${playerId}: EvidenceManager initialized`);
      console.log(
        `     Biases:`,
        Object.entries(manager.biases)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
      );
    }

    // Test prompt summary inclusion
    if (game.players.length > 0) {
      const firstPlayer = game.players[0];
      const evidenceSummary = game.getEvidenceSummary(
        firstPlayer.id || firstPlayer.name,
      );

      console.log("\n   Evidence Summary for", firstPlayer.name + ":");
      console.log(
        "   " + evidenceSummary.split("\n").slice(0, 5).join("\n   "),
      );
      console.log("   ...");
    }

    console.log("\n" + "=".repeat(70));
    console.log(E.SUCCESS + " All evidence system tests passed!");
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
  const success = await testEvidenceSystem();

  process.exit(success ? 0 : 1);
}

runAllTests();
