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

// MAF-GAP-042: keep the JSON event stream parseable. The legacy engine logs
// banners/turn lines via console.log and, when pino is present, its
// structured-logging IIFE emits pino JSON — BOTH write to stdout, which the
// adapter treats as the JSON event stream ("Non-JSON output from bridge" /
// "Unknown message type: undefined" noise). Before loading the engine:
//  1. force LOG_STRUCTURED=false so the pino JSON path never activates, and
//  2. redirect console.log to stderr so raw engine chatter never reaches
//     stdout. emit() writes directly via process.stdout.write, so the event
//     stream is unaffected. console.warn/error already go to stderr.
process.env.LOG_STRUCTURED = 'false';
console.log = console.error.bind(console);

// Load the legacy game engine
// The game engine is at the project root: games/legacy/game-engine.js
const gameEnginePath = path.resolve(__dirname, '..', '..', '..', '..', 'game-engine.js');
const { MafiaGame } = require(gameEnginePath);

// Real per-model usage collection (tokens/cost/latency) from the engine's
// in-memory trackers — extracted to its own module so it is unit-testable
// (MAF-GAP-012 / MAF-GAP-018).
const { collectUsage, collectUsageByPlayer } = require('./legacy-usage-collector.js');

function emit(type, data) {
  process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  let numPlayers = 5;
  let personaSeeds = null;
  let gameConfig = {};
  // DF-MAFIA-AI-BENCHMARK-2: the ADAPTER's game id (the key the adapter
  // persists player_model_assignments under). Passed to collectUsage so
  // the config-derived fallback reads the game's real rows instead of
  // this process's (sanitized) env vars.
  let adapterGameId = null;
  
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
    } else if (args[i] === '--game-id' && args[i + 1]) {
      adapterGameId = args[++i];
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

        // MAF-GAP-013: the legacy engine never emits a full role-assignment
        // event, so players who never act and never die (plain villagers)
        // surface as UNASSIGNED in the API. Emit one final synthetic
        // ROLES_ASSIGNED event carrying the full roster; the adapter's
        // extractPlayersFromEvents uses first-write-wins, so this fills only
        // the UNASSIGNED gaps.
        if (game.players && game.players.length > 0) {
          emit('event', {
            gameId: game.gameId,
            round: 0,
            phase: 'GAME_OVER',
            eventType: 'ROLES_ASSIGNED',
            playerId: null,
            playerName: null,
            timestamp: new Date().toISOString(),
            content: {
              assignments: game.players.map((p) => ({
                playerId: p.id,
                name: p.name,
                role: p.role || p.persona?.gameRole || 'UNASSIGNED',
                isMafia: !!p.isMafia,
              })),
            },
            visibility: 'ADMIN_ONLY',
          });
        }
        
        // MAF-GAP-029: real per-player usage (which LLM played which
        // player) alongside the per-model aggregates. Best-effort — a
        // failure here must never break the done message.
        let usageByPlayer = [];
        try {
          usageByPlayer = await collectUsageByPlayer(game);
        } catch (usageByPlayerError) {
          console.error('collectUsageByPlayer failed: ' + (usageByPlayerError && usageByPlayerError.message));
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
          usage: await collectUsage(game, adapterGameId),
          // MAF-GAP-029: real per-player usage aggregates (same trackers,
          // per-player dimension kept).
          usageByPlayer,
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
