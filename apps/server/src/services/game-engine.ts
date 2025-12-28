/**
 * Game Engine Service
 * 
 * Core game logic and state management.
 */

import { 
  Game, 
  GameState, 
  GamePhase, 
  GameEvent, 
  Player, 
  RoleType,
  GameConfig,
  Vote,
  NightAction
} from '@mafia/shared/types';
import { GameFSM, createGameFSM } from '@mafia/shared/fsm';
import { GameRepository } from '../db/repository.js';
import { AgentCoordinator } from './agent-coordinator.js';
import { EventBus } from './event-bus.js';
import { StatsCollector } from './stats-collector.js';
import { v4 as uuidv4 } from 'uuid';

export interface CreateGameOptions {
  config?: Partial<GameConfig>;
  hostName?: string;
}

export interface GameActionResult {
  success: boolean;
  event?: GameEvent;
  error?: string;
}

export class GameEngine {
  private gameRepository: GameRepository;
  private agentCoordinator: AgentCoordinator;
  private eventBus: EventBus;
  private statsCollector: StatsCollector;
  private activeGames: Map<string, GameFSM>;
  
  constructor(
    gameRepository: GameRepository,
    agentCoordinator: AgentCoordinator,
    eventBus: EventBus,
    statsCollector: StatsCollector
  ) {
    this.gameRepository = gameRepository;
    this.agentCoordinator = agentCoordinator;
    this.eventBus = eventBus;
    this.statsCollector = statsCollector;
    this.activeGames = new Map();
  }
  
  /**
   * Create a new game
   */
  createGame(options: CreateGameOptions = {}): Game {
    const config: GameConfig = {
      numPlayers: 10,
      roles: [
        { role: 'MAFIA', count: 3 },
        { role: 'DOCTOR', count: 1 },
        { role: 'SHERIFF', count: 1 },
        { role: 'VIGILANTE', count: 1 },
        { role: 'VILLAGER', count: 4 },
      ],
      nightPhaseDuration: 60,
      dayPhaseDuration: 120,
      votingDuration: 30,
      maxPlayers: 12,
      minPlayers: 5,
      allowSelfVote: false,
      tieBreaker: 'RANDOM',
      enable3D: false,
      enableVoice: false,
      logLevel: 'INFO',
      ...options.config,
    };
    
    const game = this.gameRepository.createGame(config);
    
    // Create FSM for the game
    const fsm = createGameFSM(game);
    this.activeGames.set(game.id, fsm);
    
    // Subscribe to state changes
    fsm.subscribe('stateChange', (event) => {
      this.handleStateChange(event);
    });
    
    console.log(`[GameEngine] Created game ${game.id}`);
    
    return game;
  }
  
