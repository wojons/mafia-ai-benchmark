/**
 * Mafia AI Benchmark - Production Server
 *
 * Full-featured HTTP/WebSocket server with game engine integration.
 *
 * Run with: node apps/server/dist/index.js
 * Or for development: cd apps/server && pnpm dev
 */

import http from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import Game Engine (portable - no hardcoded paths)
let ServerGameEngine = null;
try {
  const { ServerGameEngine: SGE } =
    await import("./services/server-game-engine.js");
  ServerGameEngine = SGE;
  console.log("✅ ServerGameEngine loaded successfully");
} catch (e) {
  console.log("ℹ️  Game engine not loaded:", e.message);
  console.log("   Running in demo mode (no game execution)");
}

// Configuration
const PORT = parseInt(process.env.PORT || "3000");
const DATA_DIR = process.env.DATA_DIR || "./data";

// In-memory storage (replace with SQLite for production)
const games = new Map();
const playerModels = new Map();
const roleModels = new Map();
const sseConnections = new Map();
let playerIdCounter = 0;

// Generate unique player ID
function generatePlayerId() {
  playerIdCounter++;
  return `p${Date.now()}${playerIdCounter}`;
}

// Game engine instance
let gameEngine = null;

// Initialize game engine if available
if (ServerGameEngine) {
  gameEngine = new ServerGameEngine({
    games,
    sseConnections,
  });
  console.log("✅ Game engine loaded");
}

// Fallback pricing for common models
const FALLBACK_PRICING = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "claude-sonnet-4-20250514": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-haiku-4-20250514": { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  "gemini-2.5-flash-exp": { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  "gemini-2.5-pro-exp": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  "deepseek-chat": { inputPerMillion: 0.28, outputPerMillion: 0.42 },
};

