/**
 * Server Game Engine Bridge
 * 
 * This module bridges the standalone game-engine.js with the production server.
 * It imports the MafiaGame class and connects it to:
 * - SSE for real-time event streaming
 * - Server game state management
 * - Stats collection
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';

// ============================================
// PORTABLE IMPORT STRATEGY
// ============================================
// Primary: Use import maps (Node 16+)
// Backup: Auto-detect git root (any Node version)
// ============================================

async function loadMafiaGame() {
  // STRATEGY 1: Try import maps first
  try {
    console.log('[GameEngineBridge] Loading via import maps...');
    const gameEngine = await import('#game-engine');
    const { createCostTracker } = await import('#shared/providers/cost-tracking.js');
    
    // Dynamically import PersonaGenerator for use in the wrapper
    const { PersonaGenerator } = await import('#shared/persona/persona-generator.js');
    
    return {
      MafiaGame: gameEngine.MafiaGame,
      createCostTracker,
      PersonaGenerator
    };
  } catch (importError) {
    console.log('[GameEngineBridge] Import maps failed, using fallback...');
    
    // STRATEGY 2: Fallback - find project root dynamically
    const __dirname = dirname(fileURLToPath(import.meta.url));
    
    // Find git repository root (works from any directory depth)
    function findProjectRoot(startDir) {
      let dir = startDir;
      while (dir !== '/' && dir !== dir.replace(/[\\/][^\\/]+$/, '')) {
        if (existsSync(join(dir, '.git'))) {
          return dir;
        }
        dir = dirname(dir);
      }
      
      // Last resort: check if we're already at a known location
      // Check if game-engine.js is nearby
      const checkPaths = [
        join(__dirname, 'game-engine.js'),
        join(__dirname, '..', 'game-engine.js'),
        join(__dirname, '../../', 'game-engine.js'),
        join(__dirname, '../../../', 'game-engine.js'),
        join(__dirname, '../../../../', 'game-engine.js'),
      ];
      
      for (const checkPath of checkPaths) {
        if (existsSync(checkPath)) {
          console.log(`[GameEngineBridge] Found game-engine at: ${checkPath}`);
          return dirname(checkPath);
        }
      }
      
      throw new Error('Could not find project root - no .git directory or game-engine.js found');
    }
    
    const PROJECT_ROOT = findProjectRoot(__dirname);
    console.log(`[GameEngineBridge] Project root: ${PROJECT_ROOT}`);
    
    // Create require for CommonJS modules
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    
    // Load modules
    const gameEngine = require(join(PROJECT_ROOT, 'game-engine.js'));
    const shared = require(join(PROJECT_ROOT, 'packages/shared/src/providers/cost-tracking.js'));
    const persona = require(join(PROJECT_ROOT, 'packages/shared/src/persona/persona-generator.js'));
    
    return {
      MafiaGame: gameEngine.MafiaGame,
      createCostTracker: shared.createCostTracker,
      PersonaGenerator: persona.PersonaGenerator
    };
  }
}

// Load modules asynchronously
let MafiaGame, createCostTracker, PersonaGenerator;

await loadMafiaGame()
  .then(modules => {
    MafiaGame = modules.MafiaGame;
    createCostTracker = modules.createCostTracker;
    PersonaGenerator = modules.PersonaGenerator;
  })
  .catch(error => {
    console.error('[GameEngineBridge] Failed to load game engine:', error);
    throw error;
  });

// Game state storage
const serverGameStates = new Map();

/**
 * Server-side game engine that wraps MafiaGame
 */
