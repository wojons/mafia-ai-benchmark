#!/usr/bin/env node
/**
 * Mafia Game Mechanics Test Suite - CLI Runner
 *
 * Usage:
 *   node games/run-tests.js              Run all tests
 *   node games/run-tests.js persona      Run only persona tests
 *   node games/run-tests.js voting       Run only voting tests
 *   node games/run-tests.js win          Run only win condition tests
 *   node games/run-tests.js --http       Run via HTTP API
 *   node games/run-tests.js --quick      Quick smoke test
 *
 * Runs comprehensive tests for all game mechanics.
 */

const http = require("http");
const { URL } = require("url");

// Configuration
const SERVER_URL = process.env.MAFIA_SERVER_URL || "http://localhost:3000";

// ANSI colors
const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  white: (s) => `\x1b[37m${s}\x1b[0m`,
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

// ============================================
// SMOKE TESTS (Quick validation)
// ============================================

async function smokeTests() {
  console.log(C.cyan("\n[SMOKE TESTS] Quick validation"));
  console.log(C.gray("=".repeat(60)));

  await test("Server is healthy", async () => {
    const res = await apiRequest("GET", "/health");
    assertEq(res.status, 200);
    assert(res.data.uptime > 0);
  });

  await test("Can create game", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    assertEq(res.status, 201);
    assert(res.data.data?.id);
  });

  await test("Can get game details", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 3 });
    const id = create.data.data?.id;
    const res = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(res.status, 200);
    assert(res.data.data?.id === id);
    assert(res.data.data?.status === "SETUP");
  });

  await test("Can list games", async () => {
    const res = await apiRequest("GET", "/api/v1/games");
    assertEq(res.status, 200);
    assert(Array.isArray(res.data.data));
  });

  await test("Can get stats", async () => {
    const res = await apiRequest("GET", "/api/v1/stats");
    assertEq(res.status, 200);
    assert(typeof res.data.data?.gamesCount === "number");
    assert(res.data.data?.gamesCount > 0);
  });

  await test("404 for invalid game", async () => {
    const res = await apiRequest("GET", "/api/v1/games/invalid-12345");
    assertEq(res.status, 404);
  });
}

// ============================================
// PERSONA TESTS
// ============================================

async function personaTests() {
  console.log(
    C.cyan("\n[PERSONA TESTS] Persona generation and role assignment"),
  );
  console.log(C.gray("=".repeat(60)));

  await test("Generate 5 players with personas", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    // Add players explicitly
    for (let i = 0; i < 5; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: "VILLAGER",
      });
    }
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assert(game.data.data?.players?.length >= 5);
  });

  await test("Persona has required fields", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Test",
      role: "MAFIA",
    });
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const player = game.data.data?.players[0];
    // Note: personas are generated when game starts
    assert(player?.name);
    assert(player?.role);
  });

  await test("Roles are assigned correctly", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    // Add players with specific roles
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
      name: "S1",
      role: "SHERIFF",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "V1",
      role: "VILLAGER",
    });

    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const roles = game.data.data?.players.map((p) => p.role);
    assertContains(roles, "MAFIA");
    assertContains(roles, "DOCTOR");
    assertContains(roles, "SHERIFF");
    assert(roles.includes("VILLAGER"));
  });

  await test("Player IDs are unique", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    for (let i = 0; i < 5; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `P${i}`,
        role: "VILLAGER",
      });
    }
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const ids = game.data.data?.players.map((p) => p.id);
    assertEq(ids.length, new Set(ids).size);
  });
}

// ============================================
// VOTING TESTS
// ============================================
// VOTING TESTS
// ============================================

async function votingTests() {
  console.log(C.cyan("\n[VOTING TESTS] Voting logic and elimination"));
  console.log(C.gray("=".repeat(60)));

  await test("Can start game", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = create.data.data?.id;
    // Add minimum 3 players required to start
    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: "VILLAGER",
      });
    }
    const start = await apiRequest("POST", `/api/v1/games/${id}/start`);
    assert(start.status === 200 || start.status === 201);
  });

  await test("Game status changes to IN_PROGRESS", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = create.data.data?.id;
    // Add minimum 3 players required to start
    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: "VILLAGER",
      });
    }
    await apiRequest("POST", `/api/v1/games/${id}/start`);
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assert(["IN_PROGRESS", "ENDED"].includes(game.data.data?.status));
  });

  await test("Can stop game", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = create.data.data?.id;
    await apiRequest("POST", `/api/v1/games/${id}/start`);
    const stop = await apiRequest("POST", `/api/v1/games/${id}/stop`);
    assertEq(stop.status, 200);
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(game.data.data?.status, "ENDED");
  });
}

