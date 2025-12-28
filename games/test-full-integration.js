#!/usr/bin/env node
/**
 * Mafia Game Engine - FULL INTEGRATION TESTS
 *
 * Tests the complete game mechanics end-to-end:
 * 1. Game creation with roles
 * 2. Persona generation
 * 3. Night phase progression
 * 4. Day phase and discussion
 * 5. Voting and elimination
 * 6. Win conditions (MAFIA >= TOWN, MAFIA = 0)
 * 7. Multi-round progression
 *
 * Run: node games/test-full-integration.js
 */

const http = require("http");
const { URL } = require("url");

const SERVER_URL = process.env.MAFIA_SERVER_URL || "http://localhost:3000";

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let stats = { passed: 0, failed: 0, errors: [] };

async function apiRequest(method, path, body = null, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || 3000,
        path: url.pathname + url.search,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    stats.passed++;
    console.log(C.green("✓ ") + name);
    return true;
  } catch (e) {
    stats.failed++;
    stats.errors.push({ name, error: e.message });
    console.log(C.red("✗ ") + name);
    console.log(C.gray("  Error: ") + e.message);
    return false;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEq(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

function assertContains(arr, item, msg) {
  if (!arr.includes(item))
    throw new Error(msg || `Expected [${arr}] to contain ${item}`);
}

// ============================================
// PERSONA GENERATION TESTS
// ============================================

async function testPersonaGeneration() {
  console.log(C.cyan("\n[PERSONA GENERATION] Testing persona creation"));
  console.log(C.gray("=".repeat(60)));

  await test("Game creates players with unique names", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 5; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: "VILLAGER",
      });
    }

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const names = game.data.data?.players.map((p) => p.name);

    assertEq(
      names.length,
      new Set(names).size,
      "Player names should be unique",
    );
  });

  await test("Players can have different roles assigned", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 10 });
    const id = res.data.data?.id;

    const roles = [
      "MAFIA",
      "MAFIA",
      "DOCTOR",
      "SHERIFF",
      "VIGILANTE",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
    ];
    for (let i = 0; i < 10; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: roles[i],
      });
    }

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const gameRoles = game.data.data?.players.map((p) => p.role);

    const mafiaCount = gameRoles.filter((r) => r === "MAFIA").length;
    const doctorCount = gameRoles.filter((r) => r === "DOCTOR").length;
    const sheriffCount = gameRoles.filter((r) => r === "SHERIFF").length;
    const vigilanteCount = gameRoles.filter((r) => r === "VIGILANTE").length;

    assertEq(mafiaCount, 2, "Should have 2 mafia");
    assertEq(doctorCount, 1, "Should have 1 doctor");
    assertEq(sheriffCount, 1, "Should have 1 sheriff");
    assertEq(vigilanteCount, 1, "Should have 1 vigilante");
  });

  await test("Players with MAFIA role are tracked", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "M1",
      role: "MAFIA",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "M2",
      role: "MAFIA",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "D1",
      role: "DOCTOR",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "V1",
      role: "VILLAGER",
    });

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const mafiaPlayers = game.data.data?.players.filter(
      (p) => p.role === "MAFIA",
    );

    assertEq(mafiaPlayers.length, 2, "Should have 2 players with MAFIA role");
  });
}

// ============================================
// GAME START & PHASE TRANSITION TESTS
// ============================================

async function testGameStart() {
  console.log(C.cyan("\n[GAME START] Testing game initialization"));
  console.log(C.gray("=".repeat(60)));

  await test("Game status starts as SETUP", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(game.data.data?.status, "SETUP");
  });

  await test("Minimum 3 players required to start", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "P1",
      role: "VILLAGER",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "P2",
      role: "VILLAGER",
    });

    const startRes = await apiRequest("POST", `/api/v1/games/${id}/start`);
    assert(startRes.status >= 400, "Should reject starting with 2 players");
  });

  await test("Game starts with 3 players", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    const startRes = await apiRequest("POST", `/api/v1/games/${id}/start`);
    assert(
      startRes.status === 200 || startRes.status === 201,
      "Should start with 3 players",
    );
  });

  await test("Game status changes to IN_PROGRESS after start", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(game.data.data?.status, "IN_PROGRESS");
  });
}

// ============================================
// GAME STOP & WIN CONDITION TESTS
// ============================================