// ==================== HELPERS ====================

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res, status, code, message) {
  sendJSON(res, status, {
    success: false,
    error: { code, message },
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function broadcastSSE(gameId, event) {
  const connections = sseConnections.get(gameId);
  if (!connections) return;

  const data = `data: ${JSON.stringify({
    ...event,
    gameId,
    timestamp: new Date().toISOString(),
  })}\n\n`;

  for (const client of connections) {
    try {
      client.write(data);
    } catch {
      connections.delete(client);
    }
  }
}

// ==================== ROUTES ====================

// Health check
async function handleHealth(req, res) {
  sendJSON(res, 200, {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

// API info
async function handleAPIInfo(req, res) {
  sendJSON(res, 200, {
    version: "1.0.0",
    name: "Mafia AI Benchmark API",
    endpoints: [
      "GET  /health",
      "GET  /api/v1",
      "GET  /api/v1/games",
      "POST /api/v1/games",
      "GET  /api/v1/games/:id",
      "POST /api/v1/games/:id/start",
      "POST /api/v1/games/:id/stop",
      "GET  /api/v1/games/:id/players",
      "POST /api/v1/games/:id/players",
      "POST /api/v1/games/:id/players/:idx/model",
      "POST /api/v1/games/:id/role/:role/model",
      "POST /api/v1/games/:id/models/bulk",
      "GET  /api/v1/models/pricing?model=",
      "POST /api/v1/models/calculate-cost",
      "GET  /api/v1/models",
      "GET  /api/v1/stats",
      "GET  /api/v1/games/:id/events (SSE)",
      "GET  /api/v1/games/:id/sse-status",
    ],
  });
}

// List games
async function handleListGames(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");

  let gameList = Array.from(games.values());

  if (status) {
    gameList = gameList.filter((g) => g.status === status);
  }

  sendJSON(res, 200, {
    success: true,
    data: gameList.map((g) => ({
      id: g.id,
      status: g.status,
      createdAt: g.createdAt,
      config: g.config,
      players: g.players || [],
    })),
  });
}

// Create game
async function handleCreateGame(req, res) {
  try {
    const body = await parseBody(req);
    const gameId = body.gameId || `game-${Date.now()}`;
    const config = body.config || { players: body.players || 5 };

    if (games.has(gameId)) {
      return sendError(res, 409, "GAME_EXISTS", "Game already exists");
    }

    const game = {
      id: gameId,
      status: "SETUP",
      createdAt: new Date().toISOString(),
      config,
      players: [],
      events: [],
    };

    games.set(gameId, game);

    // Broadcast creation event
    broadcastSSE(gameId, { type: "game_created", gameId });

    sendJSON(res, 201, {
      success: true,
      data: {
        id: gameId,
        status: "SETUP",
        createdAt: game.createdAt,
        config,
        players: [],
      },
    });
  } catch (error) {
    if (error.message === "Invalid JSON") {
      sendError(res, 400, "INVALID_REQUEST", "Invalid JSON body");
    } else {
      sendError(res, 500, "INTERNAL_ERROR", error.message);
    }
  }
}

// Get game
async function handleGetGame(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  sendJSON(res, 200, {
    success: true,
    data: {
      id: game.id,
      status: game.status,
      createdAt: game.createdAt,
      config: game.config,
      players: game.players || [],
    },
  });
}

// Start game
async function handleStartGame(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  if (game.status !== "SETUP") {
    return sendError(res, 400, "INVALID_STATE", "Game already started");
  }

  if (!game.players || game.players.length < 3) {
    return sendError(res, 400, "INVALID_STATE", "Need at least 3 players");
  }

  // Check if game engine is available
  if (gameEngine) {
    // Run the actual game engine
    game.status = "IN_PROGRESS";
    game.startedAt = new Date().toISOString();

    // Broadcast start event
    broadcastSSE(gameId, { type: "game_started", gameId, phase: "NIGHT" });

    // Start the game asynchronously (it will run through all phases)
    gameEngine.startGame(gameId).catch((error) => {
      console.error(`Game ${gameId} error:`, error);
      game.status = "ERROR";
      broadcastSSE(gameId, {
        type: "game_error",
        gameId,
        error: error.message,
      });
    });

    sendJSON(res, 200, {
      success: true,
      data: {
        id: gameId,
        status: "IN_PROGRESS",
        message:
          "Game started! Watch via SSE at /api/v1/games/" + gameId + "/events",
      },
    });
  } else {
    // Demo mode - just change status
    game.status = "IN_PROGRESS";
    game.startedAt = new Date().toISOString();

    broadcastSSE(gameId, { type: "game_started", gameId, phase: "NIGHT" });
    broadcastSSE(gameId, { type: "game_phase_change", gameId, phase: "NIGHT" });

    // Send demo events
    setTimeout(() => {
      broadcastSSE(gameId, {
        type: "mafia_action",
        gameId,
        action: "discussing",
        message: "Mafia is planning...",
      });
    }, 2000);

    setTimeout(() => {
      broadcastSSE(gameId, { type: "night_resolved", gameId, deaths: [] });
      broadcastSSE(gameId, { type: "day_started", gameId, round: 1 });
    }, 4000);

    sendJSON(res, 200, {
      success: true,
      data: { id: gameId, status: "IN_PROGRESS" },
      note: "Demo mode - game engine not loaded",
    });
  }
}

// Stop game
async function handleStopGame(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  game.status = "ENDED";
  game.endedAt = new Date().toISOString();

  broadcastSSE(gameId, { type: "game_ended", gameId, reason: "stopped" });

  sendJSON(res, 200, {
    success: true,
    data: { id: gameId, status: "ENDED" },
  });
}

// List players
async function handleListPlayers(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  sendJSON(res, 200, {
    success: true,
    data: game.players || [],
  });
}

// Add player
async function handleAddPlayer(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  try {
    const body = await parseBody(req);
    const playerId = generatePlayerId();
    const player = {
      id: playerId,
      name: body.name || `Player ${game.players.length + 1}`,
      role: body.role || "VILLAGER",
      joinOrder: game.players.length,
      isAlive: true,
    };

    game.players.push(player);

    broadcastSSE(gameId, {
      type: "player_joined",
      gameId,
      playerId,
      name: player.name,
    });

    sendJSON(res, 201, {
      success: true,
      data: player,
    });
  } catch (error) {
    sendError(res, 400, "INVALID_REQUEST", "Invalid player data");
  }
}

// Set player model
async function handleSetPlayerModel(req, res, [gameId, playerIndex]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  try {
    const body = await parseBody(req);
    const { provider, model, temperature, maxTokens } = body;

    if (!provider || !model) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "provider and model required",
      );
    }

    // Validate provider
    const validProviders = [
      "openai",
      "anthropic",
      "google",
      "deepseek",
      "groq",
      "meta",
      "qwen",
      "xai",
    ];
    if (!validProviders.includes(provider.toLowerCase())) {
      return sendError(
        res,
        400,
        "INVALID_MODEL",
        `Invalid provider: ${provider}`,
      );
    }

    // Check if model exists in pricing or fallback
    if (!FALLBACK_PRICING[model] && !model.includes("-")) {
      return sendError(res, 400, "INVALID_MODEL", `Unknown model: ${model}`);
    }

    const key = `${gameId}:${playerIndex}`;
    playerModels.set(key, { provider, model, temperature, maxTokens });

    broadcastSSE(gameId, {
      type: "player_model_set",
      gameId,
      playerIndex: parseInt(playerIndex),
      provider,
      model,
    });

    sendJSON(res, 201, {
      success: true,
      data: {
        message: "Player model assignment saved",
        gameId,
        playerIndex: parseInt(playerIndex),
        provider,
        model,
      },
    });
  } catch (error) {
    if (error.message === "Invalid JSON") {
      return sendError(res, 400, "INVALID_REQUEST", "Invalid JSON body");
    }
    sendError(res, 500, "INTERNAL_ERROR", error.message);
  }
}

// Set role model
async function handleSetRoleModel(req, res, [gameId, role]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  try {
    const body = await parseBody(req);
    const { provider, model, temperature, maxTokens } = body;

    if (!provider || !model) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "provider and model required",
      );
    }

    const key = `${gameId}:${role}`;
    roleModels.set(key, { provider, model, temperature, maxTokens });

    broadcastSSE(gameId, {
      type: "role_model_set",
      gameId,
      role,
      provider,
      model,
    });

    sendJSON(res, 201, {
      success: true,
      data: {
        message: `Role model saved for ${role}`,
        gameId,
        role,
        provider,
        model,
      },
    });
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", error.message);
  }
}

// Bulk model configuration
async function handleBulkModels(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  try {
    const body = await parseBody(req);
    const { assignments } = body;

    if (!assignments || !Array.isArray(assignments)) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "assignments array required",
      );
    }

    let count = 0;
    for (const a of assignments) {
      if (a.type === "player") {
        const key = `${gameId}:${a.index}`;
        playerModels.set(key, { provider: a.provider, model: a.model });
        count++;
      } else if (a.type === "role") {
        const key = `${gameId}:${a.role}`;
        roleModels.set(key, { provider: a.provider, model: a.model });
        count++;
      }
    }

    broadcastSSE(gameId, {
      type: "models_bulk_updated",
      gameId,
      count,
    });

    sendJSON(res, 201, {
      success: true,
      data: {
        message: `${count} models saved`,
        gameId,
        count,
      },
    });
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", error.message);
  }
}