export class ServerGameEngine extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.activeGames = new Map();
    this.gameCostTrackers = new Map();
  }

  /**
   * Start a game using the game-engine.js logic
   */
  async startGame(gameId) {
    const game = this.server.games?.get(gameId);
    
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.status !== 'SETUP') {
      throw new Error('Game already started');
    }

    if (!game.players || game.players.length < 3) {
      throw new Error('Need at least 3 players');
    }

    // Update game status
    game.status = 'IN_PROGRESS';
    game.startedAt = new Date().toISOString();

    // Broadcast start event
    this.broadcast(gameId, {
      type: 'game_started',
      gameId,
      phase: 'NIGHT',
      timestamp: new Date().toISOString(),
    });

    // Create wrapped game engine
    const wrappedGame = new WrappedMafiaGame(gameId, game, this);
    this.activeGames.set(gameId, wrappedGame);

    // Start the actual game (this will run through all phases)
    try {
      await wrappedGame.start();
    } catch (error) {
      console.error(`Game ${gameId} error:`, error);
      this.endGame(gameId, 'error', error.message);
    }
  }

  /**
   * End the game
   */
  endGame(gameId, reason = 'completed', details = null) {
    const game = this.server.games?.get(gameId);
    if (game) {
      game.status = 'ENDED';
      game.endedAt = new Date().toISOString();
    }

    const wrappedGame = this.activeGames.get(gameId);
    if (wrappedGame) {
      this.broadcast(gameId, {
        type: 'game_ended',
        gameId,
        reason,
        details,
        timestamp: new Date().toISOString(),
      });
      this.activeGames.delete(gameId);
    }
  }

  /**
   * Broadcast event to all SSE clients
   */
  broadcast(gameId, event) {
    if (this.server.sseConnections) {
      const connections = this.server.sseConnections.get(gameId);
      if (connections) {
        const data = `data: ${JSON.stringify({
          ...event,
          gameId,
          timestamp: event.timestamp || new Date().toISOString(),
        })}\n\n`;
        
        for (const client of connections) {
          try {
            client.write(data);
          } catch {
            connections.delete(client);
          }
        }
      }
    }
  }

  /**
   * Get cost tracker for a game
   */
  getCostTracker(gameId) {
    if (!this.gameCostTrackers.has(gameId)) {
      if (!createCostTracker) {
        console.warn('[GameEngineBridge] createCostTracker not loaded');
        return null;
      }
      this.gameCostTrackers.set(gameId, createCostTracker(gameId, {
        warnThreshold: 0.50,
        maxCostPerGame: 10,
      }));
    }
    return this.gameCostTrackers.get(gameId);
  }

  /**
   * Get active game status
   */
  getGameStatus(gameId) {
    const wrappedGame = this.activeGames.get(gameId);
    const game = this.server.games?.get(gameId);
    
    return {
      gameId,
      isActive: !!wrappedGame,
      status: game?.status || 'UNKNOWN',
      currentPhase: wrappedGame?.currentPhase || null,
      round: wrappedGame?.round || 0,
    };
  }
}

/**
 * Wrapped MafiaGame that connects to server infrastructure
 */
class WrappedMafiaGame {
  constructor(gameId, game, serverEngine) {
    this.gameId = gameId;
    this.game = game;
    this.serverEngine = serverEngine;
    this.currentPhase = null;
    this.round = 0;
  }