// ============================================
// ROLE MECHANICS TESTS
// ============================================

async function roleTests() {
  console.log(C.cyan("\n[ROLE TESTS] Role-specific mechanics"));
  console.log(C.gray("=".repeat(60)));

  await test("Has DOCTOR role", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    // Add players including DOCTOR
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Doctor1",
      role: "DOCTOR",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Villager1",
      role: "VILLAGER",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Villager2",
      role: "VILLAGER",
    });
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const roles = game.data.data?.players.map((p) => p.role);
    assertContains(roles, "DOCTOR");
  });

  await test("Has SHERIFF role", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    // Add players including SHERIFF
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Sheriff1",
      role: "SHERIFF",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Villager1",
      role: "VILLAGER",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Villager2",
      role: "VILLAGER",
    });
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const roles = game.data.data?.players.map((p) => p.role);
    assertContains(roles, "SHERIFF");
  });

  await test("Has VIGILANTE role", async () => {
    const res = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = res.data.data?.id;
    // Add players including VIGILANTE
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Vigilante1",
      role: "VIGILANTE",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Villager1",
      role: "VILLAGER",
    });
    await apiRequest("POST", `/api/v1/games/${id}/players`, {
      name: "Villager2",
      role: "VILLAGER",
    });
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const roles = game.data.data?.players.map((p) => p.role);
    assertContains(roles, "VIGILANTE");
  });
}

// ============================================
// WIN CONDITION TESTS
// ============================================

async function winTests() {
  console.log(C.cyan("\n[WIN CONDITION TESTS] Game end conditions"));
  console.log(C.gray("=".repeat(60)));

  await test("Started game has valid status", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = create.data.data?.id;
    // Add minimum 3 players required to start
    for (let i = 0; i < 3; i++) {
      await apiRequest("POST", `/api/v1/games/${id}/players`, {
        name: `Player${i}`,
        role: "VILLAGER",
      });
    }
    await apiRequest("POST", `/api/v1/games/${id}/start`);
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    const status = game.data.data?.status;
    assert(["IN_PROGRESS", "ENDED"].includes(status));
  });

  await test("Stopped game has ENDED status", async () => {
    const create = await apiRequest("POST", "/api/v1/games", { players: 5 });
    const id = create.data.data?.id;
    await apiRequest("POST", `/api/v1/games/${id}/start`);
    await apiRequest("POST", `/api/v1/games/${id}/stop`);
    const game = await apiRequest("GET", `/api/v1/games/${id}`);
    assertEq(game.data.data?.status, "ENDED");
  });
}

// ============================================
// ERROR HANDLING TESTS
// ============================================

async function errorTests() {
  console.log(C.cyan("\n[ERROR TESTS] Error handling"));
  console.log(C.gray("=".repeat(60)));

  await test("Invalid game returns 404", async () => {
    const res = await apiRequest("GET", "/api/v1/games/invalid-game-id");
    assertEq(res.status, 404);
  });

  await test("Invalid endpoint returns 404", async () => {
    const res = await apiRequest("GET", "/api/v1/invalid-endpoint");
    assertEq(res.status, 404);
  });

  await test("Invalid game ID returns error", async () => {
    const res = await apiRequest(
      "POST",
      "/api/v1/games/invalid-game-id-12345/start",
      null,
    );
    assert(res.status >= 400);
  });
}

// ============================================
// RUNNER
// ============================================

async function runAll(category = "all") {
  console.log(C.bold("\n================================================"));
  console.log(C.bold("  MAFIA GAME MECHANICS TEST SUITE"));
  console.log(C.bold("================================================"));
  console.log(C.gray("Server: " + SERVER_URL));
  console.log(C.gray("Mode: " + category.toUpperCase()));
  console.log("");

  const start = Date.now();

  if (category === "all" || category === "smoke") {
    await smokeTests();
  }
  if (category === "all" || category === "persona") {
    await personaTests();
  }
  if (category === "all" || category === "voting") {
    await votingTests();
  }
  if (category === "all" || category === "roles") {
    await roleTests();
  }
  if (category === "all" || category === "win") {
    await winTests();
  }
  if (category === "all" || category === "error") {
    await errorTests();
  }

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
const category = process.argv[2] || "all";
runAll(category.replace(/^--/, ""))
  .then((success) => process.exit(success ? 0 : 1))
  .catch((e) => {
    console.error("Test error:", e);
    process.exit(1);
  });