// Model pricing
async function handleModelPricing(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const modelId = url.searchParams.get("model");

  if (!modelId) {
    return sendJSON(res, 200, {
      success: true,
      data: {
        message: "Use ?model= to get specific model pricing",
        example: "/api/v1/models/pricing?model=gpt-4o-mini",
        fallbackModels: Object.keys(FALLBACK_PRICING),
        noPricingMarker: -6.66,
      },
    });
  }

  // Check fallback pricing
  if (FALLBACK_PRICING[modelId]) {
    return sendJSON(res, 200, {
      success: true,
      data: {
        modelId,
        ...FALLBACK_PRICING[modelId],
        hasPricing: true,
        isMissingPricing: false,
        source: "fallback",
      },
    });
  }

  // Return no pricing for unknown models
  sendJSON(res, 200, {
    success: true,
    data: {
      modelId,
      inputPerMillion: -6.66,
      outputPerMillion: -6.66,
      hasPricing: false,
      isMissingPricing: true,
      noPricingMarker: -6.66,
    },
  });
}

// Calculate cost
async function handleCalculateCost(req, res) {
  try {
    const body = await parseBody(req);
    const { modelId, inputTokens, outputTokens } = body;

    if (!modelId || !inputTokens || !outputTokens) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "modelId, inputTokens, outputTokens required",
      );
    }

    let inputPerMillion = -6.66;
    let outputPerMillion = -6.66;
    let source = "none";

    if (FALLBACK_PRICING[modelId]) {
      const p = FALLBACK_PRICING[modelId];
      inputPerMillion = p.inputPerMillion;
      outputPerMillion = p.outputPerMillion;
      source = "fallback";
    }

    const hasPricing = source === "fallback";
    const inputCost = (inputTokens / 1_000_000) * inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * outputPerMillion;
    const totalCost = inputCost + outputCost;
    const costPerMillion = inputPerMillion + outputPerMillion;

    const formatted =
      totalCost < 0.01
        ? `$${(totalCost * 1000).toFixed(4)}`
        : `$${totalCost.toFixed(4)}`;

    sendJSON(res, 200, {
      success: true,
      data: {
        modelId,
        inputTokens,
        outputTokens,
        costPerMillion,
        totalCost,
        formatted,
        hasPricing,
        pricingSource: source,
      },
    });
  } catch (error) {
    if (error.message === "Invalid JSON") {
      return sendError(res, 400, "INVALID_REQUEST", "Invalid JSON body");
    }
    sendError(res, 500, "INTERNAL_ERROR", error.message);
  }
}