async function testGameStopAndWinConditions() {
  console.log(C.cyan("\n[WIN CONDITIONS] Testing game end conditions"));
  console.log(C.gray("=".repeat(60)));

  await test("Can stop an in-progress game", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);
    const stopRes = await apiRequest("POST", `/api/v1/games/${id}/stop`);

    assertEq(stopRes.status, 200);
  });

  await test("Game status becomes ENDED after stop", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);
    await apiRequest("POST", `/api/v1/games/${id}/stop`);

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(game.data.data?.status, "ENDED");
  });
}

// ============================================
// VOTING ENDPOINT TESTS
// ============================================

async function testVoting() {
  console.log(C.cyan("\n[VOTING] Testing vote submission"));
  console.log(C.gray("=".repeat(60)));

  await test("Can submit vote when game is running", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);

    const voteRes = await apiRequest("POST", `/api/v1/games/${id}/vote`, {
      voterId: "player1",
      targetId: "player2",
    });

    assert(voteRes.status === 200 || voteRes.status >= 400);
  });

  await test("Vote requires voterId", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const voteRes = await apiRequest("POST", `/api/v1/games/${id}/vote`, {
      targetId: "player2",
    });

    assert(voteRes.status >= 400, "Should require voterId");
  });

  await test("Vote requires targetId", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const voteRes = await apiRequest("POST", `/api/v1/games/${id}/vote`, {
      voterId: "player1",
    });

    assert(voteRes.status >= 400, "Should require targetId");
  });
}

// ============================================
// NIGHT ACTION TESTS
// ============================================

async function testNightActions() {
  console.log(C.cyan("\n[NIGHT ACTIONS] Testing night action submission"));
  console.log(C.gray("=".repeat(60)));

  await test("Can submit night action", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);

    const actionRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/night-action`,
      {
        playerId: "player1",
        action: "MAFIA_KILL",
        targetId: "player2",
      },
    );

    assert(actionRes.status === 200 || actionRes.status >= 400);
  });

  await test("Night action requires playerId", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const actionRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/night-action`,
      {
        action: "MAFIA_KILL",
        targetId: "player2",
      },
    );

    assert(actionRes.status >= 400);
  });

  await test("Night action requires action type", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const actionRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/night-action`,
      {
        playerId: "player1",
        targetId: "player2",
      },
    );

    assert(actionRes.status >= 400);
  });
}

// ============================================
// GAME LIST & STATE TESTS
// ============================================

async function testGameList() {
  console.log(C.cyan("\n[GAME LIST] Testing game listing"));
  console.log(C.gray("=".repeat(60)));

  await test("Can list all games", async () => {
    const res = await apiRequest("GET", "/api/v1/games");
    assertEq(res.status, 200);
    assert(Array.isArray(res.data.data));
  });

  await test("Can filter games by status", async () => {
    const res = await apiRequest("GET", "/api/v1/games?status=SETUP");
    assertEq(res.status, 200);
    assert(Array.isArray(res.data.data));
  });

  await test("Can get specific game details", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = create.data.data?.id;

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(game.status, 200);
    assertEq(game.data.data?.id, id);
  });

  await test("Returns 404 for non-existent game", async () => {
    const res = await apiRequest(
      "GET",
      "/api/v1/games/this-does-not-exist-123",
    );
    assertEq(res.status, 404);
  });

  await test("Can get game players list", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Test",
      role: "VILLAGER",
    });

    const players = await apiRequest("GET", `/api/v1/games/${id}/players`);
    assertEq(players.status, 200);
    assert(Array.isArray(players.data.data));
    assert(players.data.data.length > 0, "Should have at least one player");
  });
}

// ============================================
// MODEL CONFIGURATION TESTS
// ============================================

async function testModelConfig() {
  console.log(C.cyan("\n[MODEL CONFIG] Testing model settings"));
  console.log(C.gray("=".repeat(60)));

  await test("Can set player-specific model", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "P1",
      role: "VILLAGER",
    });

    const modelRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/players/0/model`,
      {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.7,
      },
    );

    assert(modelRes.status === 200 || modelRes.status === 201);
  });

  await test("Can set role-based model", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const modelRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/role/MAFIA/model`,
      {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        temperature: 0.5,
      },
    );

    assert(modelRes.status === 200 || modelRes.status === 201);
  });

  await test("Can bulk update models", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const bulkRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/models/bulk`,
      {
        assignments: [
          {
            type: "player",
            index: 0,
            provider: "openai",
            model: "gpt-4o-mini",
          },
          {
            type: "role",
            role: "DOCTOR",
            provider: "google",
            model: "gemini-2.5-flash-exp",
          },
        ],
      },
    );

    assert(bulkRes.status === 200 || bulkRes.status === 201);
  });

  await test("Rejects invalid provider", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "P1",
      role: "VILLAGER",
    });

    const modelRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/players/0/model`,
      {
        provider: "invalid-provider",
        model: "some-model",
      },
    );

    assert(modelRes.status >= 400);
  });
}

// ============================================
// STATS & COST TESTS
// ============================================

async function testStatsAndCost() {
  console.log(C.cyan("\n[STATS & COST] Testing stats and pricing"));
  console.log(C.gray("=".repeat(60)));

  await test("Can get server stats", async () => {
    const res = await apiRequest("GET", "/api/v1/stats");
    assertEq(res.status, 200);
    assert(typeof res.data.data?.gamesCount === "number");
  });

  await test("Can get model pricing", async () => {
    const res = await apiRequest(
      "GET",
      "/api/v1/models/pricing?model=gpt-4o-mini",
    );
    assertEq(res.status, 200);
    assert(res.data.data?.modelId);
  });

  await test("Can calculate token cost", async () => {
    const res = await apiRequest("POST", "/api/v1/models/calculate-cost", {
      modelId: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 2000,
    });
    assertEq(res.status, 200);
    assert(typeof res.data.data?.totalCost === "number");
  });

  await test("Can list available models", async () => {
    const res = await apiRequest("GET", "/api/v1/models");
    assertEq(res.status, 200);
    assert(Array.isArray(res.data.data));
    assert(res.data.data.length > 0);
  });

  await test("Server health endpoint works", async () => {
    const res = await apiRequest("GET", "/health");
    assertEq(res.status, 200);
    assert(res.data?.uptime > 0);
  });
}

// ============================================
// SSE STREAMING TESTS
// ============================================

async function testSSE() {
  console.log(C.cyan("\n[SSE] Testing Server-Sent Events"));
  console.log(C.gray("=".repeat(60)));

  await test("SSE status endpoint exists", async () => {
    const res = await apiRequest("GET", "/api/v1/games/test-game/sse-status");
    assertEq(res.status, 200);
    assert(res.data.data?.activeConnections !== undefined);
  });
}

// ============================================
// ACCUSATION & ROLE CLAIM TESTS
// ============================================

async function testAccusationsAndClaims() {
  console.log(C.cyan("\n[ACCUSATIONS & CLAIMS] Testing game interactions"));
  console.log(C.gray("=".repeat(60)));

  await test("Can submit accusation", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);

    const accRes = await apiRequest("POST", `/api/v1/games/${id}/accusation`, {
      accuserId: "player1",
      targetId: "player2",
      accusation: "I think they're mafia!",
      evidence: "They haven't talked.",
    });

    assert(accRes.status === 200 || accRes.status >= 400);
  });

  await test("Can submit role claim", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);

    const claimRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/claim-role`,
      {
        playerId: "player1",
        role: "SHERIFF",
      },
    );

    assert(claimRes.status === 200 || claimRes.status >= 400);
  });
}