  /**
   * Join a game
   */
  joinGame(gameId: string, playerName: string, agentConfig?: {
    agentId?: string;
    provider?: string;
    model?: string;
  }): GameActionResult {
    const game = this.gameRepository.getGame(gameId);
    
    if (!game) {
      return { success: false, error: 'Game not found' };
    }
    
    if (game.status !== 'SETUP') {
      return { success: false, error: 'Game is not in setup phase' };
    }
    
    if (game.players.length >= game.config.maxPlayers) {
      return { success: false, error: 'Game is full' };
    }
    
    // Check for duplicate names
    if (game.players.some(p => p.name === playerName)) {
      return { success: false, error: 'Player name already taken' };
    }
    
    const player = this.gameRepository.addPlayer(
      gameId, 
      playerName,
      agentConfig?.agentId,
      agentConfig?.provider,
      agentConfig?.model
    );
    
    const event = this.gameRepository.addEvent(gameId, {
      type: 'PLAYER_JOINED',
      visibility: 'PUBLIC',
      actorId: player.id,
      data: {
        playerId: player.id,
        name: playerName,
        joinOrder: player.joinOrder,
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: game.currentState.phase,
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    console.log(`[GameEngine] ${playerName} joined game ${gameId}`);
    
    return { success: true, event };
  }
  
  /**
   * Start a game
   */
  startGame(gameId: string): GameActionResult {
    const game = this.gameRepository.getGame(gameId);
    
    if (!game) {
      return { success: false, error: 'Game not found' };
    }
    
    if (game.status !== 'SETUP') {
      return { success: false, error: 'Game is already in progress' };
    }
    
    const alivePlayers = game.players.filter(p => p.isAlive);
    if (alivePlayers.length < game.config.minPlayers) {
      return { success: false, error: `Not enough players (minimum ${game.config.minPlayers})` };
    }
    
    // Assign roles
    this.assignRoles(gameId);
    
    // Update game status
    this.gameRepository.updateGameStatus(gameId, 'IN_PROGRESS');
    
    const event = this.gameRepository.addEvent(gameId, {
      type: 'GAME_STARTED',
      visibility: 'PUBLIC',
      data: {
        dayNumber: 1,
        turnNumber: 1,
        players: game.players.map(p => ({
          playerId: p.id,
          name: p.name,
          role: p.role,
        })),
      },
      metadata: {
        turnNumber: 1,
        dayNumber: 1,
        phase: 'SETUP',
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    console.log(`[GameEngine] Game ${gameId} started with ${game.players.length} players`);
    
    return { success: true, event };
  }
  
  /**
   * Assign roles to players
   */
  private assignRoles(gameId: string): void {
    const game = this.gameRepository.getGame(gameId);
    if (!game) return;
    
    const players = [...game.players];
    const roles: RoleType[] = [];
    
    // Build role list from config
    game.config.roles.forEach(rc => {
      for (let i = 0; i < rc.count; i++) {
        roles.push(rc.role);
      }
    });
    
    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    
    // Shuffle players
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
    
    // Assign roles
    const mafiaTeam: string[] = [];
    
    players.forEach((player, index) => {
      const role = roles[index] || 'VILLAGER';
      const isMafia = role === 'MAFIA';
      
      this.gameRepository.updatePlayerRole(player.id, role, isMafia);
      
      if (isMafia) {
        mafiaTeam.push(player.id);
      }
    });
    
    // Add role assignment event
    const assignments = players.map((player, index) => ({
      playerId: player.id,
      role: roles[index] || 'VILLAGER',
    }));
    
    this.gameRepository.addEvent(gameId, {
      type: 'ROLES_ASSIGNED',
      visibility: 'PRIVATE',
      data: {
        assignments,
        mafiaTeam,
      },
      metadata: {
        turnNumber: 0,
        dayNumber: 0,
        phase: 'SETUP',
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    // Notify mafia players
    mafiaTeam.forEach(playerId => {
      this.gameRepository.addEvent(gameId, {
        type: 'MAFIA_TEAM_NOTIFIED',
        visibility: 'PRIVATE',
        actorId: playerId,
        data: {
          teammates: mafiaTeam.filter(id => id !== playerId),
        },
        metadata: {
          turnNumber: 0,
          dayNumber: 0,
          phase: 'SETUP',
          sequence: this.gameRepository.getNextSequence(gameId),
        },
      });
    });
    
    console.log(`[GameEngine] Roles assigned in game ${gameId}`);
  }
  
  /**
   * Submit night action
   */
  submitNightAction(
    gameId: string,
    playerId: string,
    action: string,
    targetId: string
  ): GameActionResult {
    const game = this.gameRepository.getGame(gameId);
    
    if (!game) {
      return { success: false, error: 'Game not found' };
    }
    
    if (game.currentState.phase !== 'NIGHT_ACTIONS') {
      return { success: false, error: 'Not in night phase' };
    }
    
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }
    
    if (!player.isAlive) {
      return { success: false, error: 'Player is eliminated' };
    }
    
    const event = this.gameRepository.addEvent(gameId, {
      type: 'NIGHT_ACTION_SUBMITTED',
      visibility: 'PRIVATE',
      actorId: playerId,
      data: {
        actorId: playerId,
        action,
        targetId,
        nightNumber: game.currentState.dayNumber,
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: game.currentState.phase,
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    return { success: true, event };
  }
  
  /**
   * Submit vote
   */
  submitVote(
    gameId: string,
    voterId: string,
    targetId: string
  ): GameActionResult {
    const game = this.gameRepository.getGame(gameId);
    
    if (!game) {
      return { success: false, error: 'Game not found' };
    }
    
    const voter = game.players.find(p => p.id === voterId);
    if (!voter) {
      return { success: false, error: 'Voter not found' };
    }
    
    if (!voter.isAlive) {
      return { success: false, error: 'Voter is eliminated' };
    }
    
    if (!game.config.allowSelfVote && voterId === targetId) {
      return { success: false, error: 'Self-voting is not allowed' };
    }
    
    const event = this.gameRepository.addEvent(gameId, {
      type: 'VOTE_CAST',
      visibility: 'PUBLIC',
      actorId: voterId,
      targetId,
      data: {
        voterId,
        targetId,
        dayNumber: game.currentState.dayNumber,
        turnNumber: game.currentState.turnNumber,
        voteNumber: game.currentState.votes.length + 1,
        final: game.currentState.phase === 'DAY_VOTING',
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: game.currentState.phase,
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    return { success: true, event };
  }
  
  /**
   * Make accusation
   */
  makeAccusation(
    gameId: string,
    accuserId: string,
    targetId: string,
    accusation: string,
    evidence: string
  ): GameActionResult {
    const game = this.gameRepository.getGame(gameId);
    
    if (!game) {
      return { success: false, error: 'Game not found' };
    }
    
    const event = this.gameRepository.addEvent(gameId, {
      type: 'ACCUSATION_MADE',
      visibility: 'PUBLIC',
      actorId: accuserId,
      targetId,
      data: {
        accuserId,
        targetId,
        accusation,
        evidence,
        dayNumber: game.currentState.dayNumber,
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: game.currentState.phase,
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    return { success: true, event };
  }
  
  /**
   * Claim role
   */
  claimRole(
    gameId: string,
    playerId: string,
    role: RoleType
  ): GameActionResult {
    const game = this.gameRepository.getGame(gameId);
    
    if (!game) {
      return { success: false, error: 'Game not found' };
    }
    
    const event = this.gameRepository.addEvent(gameId, {
      type: 'ROLE_CLAIMED',
      visibility: 'PUBLIC',
      actorId: playerId,
      data: {
        playerId,
        claimedRole: role,
        dayNumber: game.currentState.dayNumber,
        believable: true,
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: game.currentState.phase,
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    return { success: true, event };
  }
  
  /**
   * Get game state
   */
  getGameState(gameId: string): GameState | null {
    const game = this.gameRepository.getGame(gameId);
    if (!game) return null;
    
    return game.currentState;
  }
  
  /**
   * Get active games
   */
  getActiveGames(): string[] {
    return Array.from(this.activeGames.keys());
  }
  
  /**
   * End game
   */
  endGame(gameId: string, winner: 'MAFIA' | 'TOWN'): void {
    const game = this.gameRepository.getGame(gameId);
    if (!game) return;
    
    // Calculate final stats
    const duration = game.endedAt 
      ? game.endedAt.getTime() - game.startedAt!.getTime() 
      : Date.now() - game.startedAt!.getTime();
    
    // Update game results
    this.gameRepository.updateGameResults(gameId, winner, {
      duration,
      dayCount: game.currentState.dayNumber,
      totalTurns: game.currentState.turnNumber,
      totalEvents: game.events.length,
      totalTokens: this.statsCollector.getTotalTokens(gameId),
      totalCost: this.statsCollector.getTotalCost(gameId),
    });
    
    // Update game status
    this.gameRepository.updateGameStatus(gameId, 'ENDED');
    
    // Add game over event
    this.gameRepository.addEvent(gameId, {
      type: 'WINNER_DETERMINED',
      visibility: 'PUBLIC',
      data: {
        winner,
        mafiaCount: game.players.filter(p => p.isMafia && p.isAlive).length,
        townCount: game.players.filter(p => !p.isMafia && p.isAlive).length,
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: 'GAME_OVER',
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
    
    // Remove from active games
    this.activeGames.delete(gameId);
    
    console.log(`[GameEngine] Game ${gameId} ended. Winner: ${winner}`);
  }
  
  /**
   * Handle state changes
   */
  private handleStateChange(event: GameEvent): void {
    const gameId = event.gameId;
    const fsm = this.activeGames.get(gameId);
    
    if (!fsm) return;
    
    const game = this.gameRepository.getGame(gameId);
    if (!game) return;
    
    const newPhase = event.data.toPhase || event.metadata.phase;
    
    switch (newPhase) {
      case 'NIGHT_ACTIONS':
        // Start night phase
        this.startNightPhase(gameId);
        break;
        
      case 'MORNING_REVEAL':
        // Process night results
        this.processNightResults(gameId);
        break;
        
      case 'DAY_DISCUSSION':
        // Start day discussion
        break;
        
      case 'DAY_VOTING':
        // Start voting
        break;
        
      case 'GAME_OVER':
        // Determine winner
        this.determineWinner(gameId);
        break;
    }
  }
  
  /**
   * Start night phase
   */
  private startNightPhase(gameId: string): void {
    const game = this.gameRepository.getGame(gameId);
    if (!game) return;
    
    this.gameRepository.addEvent(gameId, {
      type: 'NIGHT_STARTED',
      visibility: 'PUBLIC',
      data: {
        nightNumber: game.currentState.dayNumber,
        alivePlayers: game.players.filter(p => p.isAlive).map(p => p.id),
        roles: game.players.filter(p => p.isAlive).map(p => ({
          playerId: p.id,
          role: p.role,
          canAct: ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE'].includes(p.role),
        })),
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: 'NIGHT_ACTIONS',
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
  }
  
  /**
   * Process night results
   */
  private processNightResults(gameId: string): void {
    const game = this.gameRepository.getGame(gameId);
    if (!game) return;
    
    // Get night actions
    const nightActions = this.gameRepository.getEventsByType(gameId, 'NIGHT_ACTION_SUBMITTED');
    const deaths: Array<{ playerId: string; role: RoleType; protected: boolean }> = [];
    const protections: Array<{ doctorId: string; targetId: string; successful: boolean }> = [];
    
    // Process mafia kill
    const mafiaKill = nightActions.find(a => 
      (a.data as { action: string }).action === 'MAFIA_KILL'
    );
    
    if (mafiaKill) {
      const targetId = (mafiaKill.data as { targetId: string }).targetId;
      const target = game.players.find(p => p.id === targetId);
      
      if (target && target.isAlive) {
        // Check if protected
        const protectAction = nightActions.find(a => 
          (a.data as { action: string }).action === 'DOCTOR_PROTECT' &&
          (a.data as { targetId: string }).targetId === targetId
        );
        
        const isProtected = !!protectAction;
        
        if (!isProtected) {
          deaths.push({ playerId: targetId, role: target.role, protected: false });
        } else {
          protections.push({
            doctorId: (protectAction.data as { actorId: string }).actorId,
            targetId,
            successful: true,
          });
          
          this.gameRepository.addEvent(gameId, {
            type: 'DOCTOR_PROTECTION_SUCCESSFUL',
            visibility: 'PRIVATE',
            actorId: (protectAction.data as { actorId: string }).actorId,
            targetId,
            data: {
              doctorId: (protectAction.data as { actorId: string }).actorId,
              targetId,
              successful: true,
              selfProtection: (protectAction.data as { actorId: string }).actorId === targetId,
            },
            metadata: {
              turnNumber: game.currentState.turnNumber,
              dayNumber: game.currentState.dayNumber,
              phase: 'MORNING_REVEAL',
              sequence: this.gameRepository.getNextSequence(gameId),
            },
          });
        }
      }
    }
    
    // Process vigilante shot
    const vigilanteShot = nightActions.find(a => 
      (a.data as { action: string }).action === 'VIGILANTE_SHOOT'
    );
    
    if (vigilanteShot) {
      const targetId = (vigilanteShot.data as { targetId: string }).targetId;
      const target = game.players.find(p => p.id === targetId);
      
      if (target && target.isAlive) {
        deaths.push({ playerId: targetId, role: target.role, protected: false });
        
        this.gameRepository.addEvent(gameId, {
          type: 'VIGILANTE_SHOT_FIRED',
          visibility: 'PUBLIC',
          actorId: (vigilanteShot.data as { actorId: string }).actorId,
          targetId,
          data: {
            vigilanteId: (vigilanteShot.data as { actorId: string }).actorId,
            targetId,
            nightNumber: game.currentState.dayNumber,
            shotNumber: 1,
            successful: true,
            targetRole: target.role,
          },
          metadata: {
            turnNumber: game.currentState.turnNumber,
            dayNumber: game.currentState.dayNumber,
            phase: 'MORNING_REVEAL',
            sequence: this.gameRepository.getNextSequence(gameId),
          },
        });
      }
    }
    
    // Process eliminations
    deaths.forEach(death => {
      this.gameRepository.eliminatePlayer(death.playerId);
      
      this.gameRepository.addEvent(gameId, {
        type: 'PLAYER_KILLED',
        visibility: 'PUBLIC',
        targetId: death.playerId,
        data: {
          playerId: death.playerId,
          role: death.role,
          killedBy: mafiaKill ? (mafiaKill.data as { actorId: string }).actorId : undefined,
          protected: death.protected,
          dayNumber: game.currentState.dayNumber,
        },
        metadata: {
          turnNumber: game.currentState.turnNumber,
          dayNumber: game.currentState.dayNumber,
          phase: 'MORNING_REVEAL',
          sequence: this.gameRepository.getNextSequence(gameId),
        },
      });
    });
    
    // Add morning reveal event
    this.gameRepository.addEvent(gameId, {
      type: 'MORNING_REVEAL',
      visibility: 'PUBLIC',
      data: {
        nightNumber: game.currentState.dayNumber,
        deaths: deaths.map(d => ({
          playerId: d.playerId,
          role: d.role,
          protected: d.protected,
        })),
        protections,
      },
      metadata: {
        turnNumber: game.currentState.turnNumber,
        dayNumber: game.currentState.dayNumber,
        phase: 'MORNING_REVEAL',
        sequence: this.gameRepository.getNextSequence(gameId),
      },
    });
  }
  
  /**
   * Determine winner
   */
  private determineWinner(gameId: string): void {
    const game = this.gameRepository.getGame(gameId);
    if (!game) return;
    
    const alivePlayers = game.players.filter(p => p.isAlive);
    const mafiaAlive = alivePlayers.filter(p => p.isMafia).length;
    const townAlive = alivePlayers.filter(p => !p.isMafia).length;
    
    let winner: 'MAFIA' | 'TOWN';
    
    if (mafiaAlive >= townAlive) {
      winner = 'MAFIA';
    } else {
      winner = 'TOWN';
    }
    
    this.endGame(gameId, winner);
  }
}

export default GameEngine;