// List models
async function handleListModels(req, res) {
  const models = Object.keys(FALLBACK_PRICING).map((id) => ({
    id,
    inputPerMillion: FALLBACK_PRICING[id].inputPerMillion,
    outputPerMillion: FALLBACK_PRICING[id].outputPerMillion,
    provider: "multiple",
  }));

  sendJSON(res, 200, {
    success: true,
    data: models,
  });
}

// Game stats
async function handleGameStats(req, res, [gameId]) {
  const game = games.get(gameId);

  if (!game) {
    return sendError(res, 404, "GAME_NOT_FOUND", "Game not found");
  }

  sendJSON(res, 200, {
    success: true,
    data: {
      gameId,
      status: game.status,
      playersCount: game.players?.length || 0,
      eventsCount: game.events?.length || 0,
      duration: game.startedAt
        ? Date.now() - new Date(game.startedAt).getTime()
        : 0,
    },
  });
}

// Server stats
async function handleStats(req, res) {
  sendJSON(res, 200, {
    success: true,
    data: {
      gamesCount: games.size,
      playersCount: Array.from(games.values()).reduce(
        (sum, g) => sum + (g.players?.length || 0),
        0,
      ),
      activeConnections: Array.from(sseConnections.values()).reduce(
        (sum, s) => sum + s.size,
        0,
      ),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      gameEngine: gameEngine ? "loaded" : "demo",
    },
  });
}

// Game Engine Status
async function handleGameEngineStatus(req, res, [gameId]) {
  if (!gameEngine) {
    return sendError(
      res,
      503,
      "GAME_ENGINE_NOT_LOADED",
      "Game engine is not available",
    );
  }

  const status = gameEngine.getGameStatus(gameId);
  sendJSON(res, 200, {
    success: true,
    data: status,
  });
}

// SSE Events
async function handleSSEEvents(req, res, [gameId]) {
  const game = games.get(gameId);

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send connected event
  res.write(
    `data: ${JSON.stringify({ type: "connected", gameId, timestamp: new Date().toISOString() })}\n\n`,
  );

  // Add to connections
  if (!sseConnections.has(gameId)) {
    sseConnections.set(gameId, new Set());
  }
  sseConnections.get(gameId).add(res);

  // Check if game engine is active for this game
  const isGameEngineActive = gameEngine && gameEngine.activeGames?.has(gameId);

  // Only send demo events if game engine is NOT active
  if (!isGameEngineActive && game?.status === "IN_PROGRESS") {
    setTimeout(() => {
      if (!res.destroyed) {
        res.write(
          `data: ${JSON.stringify({ type: "game_phase_change", gameId, phase: "NIGHT", timestamp: new Date().toISOString() })}\n\n`,
        );
      }
    }, 1000);

    setTimeout(() => {
      if (!res.destroyed) {
        res.write(
          `data: ${JSON.stringify({ type: "player_action", gameId, playerId: "p1", action: "VOTE", targetId: "p3", timestamp: new Date().toISOString() })}\n\n`,
        );
      }
    }, 3000);
  }

  // Keepalive
  const keepAlive = setInterval(() => {
    if (!res.destroyed) res.write(`: keepalive\n\n`);
  }, 30000);

  // Cleanup on close
  req.on("close", () => {
    clearInterval(keepAlive);
    sseConnections.get(gameId)?.delete(res);
    if (sseConnections.get(gameId)?.size === 0) {
      sseConnections.delete(gameId);
    }
  });
}

