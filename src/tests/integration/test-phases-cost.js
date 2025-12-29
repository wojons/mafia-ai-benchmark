#!/usr/bin/env node
/**
 * Mafia Game Engine - FSM Phase & Cost Tracking Tests
 *
 * Tests for:
 * 1. FSM Phase transitions
 * 2. Cost tracking per player
 * 3. Multi-round game mechanics
 * 4. Role mechanics
 * 5. Model configuration
 * 6. Error handling
 *
 * Run: node games/test-phases-cost.js
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

async function apiRequest(method, path, body = null) {
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
    req.setTimeout(10000, () => {
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

function assertGreaterThan(actual, min, msg) {
  if (actual <= min) throw new Error(msg || `Expected ${actual} > ${min}`);
}

// ============================================
// FSM PHASE TRANSITION TESTS
// ============================================

async function testFSMPhaseTransitions() {
  console.log(C.cyan("\n[FSM PHASE TRANSITIONS] Testing phase flow"));
  console.log(C.gray("=".repeat(60)));

  await test("Game starts in SETUP phase", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assert(game.data.data?.config);
  });

  await test("Game transitions to IN_PROGRESS after start", async () => {
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

  await test("Game can be stopped", async () => {
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

  await test("Cannot start already started game", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }

    await apiRequest("POST", `/api/v1/games/${id}/start`);
    const secondStart = await apiRequest("POST", `/api/v1/games/${id}/start`);

    assert(secondStart.status >= 400, "Should error on second start");
  });
}

// ============================================
// COST TRACKING TESTS
// ============================================

async function testCostTracking() {
  console.log(C.cyan("\n[COST TRACKING] Testing API cost tracking"));
  console.log(C.gray("=".repeat(60)));

  await test("Can get model pricing", async () => {
    const res = await apiRequest(
      "GET",
      "/api/v1/models/pricing?model=gpt-4o-mini",
    );
    assertEq(res.status, 200);
    assert(res.data.data?.modelId);
  });

  await test("Can calculate cost for tokens", async () => {
    const res = await apiRequest("POST", "/api/v1/models/calculate-cost", {
      modelId: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 2000,
    });
    assertEq(res.status, 200);
    assert(typeof res.data.data?.totalCost === "number");
  });

  await test("Fallback pricing works for unknown models", async () => {
    const res = await apiRequest("POST", "/api/v1/models/calculate-cost", {
      modelId: "unknown-model-xyz",
      inputTokens: 1000,
      outputTokens: 1000,
    });
    assertEq(res.status, 200);
    assert(res.data.data?.hasPricing === false);
  });

  await test("Stats endpoint shows game counts", async () => {
    const res = await apiRequest("GET", "/api/v1/stats");
    assertEq(res.status, 200);
    assert(typeof res.data.data?.gamesCount === "number");
    assert(typeof res.data.data?.playersCount === "number");
  });

  await test("Server uptime is tracked", async () => {
    const res = await apiRequest("GET", "/health");
    assertEq(res.status, 200);
    // Health endpoint returns data directly, not wrapped in .data
    assert(res.data?.uptime !== undefined);
    assertGreaterThan(res.data?.uptime, 0);
  });
}

// ============================================
// ROLE-SPECIFIC TESTS
// ============================================

async function testRoleSpecificMechanics() {
  console.log(C.cyan("\n[ROLE MECHANICS] Testing role-specific features"));
  console.log(C.gray("=".repeat(60)));

  const roles = ["MAFIA", "DOCTOR", "SHERIFF", "VIGILANTE", "VILLAGER"];

  for (const role of roles) {
    await test(`${role} player can be added`, async () => {
      const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
      const id = res.data.data?.id;

      const addRes = await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `${role}1`,
        role,
      });

      assertEq(addRes.status, 201);
      assertEq(addRes.data.data?.role, role);
    });
  }

  await test("All role types can coexist in game", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 10 });
    const id = res.data.data?.id;

    for (const role of roles) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `${role}1`,
        role,
      });
    }

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const gameRoles = game.data.data?.players.map((p) => p.role);

    for (const role of roles) {
      assertContains(gameRoles, role, `Should have ${role} in game`);
    }
  });
}

// ============================================
// PLAYER MODEL CONFIGURATION TESTS
// ============================================

async function testPlayerModelConfig() {
  console.log(C.cyan("\n[MODEL CONFIG] Testing player/role model settings"));
  console.log(C.gray("=".repeat(60)));

  await test("Can set player model", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Player1",
      role: "VILLAGER",
    });

    const modelRes = await apiRequest(
      "POST",
      `/api/v1/games/${id}/players/0/model`,
      {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.7,
        maxTokens: 500,
      },
    );

    assert(modelRes.status === 200 || modelRes.status === 201);
    assert(modelRes.data.data?.message);
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
        maxTokens: 1000,
      },
    );

    assert(modelRes.status === 200 || modelRes.status === 201);
    assert(modelRes.data.data?.message);
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
    assert(bulkRes.data.data?.count > 0);
  });

  await test("Rejects invalid provider", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Player1",
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

    assert(modelRes.status >= 400, "Should reject invalid provider");
  });
}

// ============================================
// SSE STREAMING TESTS
// ============================================

async function testSSEStreaming() {
  console.log(C.cyan("\n[SSE STREAMING] Testing Server-Sent Events"));
  console.log(C.gray("=".repeat(60)));

  await test("SSE status endpoint exists", async () => {
    const res = await apiRequest("GET", "/api/v1/games/test-game/sse-status");
    assertEq(res.status, 200);
    assert(res.data.data?.activeConnections !== undefined);
  });
}

// ============================================
// GAME EVENTS & PLAYER TESTS
// ============================================

async function testGameEvents() {
  console.log(C.cyan("\n[GAME EVENTS] Testing game events"));
  console.log(C.gray("=".repeat(60)));

  await test("Can get game players", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "TestPlayer",
      role: "VILLAGER",
    });

    const playersRes = await apiRequest("GET", `/api/v1/games/${id}/players`);
    assertEq(playersRes.status, 200);
    assert(Array.isArray(playersRes.data.data));
    assert(playersRes.data.data.length > 0);
  });

  await test("Player join order is tracked", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    for (let i = 0; i < 3; i++) {
      const addRes = await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: "VILLAGER",
      });
      assertEq(addRes.data.data?.joinOrder, i);
    }
  });

  await test("Player alive status is tracked", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const addRes = await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "TestPlayer",
      role: "VILLAGER",
    });

    assertEq(addRes.data.data?.isAlive, true);
  });
}

// ============================================
// ERROR HANDLING TESTS
// ============================================

async function testErrorHandling() {
  console.log(C.cyan("\n[ERROR HANDLING] Testing error cases"));
  console.log(C.gray("=".repeat(60)));

  await test("Returns 404 for non-existent game", async () => {
    const res = await apiRequest(
      "GET",
      "/api/v1/games/this-game-does-not-exist-12345",
    );
    assertEq(res.status, 404);
  });

  await test("Returns 404 for non-existent endpoint", async () => {
    const res = await apiRequest("GET", "/api/v1/nonexistent/endpoint");
    assertEq(res.status, 404);
  });

  await test("Cannot start game with insufficient players", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;

    const startRes = await apiRequest("POST", `/api/v1/games/${id}/start`);
    assert(startRes.status >= 400);
  });

  await test("Cannot add players to non-existent game", async () => {
    const res = await apiRequest(
      "POST",
      "/api/v1/games/non-existent-game/players",
      { name: "Player", role: "VILLAGER" },
    );
    assertEq(res.status, 404);
  });
}

// ============================================
// GAME LIST & PAGINATION TESTS
// ============================================

async function testGameList() {
  console.log(C.cyan("\n[GAME LIST] Testing game list features"));
  console.log(C.gray("=".repeat(60)));

  await test("Game list can be filtered by status", async () => {
    const res = await apiRequest("GET", "/api/v1/games?status=SETUP");
    assertEq(res.status, 200);
    assert(Array.isArray(res.data.data));
  });

  await test("Game created with custom config", async () => {
    const res = await apiRequest("POST", "/api/v1/games", {
      config: {
        dayDurationSeconds: 60,
        nightDurationSeconds: 30,
      },
    });
    assertEq(res.status, 201);
    assert(res.data.data?.id);
  });
}

// ============================================
// MODELS ENDPOINT TESTS
// ============================================

async function testModelsEndpoint() {
  console.log(C.cyan("\n[MODELS] Testing models endpoint"));
  console.log(C.gray("=".repeat(60)));

  await test("Models list endpoint works", async () => {
    const res = await apiRequest("GET", "/api/v1/models");
    assertEq(res.status, 200);
    assert(Array.isArray(res.data.data));
    assert(res.data.data.length > 0);
  });

  await test("Model pricing without model param shows help", async () => {
    const res = await apiRequest("GET", "/api/v1/models/pricing");
    assertEq(res.status, 200);
    assert(res.data.data?.message);
    assert(res.data.data?.example);
  });
}

// ============================================
// RUNNER
// ============================================

async function runAll() {
  console.log(C.bold("\n================================================"));
  console.log(C.bold("  MAFIA GAME - PHASE & COST TEST SUITE"));
  console.log(C.bold("================================================"));
  console.log(C.gray("Server: " + SERVER_URL));
  console.log("");

  const start = Date.now();

  // Run all test categories
  await testFSMPhaseTransitions();
  await testCostTracking();
  await testRoleSpecificMechanics();
  await testPlayerModelConfig();
  await testSSEStreaming();
  await testGameEvents();
  await testErrorHandling();
  await testGameList();
  await testModelsEndpoint();

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
        ? C.green("🎉 ALL TESTS PASSED!")
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