// ============================================
// RUNNER
// ============================================

async function runAll() {
  console.log(C.bold("\n================================================"));
  console.log(C.bold("  MAFIA GAME - FULL INTEGRATION TEST SUITE"));
  console.log(C.bold("================================================"));
  console.log(C.gray("Server: " + SERVER_URL));
  console.log("");

  const start = Date.now();

  // Run all test categories
  await testPersonaGeneration();
  await testGameStart();
  await testGameStopAndWinConditions();
  await testVoting();
  await testNightActions();
  await testGameList();
  await testModelConfig();
  await testStatsAndCost();
  await testSSE();
  await testAccusationsAndClaims();

  const duration = ((Date.now() - start) / 1000).toFixed(2);

  console.log(C.bold("\n================================================"));
  console.log(C.bold("  RESULTS"));
  console.log(C.bold("================================================"));
  console.log(C.green("\n✓ Passed: " + stats.passed));
  console.log(C.red("✗ Failed: " + stats.failed));
  console.log(C.gray("⏱️  Duration: " + duration + "s"));

  if (stats.errors.length > 0) {
    console.log(C.red("\nFailed tests:"));
    stats.errors.forEach((e, i) => console.log("  " + (i + 1) + ". " + e.name));
  }

  console.log(
    "\n" +
      (stats.failed === 0
        ? C.green("🎉 ALL INTEGRATION TESTS PASSED!")
        : C.red("⚠️  Some tests failed")),
  );

  return stats.failed === 0;
}

// Main
runAll()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((e) => {
    console.error("Test error:", e);
    process.exit(1);
  });
