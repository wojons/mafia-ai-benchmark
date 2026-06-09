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
const dotenvPath = path.resolve(__dirname, '..', '..', '.env');
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

// Load the legacy game engine
// The game engine is at the project root, two levels up from services/
const gameEnginePath = path.resolve(__dirname, '..', '..', 'game-engine.js');
const { MafiaGame } = require(gameEnginePath);

function emit(type, data) {
  process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
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
          timestamp: new Date().toISOString()
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
