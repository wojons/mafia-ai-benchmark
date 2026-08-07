#!/usr/bin/env node
/**
 * Legacy Game Engine Bridge
 * 
 * Wraps the legacy MafiaGame engine and outputs JSON events to stdout.
 * Each event is printed as a JSON line prefixed with "EVENT:".
 * Game completion is signaled with "DONE:" JSON.
 * 
 * Usage: node legacy-bridge.js [--players N] [--seeds seed1,seed2,...]
 */

const path = require('path');

// Load environment variables from the workspace .env
const dotenvPath = path.resolve(__dirname, '..', '..', '..', '..', '.env');
try {
  require('dotenv').config({ path: dotenvPath });
} catch (e) {
  // dotenv may not be available, try workspace root
  try {
    require('dotenv').config();
  } catch (e2) {
    // Continue without dotenv
  }
}

// Ensure console.setGameContext exists before loading engine
// (game-engine.js sets it up only when pino is available)
if (typeof console.setGameContext !== 'function') {
  console.setGameContext = function(ctx) { /* no-op in bridge mode */ };
}

// Load the legacy game engine
// The game engine is at the project root: games/legacy/game-engine.js
const gameEnginePath = path.resolve(__dirname, '..', '..', '..', '..', 'game-engine.js');
const { MafiaGame } = require(gameEnginePath);

function emit(type, data) {
  process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
}

/**
 * Collect real per-model usage aggregates from the legacy engine's
 * in-memory trackers (MAF-GAP-012).
 *
 * The engine's CostTracker keeps per-model state (provider/model/turns/
 * cost/tokens) keyed by `${provider}:${model}`; the TokenTracker keeps
 * per-player metrics keyed by `${gameId}:${playerId}`. Both are populated
 * from actual OpenRouter/API responses during play. When the trackers are
 * unavailable (no DB, disabled), fall back to the role-model config from
 * the environment so the server still records which models played.
 *
 * Returns an array of per-model aggregates:
 *   [{ provider, model, promptTokens, completionTokens, totalTokens,
 *      cost, apiCalls, latencyMs }]
 */
async function collectUsage(game) {
  const usage = [];

  // 1. CostTracker per-model state (authoritative totals when present).
  //    The engine's CostTracker aggregates the same underlying API
  //    responses the TokenTracker sees, so its per-model rows are the
  //    source of truth for totalTokens/cost/apiCalls.
  if (game.costTracker && typeof game.costTracker.getCostReport === 'function') {
    try {
      const report = game.costTracker.getCostReport(game.gameId);
      if (report && Array.isArray(report.models)) {
        for (const m of report.models) {
          usage.push({
            provider: m.provider,
            model: m.model,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: m.totalTokens || 0,
            cost: m.totalCost || 0,
            apiCalls: m.totalTurns || 0,
            latencyMs: 0,
          });
        }
      }
    } catch (e) {
      // Fall through to token-tracker aggregation below.
    }
  }

  // 2. TokenTracker per-player metrics. When the CostTracker was present,
  //    use these ONLY to fill the prompt/completion split (the totals are
  //    the same data — adding them would double-count). When the CostTracker
  //    was absent, aggregate the metrics into per-model rows directly.
  if (game.tokenTracker && typeof game.tokenTracker.getGameMetrics === 'function') {
    try {
      const metrics = await game.tokenTracker.getGameMetrics(game.gameId);
      if (Array.isArray(metrics)) {
        const byModel = new Map();
        for (const m of usage) byModel.set(`${m.provider}:${m.model}`, m);
        for (const metric of metrics) {
          const key = `${metric.provider || 'unknown'}:${metric.model || 'unknown'}`;
          let row = byModel.get(key);
          if (!row) {
            row = {
              provider: metric.provider || 'unknown',
              model: metric.model || 'unknown',
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cost: 0,
              apiCalls: 0,
              latencyMs: 0,
            };
            byModel.set(key, row);
            usage.push(row);
          }
          row.promptTokens += metric.totalPromptTokens || 0;
          row.completionTokens += metric.totalCompletionTokens || 0;
          if (row.totalTokens === 0) row.totalTokens += metric.totalTokens || 0;
          if (row.cost === 0 && metric.estimatedCost && metric.estimatedCost.totalCost) {
            row.cost += metric.estimatedCost.totalCost;
          }
          if (row.apiCalls === 0) row.apiCalls += (metric.turns && metric.turns.length) || 0;
        }
      }
    } catch (e) {
      // Fall through to config-derived rows below.
    }
  }

  // 3. Config-derived fallback: role models from the environment. These
  //    carry no token/cost numbers (the engine did not track them), but
  //    they are the REAL models that played, so the server can record
  //    per-model rows with zero usage instead of nothing.
  if (usage.length === 0) {
    const roleModels = {
      MAFIA: process.env.MAFIA_MODEL,
      DOCTOR: process.env.DOCTOR_MODEL,
      SHERIFF: process.env.SHERIFF_MODEL,
      VIGILANTE: process.env.VIGILANTE_MODEL,
      VILLAGER: process.env.VILLAGER_MODEL,
    };
    const seen = new Set();
    for (const model of Object.values(roleModels)) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const [provider, modelName] = model.split('/');
      usage.push({
        provider: provider || 'openai',
        model: modelName || model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        apiCalls: 0,
        latencyMs: 0,
      });
    }
  }

  return usage;
}