// SSE Status
async function handleSSEStatus(req, res, [gameId]) {
  sendJSON(res, 200, {
    success: true,
    data: {
      gameId,
      activeConnections: sseConnections.get(gameId)?.size || 0,
      isStreaming: (sseConnections.get(gameId)?.size || 0) > 0,
    },
  });
}

// ==================== ROUTER ====================

const routes = {
  GET: {
    "/health": handleHealth,
    "/api/v1": handleAPIInfo,
    "/api/v1/games": handleListGames,
    "/api/v1/models/pricing": handleModelPricing,
    "/api/v1/models": handleListModels,
    "/api/v1/stats": handleStats,
  },
  POST: {
    "/api/v1/games": handleCreateGame,
    "/api/v1/models/calculate-cost": handleCalculateCost,
  },
};

// Parameterized routes
const paramRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/games\/([^/]+)$/,
    handler: handleGetGame,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/games\/([^/]+)\/start$/,
    handler: handleStartGame,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/games\/([^/]+)\/stop$/,
    handler: handleStopGame,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/games\/([^/]+)\/players$/,
    handler: handleListPlayers,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/games\/([^/]+)\/players$/,
    handler: handleAddPlayer,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/games\/([^/]+)\/players\/([^/]+)\/model$/,
    handler: handleSetPlayerModel,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/games\/([^/]+)\/role\/([^/]+)\/model$/,
    handler: handleSetRoleModel,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/games\/([^/]+)\/models\/bulk$/,
    handler: handleBulkModels,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/games\/([^/]+)\/events$/,
    handler: handleSSEEvents,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/games\/([^/]+)\/sse-status$/,
    handler: handleSSEStatus,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/games\/([^/]+)\/stats$/,
    handler: handleGameStats,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/games\/([^/]+)\/engine-status$/,
    handler: handleGameEngineStatus,
  },
];

// ==================== SERVER ====================

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
  const method = req.method || "GET";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Try exact match
  const exactHandler = routes[method]?.[pathname];
  if (exactHandler) {
    await exactHandler(req, res);
    return;
  }

  // Try parameterized routes
  for (const route of paramRoutes) {
    if (route.method === method) {
      const match = pathname.match(route.pattern);
      if (match) {
        await route.handler(req, res, match.slice(1));
        return;
      }
    }
  }

  // 404
  sendError(res, 404, "NOT_FOUND", `Route ${method} ${pathname} not found`);
});

// Start server
server.listen(PORT, () => {
  console.log("");
  console.log("🎮 Mafia AI Benchmark - Production Server");
  console.log("==========================================");
  console.log(`✅ HTTP Server running on port ${PORT}`);
  console.log(`📡 WebSocket available on ws://localhost:${PORT}/ws`);
  console.log(`🎮 Game Engine: ${gameEngine ? "✅ Loaded" : "⚠️  Demo mode"}`);
  console.log("");
  console.log("📋 Available endpoints:");
  console.log(`   GET  /health                              Health check`);
  console.log(`   GET  /api/v1                              API info`);
  console.log(`   GET  /api/v1/games                        List games`);
  console.log(`   POST /api/v1/games                        Create game`);
  console.log(`   GET  /api/v1/games/:id                    Get game`);
  console.log(`   POST /api/v1/games/:id/start              Start game`);
  console.log(`   POST /api/v1/games/:id/stop               Stop game`);
  console.log(`   GET  /api/v1/games/:id/players            List players`);
  console.log(`   POST /api/v1/games/:id/players            Add player`);
  console.log(`   POST /api/v1/games/:id/players/:idx/model Set player model`);
  console.log(`   POST /api/v1/games/:id/role/:role/model   Set role model`);
  console.log(`   POST /api/v1/games/:id/models/bulk        Bulk configure`);
  console.log(`   GET  /api/v1/models/pricing?model=        Model pricing`);
  console.log(`   POST /api/v1/models/calculate-cost        Calculate cost`);
  console.log(`   GET  /api/v1/models                       List models`);
  console.log(`   GET  /api/v1/stats                        Server stats`);
  console.log(`   GET  /api/v1/games/:id/events (SSE)       SSE events`);
  console.log(`   GET  /api/v1/games/:id/sse-status         SSE status`);
  console.log(
    `   GET  /api/v1/games/:id/engine-status      Game engine status`,
  );
  console.log("");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  server.close(() => process.exit(0));
});
