/**
 * Legacy Game Adapter
 * 
 * Bridges the legacy game engine (game-engine.js) with the server's EventBus.
 * Spawns the legacy engine as a child process, captures its JSON events,
 * translates them to server GameEvent format, and publishes through EventBus.
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { EventBus } from './event-bus.js';
import { GameRepository } from '../db/repository.js';
import { GameEvent, EventVisibility, GamePhase, EventType } from '@mafia/shared/events';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LegacyGameConfig {
  numPlayers?: number;
  personaSeeds?: string[];
  gameConfig?: Record<string, unknown>;
  /** Per-role model assignments, e.g. { MAFIA: "qwen3.6-35b", SHERIFF: "kimi-k2.6" } */
  roleModels?: Record<string, string>;
}

/** Map role names to legacy env var names */
const ROLE_ENV_MAP: Record<string, string> = {
  'MAFIA': 'MAFIA_MODEL',
  'SHERIFF': 'SHERIFF_MODEL',
  'DOCTOR': 'DOCTOR_MODEL',
  'VILLAGER': 'VILLAGER_MODEL',
  'VIGILANTE': 'VIGILANTE_MODEL',
  'JESTER': 'JESTER_MODEL',
  'DETECTIVE': 'DETECTIVE_MODEL',
  'BODYGUARD': 'BODYGUARD_MODEL',
};

export interface LegacyGameState {
  gameId: string;
  process: ChildProcess;
  eventCount: number;
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  startedAt: Date;
  endedAt?: Date;
  error?: string;
}

export class LegacyGameAdapter extends EventEmitter {
  private eventBus: EventBus;
  private gameRepository: GameRepository;
  private activeGames: Map<string, LegacyGameState>;
  private bridgeScriptPath: string;
  
  private static instance: LegacyGameAdapter | null = null;
  
  constructor(eventBus: EventBus, gameRepository: GameRepository) {
    super();
    this.eventBus = eventBus;
    this.gameRepository = gameRepository;
    this.activeGames = new Map();
    this.bridgeScriptPath = path.resolve(__dirname, 'legacy-bridge.js');
  }
  
  static getInstance(eventBus: EventBus, gameRepository: GameRepository): LegacyGameAdapter {
    if (!LegacyGameAdapter.instance) {
      LegacyGameAdapter.instance = new LegacyGameAdapter(eventBus, gameRepository);
    }
    return LegacyGameAdapter.instance;
  }
  