  /**
   * Start the game - wraps MafiaGame.startGame
   */
  async start() {
    const originalPlayers = [...this.game.players];
    
    // Broadcast phase change
    this.broadcastPhase('NIGHT', 'Starting night phase...');
    
    // Broadcast start event
    this.serverEngine.broadcast(this.gameId, {
      type: 'game_phase_change',
      gameId: this.gameId,
      phase: 'NIGHT',
      timestamp: new Date().toISOString(),
    });
    
    // Generate personas
    if (!PersonaGenerator) {
      console.warn('[WrappedMafiaGame] PersonaGenerator not loaded, using mock players');
      await this.runNightPhaseSimulation();
      return;
    }
    
    const personaGenerator = new PersonaGenerator();
    const personas = await personaGenerator.generateGamePersonas(this.game.players.length);
    
    // Update game with personas
    this.game.players = personas.map((persona, index) => ({
      ...originalPlayers[index],
      id: persona.playerId,
      name: persona.name,
      role: persona.gameRole,
      isMafia: persona.gameRole === 'MAFIA',
      isAlive: true,
      persona,
    }));
    
    // Broadcast player assignments
    this.serverEngine.broadcast(this.gameId, {
      type: 'players_assigned',
      gameId: this.gameId,
      players: this.game.players.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
      })),
      timestamp: new Date().toISOString(),
    });
    
    // Run night phase (first)
    this.round = 1;
    await this.runNightPhaseSimulation();
  }

  /**
   * Run night phase (simulation for demo)
   */
  async runNightPhaseSimulation() {
    this.currentPhase = 'NIGHT';
    this.broadcastPhase('NIGHT', `Night ${this.round} begins`);
    
    // Get alive players
    const alivePlayers = this.game.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    
    // Broadcast mafia team
    if (aliveMafia.length > 0) {
      this.serverEngine.broadcast(this.gameId, {
        type: 'mafia_team_revealed',
        gameId: this.gameId,
        mafiaTeam: aliveMafia.map(p => p.id),
        timestamp: new Date().toISOString(),
      });
    }
    
    // Broadcast night actions
    this.serverEngine.broadcast(this.gameId, {
      type: 'night_actions',
      gameId: this.gameId,
      round: this.round,
      alivePlayers: alivePlayers.map(p => p.id),
      timestamp: new Date().toISOString(),
    });
    
    // Simulate some time passing
    await this.delay(2000);
    
    // Check if game should continue
    if (!this.serverEngine.activeGames.has(this.gameId)) {
      return; // Game was stopped
    }
    
    // Run day phase
    await this.runDayPhaseSimulation();
  }

  /**
   * Run day phase (simulation for demo)
   */
  async runDayPhaseSimulation() {
    this.currentPhase = 'DAY';
    this.broadcastPhase('DAY', `Day ${this.round} - Discussion begins`);
    
    // Get alive players
    const alivePlayers = this.game.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveTown = alivePlayers.filter(p => !p.isMafia);
    
    // Broadcast day start
    this.serverEngine.broadcast(this.gameId, {
      type: 'day_started',
      gameId: this.gameId,
      round: this.round,
      alivePlayers: alivePlayers.map(p => ({
        id: p.id,
        name: p.name,
        isAlive: true,
      })),
      deadPlayers: this.game.players.filter(p => !p.isAlive).map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
      })),
      timestamp: new Date().toISOString(),
    });
    
    // Simulate discussion
    await this.delay(3000);
    
    // Check win conditions
    if (aliveMafia.length === 0) {
      this.serverEngine.broadcast(this.gameId, {
        type: 'game_over',
        gameId: this.gameId,
        winner: 'TOWN',
        mafiaAlive: 0,
        townAlive: aliveTown.length,
        timestamp: new Date().toISOString(),
      });
      this.serverEngine.endGame(this.gameId, 'completed', { winner: 'TOWN' });
      return;
    }
    
    if (aliveMafia.length >= aliveTown.length) {
      this.serverEngine.broadcast(this.gameId, {
        type: 'game_over',
        gameId: this.gameId,
        winner: 'MAFIA',
        mafiaAlive: aliveMafia.length,
        townAlive: aliveTown.length,
        timestamp: new Date().toISOString(),
      });
      this.serverEngine.endGame(this.gameId, 'completed', { winner: 'MAFIA' });
      return;
    }
    
    // Simulate voting
    await this.simulateVotingSimulation(alivePlayers);
    
    // Continue to next night
    this.round++;
    await this.runNightPhaseSimulation();
  }

  /**
   * Simulate voting phase
   */
  async simulateVotingSimulation(alivePlayers) {
    this.currentPhase = 'VOTING';
    this.broadcastPhase('VOTING', 'Voting phase begins');
    
    // Simulate votes
    const votes = {};
    alivePlayers.forEach(player => {
      const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      votes[target.id] = (votes[target.id] || 0) + 1;
    });
    
    // Find winner
    let maxVotes = 0;
    let winnerId = null;
    for (const [playerId, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        winnerId = playerId;
      }
    }
    
    // Eliminate player if not tie
    if (winnerId && maxVotes > alivePlayers.length / 2) {
      const eliminated = this.game.players.find(p => p.id === winnerId);
      if (eliminated) {
        eliminated.isAlive = false;
        
        this.serverEngine.broadcast(this.gameId, {
          type: 'player_eliminated',
          gameId: this.gameId,
          playerId: eliminated.id,
          playerName: eliminated.name,
          role: eliminated.role,
          votes: maxVotes,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      this.serverEngine.broadcast(this.gameId, {
        type: 'vote_tie',
        gameId: this.gameId,
        votes,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Broadcast phase change
   */
  broadcastPhase(phase, message) {
    this.currentPhase = phase;
    this.serverEngine.broadcast(this.gameId, {
      type: 'phase_change',
      gameId: this.gameId,
      phase,
      round: this.round,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Helper: delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ServerGameEngine;