async function main() {
  const args = process.argv.slice(2);
  
  let numPlayers = 5;
  let personaSeeds = null;
  let gameConfig = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--players' && args[i + 1]) {
      numPlayers = parseInt(args[++i], 10);
    } else if (args[i] === '--seeds' && args[i + 1]) {
      personaSeeds = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--config' && args[i + 1]) {
      try {
        gameConfig = JSON.parse(args[++i]);
      } catch (e) {
        emit('error', { message: 'Invalid JSON config: ' + e.message });
        process.exit(1);
      }
    }
  }
  
  emit('info', { 
    message: 'Legacy bridge starting',
    numPlayers,
    hasSeeds: !!personaSeeds,
    config: gameConfig,
    timestamp: new Date().toISOString()
  });
  
  try {
    const game = new MafiaGame(gameConfig);
    
    // Emit game ID once created
    const originalStartGame = game.startGame.bind(game);
    game.startGame = async function(nPlayers, seeds) {
      // Intercept gameEvents.push to capture events as they happen
      const originalPush = Array.prototype.push;
      const eventsArray = [];
      
      // We'll use a polling approach to detect new events
      const eventInterval = setInterval(() => {
        // The legacy engine pushes to this.gameEvents directly
        if (game.gameEvents && game.gameEvents.length > eventsArray.length) {
          const newEvents = game.gameEvents.slice(eventsArray.length);
          for (const event of newEvents) {
            emit('event', {
              gameId: game.gameId,
              round: event.round,
              phase: event.phase,
              eventType: event.eventType,
              playerId: event.playerId,
              playerName: event.playerName,
              timestamp: event.timestamp,
              content: event.content,
              visibility: event.visibility,
            });
          }
          eventsArray.length = game.gameEvents.length;
        }
      }, 100);
      
      try {
        const result = await originalStartGame(nPlayers !== undefined ? nPlayers : numPlayers, seeds || personaSeeds);
        clearInterval(eventInterval);
        
        // Emit any remaining events
        if (game.gameEvents && game.gameEvents.length > eventsArray.length) {
          const remaining = game.gameEvents.slice(eventsArray.length);
          for (const event of remaining) {
            emit('event', {
              gameId: game.gameId,
              round: event.round,
              phase: event.phase,
              eventType: event.eventType,
              playerId: event.playerId,
              playerName: event.playerName,
              timestamp: event.timestamp,
              content: event.content,
              visibility: event.visibility,
            });
          }
        }
        
        emit('done', {
          gameId: game.gameId,
          totalEvents: game.gameEvents ? game.gameEvents.length : 0,
          status: 'completed',
          winner: game.winner || (game.gameEvents && game.gameEvents.length > 0 
            ? (game.gameEvents[game.gameEvents.length - 1].content?.winner || null)
            : null),
          mafiaAlive: game.mafiaAlive,
          townAlive: game.townAlive,
          timestamp: new Date().toISOString(),
          // MAF-GAP-012: real per-model usage aggregates from the engine's
          // in-memory trackers (populated from actual API responses).
          usage: await collectUsage(game),
        });
        
        return result;
      } catch (error) {
        clearInterval(eventInterval);
        emit('error', {
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        process.exit(1);
      }
    };
    
    // Start the game
    await game.startGame(numPlayers, personaSeeds);
    
  } catch (error) {
    emit('error', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    process.exit(1);
  }
}

main().catch(err => {
  emit('error', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  process.exit(1);
});