  /**
   * Start a legacy game. Spawns the bridge process and pipes events.
   */
  startGame(config: LegacyGameConfig = {}): LegacyGameState {
    const gameId = uuidv4();
    const args: string[] = [];
    
    if (config.numPlayers) {
      args.push('--players', String(config.numPlayers));
    }
    
    if (config.personaSeeds && config.personaSeeds.length > 0) {
      args.push('--seeds', config.personaSeeds.join(','));
    }
    
    if (config.gameConfig) {
      args.push('--config', JSON.stringify(config.gameConfig));
    }
    
    console.log(`[LegacyAdapter] Starting legacy game ${gameId} with args:`, args);
    
    // Insert game into repository so foreign key constraints are satisfied for events
    try {
      // Use raw insert to avoid GameConfig type mismatch (legacy adapter has fewer fields)
      const db = (this.gameRepository as any).db;
      if (db) {
        db.prepare(`INSERT INTO games (id, status, config, created_at) VALUES (?, 'IN_PROGRESS', ?, ?)`)
          .run(gameId, JSON.stringify({ numPlayers: config.numPlayers || 5, engineType: 'legacy' }), Date.now());
      }
    } catch (e: any) {
      console.error(`[LegacyAdapter] Failed to create game in repository: ${e?.message || e}`);
    }
    
    // Build environment with per-role model assignments
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (config.roleModels) {
      for (const [role, model] of Object.entries(config.roleModels)) {
        const envKey = ROLE_ENV_MAP[role.toUpperCase()];
        if (envKey) {
          env[envKey] = model;
          console.log(`[LegacyAdapter] Set ${envKey}=${model} for role ${role}`);
        } else {
          console.warn(`[LegacyAdapter] Unknown role: ${role}, no env var mapping`);
        }
      }
    }
    
    // Spawn the bridge as a child process
    const childProcess = spawn('node', [this.bridgeScriptPath, ...args], {
      cwd: path.resolve(__dirname, '..'),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    const gameState: LegacyGameState = {
      gameId,
      process: childProcess,
      eventCount: 0,
      status: 'RUNNING',
      startedAt: new Date(),
    };
    
    this.activeGames.set(gameId, gameState);
    
    // Handle stdout - JSON events
    let buffer = '';
    childProcess.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const parsed = JSON.parse(line);
          this.handleBridgeMessage(gameId, parsed);
        } catch (e) {
          console.warn(`[LegacyAdapter] Non-JSON output from bridge:`, line.substring(0, 200));
        }
      }
    });
    
    // Handle stderr
    childProcess.stderr.on('data', (data: Buffer) => {
      console.error(`[LegacyAdapter:${gameId}] stderr:`, data.toString().trim());
    });
    
    // Handle process exit
    childProcess.on('close', (code) => {
      const state = this.activeGames.get(gameId);
      if (state) {
        state.endedAt = new Date();
        if (code !== 0 && state.status !== 'COMPLETED') {
          state.status = 'ERROR';
          state.error = `Process exited with code ${code}`;
        }
        // Update database status
        try {
          const db = (this.gameRepository as any).db;
          if (db && state.status === 'COMPLETED') {
            db.prepare(`UPDATE games SET status = 'ENDED', ended_at = ? WHERE id = ?`)
              .run(Date.now(), gameId);
          } else if (db && state.status === 'ERROR') {
            db.prepare(`UPDATE games SET status = 'CANCELLED', ended_at = ? WHERE id = ?`)
              .run(Date.now(), gameId);
          }
        } catch (e: any) {
          console.error(`[LegacyAdapter] Failed to update game status: ${e?.message || e}`);
        }
      }
      console.log(`[LegacyAdapter] Game ${gameId} process ended (code ${code}), ${gameState.eventCount} events`);
      this.emit('gameEnded', gameId);
    });
    
    childProcess.on('error', (error) => {
      const state = this.activeGames.get(gameId);
      if (state) {
        state.status = 'ERROR';
        state.error = error.message;
        state.endedAt = new Date();
      }
      console.error(`[LegacyAdapter] Game ${gameId} process error:`, error.message);
      this.emit('gameError', gameId, error);
    });
    
    // Emit creation event
    this.publishEvent({
      id: uuidv4(),
      gameId,
      type: 'GAME_CREATED' as EventType,
      timestamp: new Date(),
      visibility: 'PUBLIC' as EventVisibility,
      data: {
        config: config.gameConfig || { numPlayers: config.numPlayers || 5 },
        hostPlayerId: 'legacy-system',
        engineType: 'legacy',
      },
      metadata: {
        turnNumber: 0,
        dayNumber: 0,
        phase: 'SETUP' as GamePhase,
        sequence: 0,
      },
    });
    
    return gameState;
  }
  
  /**
   * Handle messages from the bridge process
   */
  private handleBridgeMessage(gameId: string, message: Record<string, unknown>): void {
    const state = this.activeGames.get(gameId);
    if (!state) return;
    
    switch (message.type) {
      case 'info':
        console.log(`[LegacyAdapter:${gameId}]`, message.message);
        break;
        
      case 'event':
        state.eventCount++;
        console.log(`[LegacyAdapter:${gameId}] Event #${state.eventCount}: ${message.eventType || 'UNKNOWN'}`);
        this.translateAndPublishEvent(gameId, message, state.eventCount);
        break;
        
      case 'done':
        state.status = 'COMPLETED';
        console.log(`[LegacyAdapter:${gameId}] Game completed. Total events: ${message.totalEvents}`);
        
        // Publish game ended event
        this.publishEvent({
          id: uuidv4(),
          gameId,
          type: 'GAME_ENDED' as EventType,
          timestamp: new Date(),
          visibility: 'PUBLIC' as EventVisibility,
          data: {
            winner: message.winner || 'UNKNOWN',
            reason: 'Legacy engine completed',
            duration: state.startedAt ? Date.now() - state.startedAt.getTime() : 0,
            dayCount: (message.dayCount as number) || 0,
            finalScores: [],
            totalEvents: message.totalEvents as number,
          },
          metadata: {
            turnNumber: state.eventCount,
            dayNumber: (message.dayCount as number) || 0,
            phase: 'GAME_OVER' as GamePhase,
            sequence: state.eventCount + 1,
          },
        });
        break;
        
      case 'error':
        state.status = 'ERROR';
        state.error = message.message as string;
        console.error(`[LegacyAdapter:${gameId}] Bridge error:`, message.message);
        break;
        
      default:
        console.log(`[LegacyAdapter:${gameId}] Unknown message type:`, message.type);
    }
  }
  
  /**
   * Translate legacy event to server GameEvent format and publish
   */
  private translateAndPublishEvent(gameId: string, legacyEvent: Record<string, unknown>, sequence: number): void {
    // Map legacy event types to server event types
    // The bridge uses compact types: STATE_CHANGE, PHASE_CHANGE, MESSAGE, ACTION, REVEAL, VOTE
    // We map them to the full server event types
    const typeMapping: Record<string, EventType> = {
      // Bridge event types (from legacy-bridge.js)
      'STATE_CHANGE': 'GAME_STARTED',        // State changes include game creation/start
      'PHASE_CHANGE': 'PHASE_CHANGED',       // Phase transitions (setup→night→day→voting)
      'MESSAGE': 'AGENT_SAYS_BROADCASTED',   // Agent THINK/SAYS with consciousness split
      'ACTION': 'NIGHT_ACTION_SUBMITTED',    // Night actions (kill, protect, investigate)
      'REVEAL': 'MORNING_REVEAL',            // Morning reveals and player eliminations
      'VOTE': 'VOTE_CAST',                   // Daytime voting
      // Legacy engine event types (from game-engine.js, for direct spawn without bridge)
      'PLAYER_JOINED': 'PLAYER_JOINED',
      'GAME_STARTED': 'GAME_STARTED',
      'ROLES_ASSIGNED': 'ROLES_ASSIGNED',
      'NIGHT_STARTED': 'NIGHT_STARTED',
      'NIGHT_ACTION': 'NIGHT_ACTION_SUBMITTED',
      'NIGHT_ACTION_SUBMITTED': 'NIGHT_ACTION_SUBMITTED',
      'MAFIA_KILL': 'MAFIA_KILL_ATTEMPTED',
      'MAFIA_KILL_ATTEMPTED': 'MAFIA_KILL_ATTEMPTED',
      'MAFIA_KILL_SUCCEEDED': 'MAFIA_KILL_SUCCEEDED',
      'DOCTOR_PROTECT': 'DOCTOR_PROTECTION_SUBMITTED',
      'DOCTOR_PROTECTION_SUCCESSFUL': 'DOCTOR_PROTECTION_SUCCESSFUL',
      'SHERIFF_INVESTIGATE': 'SHERIFF_INVESTIGATION_SUBMITTED',
      'SHERIFF_INVESTIGATION_RESULT': 'SHERIFF_INVESTIGATION_RESULT',
      'VIGILANTE_SHOT': 'VIGILANTE_SHOT_SUBMITTED',
      'VIGILANTE_SHOT_FIRED': 'VIGILANTE_SHOT_FIRED',
      'MORNING_REVEAL': 'MORNING_REVEAL',
      'PLAYER_KILLED': 'PLAYER_KILLED',
      'PLAYER_ELIMINATED': 'PLAYER_ELIMINATED',
      'PLAYER_LYNCHED': 'PLAYER_LYNCHED',
      'VOTE_CAST': 'VOTE_CAST',
      'ACCUSATION_MADE': 'ACCUSATION_MADE',
      'ROLE_CLAIMED': 'ROLE_CLAIMED',
      'ROLE_REVEALED': 'ROLE_REVEALED',
      'PHASE_CHANGED': 'PHASE_CHANGED',
      'WINNER_DETERMINED': 'WINNER_DETERMINED',
      'AGENT_THINK_STARTED': 'AGENT_THINK_STARTED',
      'AGENT_THINK_COMPLETED': 'AGENT_THINK_COMPLETED',
      'AGENT_SAYS_BROADCASTED': 'AGENT_SAYS_BROADCASTED',
      'AGENT_ACTION_TAKEN': 'AGENT_ACTION_TAKEN',
      'AGENT_ERROR': 'AGENT_ERROR',
      'GAME_ENDED': 'GAME_ENDED',
    };
    
    // Map legacy visibility
    const visibilityMapping: Record<string, EventVisibility> = {
      'PUBLIC': 'PUBLIC',
      'PRIVATE': 'PRIVATE',
      'PRIVATE_MAFIA': 'PRIVATE',
      'ADMIN_ONLY': 'ADMIN',
    };
    
    const legacyType = (legacyEvent.eventType as string) || 'UNKNOWN';
    const serverType = typeMapping[legacyType] || ('GAME_CREATED' as EventType);
    const visibility = visibilityMapping[(legacyEvent.visibility as string) || 'PUBLIC'] || 'PUBLIC';
    
    // Map legacy phase to server phase
    const phaseMapping: Record<string, GamePhase> = {
      'SETUP': 'SETUP',
      'NIGHT': 'NIGHT_ACTIONS',
      'NIGHT_ACTIONS': 'NIGHT_ACTIONS',
      'MORNING': 'MORNING_REVEAL',
      'MORNING_REVEAL': 'MORNING_REVEAL',
      'DAY': 'DAY_DISCUSSION',
      'DAY_DISCUSSION': 'DAY_DISCUSSION',
      'VOTING': 'DAY_VOTING',
      'DAY_VOTING': 'DAY_VOTING',
      'RESOLUTION': 'RESOLUTION',
      'GAME_OVER': 'GAME_OVER',
    };
    
    const serverPhase = phaseMapping[(legacyEvent.phase as string) || 'SETUP'] || 'SETUP';
    
    const gameEvent: GameEvent = {
      id: uuidv4(),
      gameId,
      type: serverType,
      timestamp: legacyEvent.timestamp ? new Date(legacyEvent.timestamp as string) : new Date(),
      visibility,
      actorId: (legacyEvent.playerId as string) || undefined,
      targetId: (legacyEvent.content && typeof legacyEvent.content === 'object' 
        ? (legacyEvent.content as Record<string, unknown>).targetId as string
        : undefined),
      data: {
        legacyType,
        ...(legacyEvent.content as Record<string, unknown> || {}),
        playerName: legacyEvent.playerName,
      },
      metadata: {
        turnNumber: sequence,
        dayNumber: ((legacyEvent.round as number) || 0),
        phase: serverPhase,
        sequence,
      },
    };
    
    // Publish to EventBus
    this.eventBus.publish(gameEvent);
    
    // Store event in repository for REST retrieval
    try {
      const { id, gameId: _, timestamp, ...eventData } = gameEvent;
      this.gameRepository.addEvent(gameId, eventData as any);
    } catch (e: any) {
      console.error(`[LegacyAdapter] Failed to store event: ${e?.message || e}`);
    }
    
    // Try to persist through game repository if we have one
    try {
      // We could persist events through the repository,
      // but the legacy engine has its own game ID from the legacy side.
      // For now, just emit through the EventBus.
    } catch (e) {
      // Silently ignore - events still flow through EventBus
    }
  }
  
  /**
   * Publish an event directly to the EventBus
   */
  private publishEvent(event: GameEvent): void {
    this.eventBus.publish(event);
  }
  
  /**
   * Get active legacy games
   */
  getActiveGames(): string[] {
    return Array.from(this.activeGames.keys());
  }
  
  /**
   * Get game state
   */
  getGameState(gameId: string): LegacyGameState | undefined {
    return this.activeGames.get(gameId);
  }
  
  /**
   * Stop a legacy game
   */
  stopGame(gameId: string): boolean {
    const state = this.activeGames.get(gameId);
    if (!state || state.status !== 'RUNNING') return false;
    
    state.process.kill('SIGTERM');
    state.status = 'COMPLETED';
    state.endedAt = new Date();
    return true;
  }
  
  /**
   * Stop all legacy games
   */
  stopAll(): void {
    this.activeGames.forEach((state, gameId) => {
      if (state.status === 'RUNNING') {
        state.process.kill('SIGTERM');
      }
    });
    this.activeGames.clear();
  }
}

export default LegacyGameAdapter;
