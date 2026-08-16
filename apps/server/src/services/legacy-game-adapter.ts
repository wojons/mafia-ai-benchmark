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
  // Benchmark runner assigns the town core under the 'TOWN' role key;
  // the legacy engine resolves town players via VILLAGER_MODEL.
  'TOWN': 'VILLAGER_MODEL',
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

/**
 * Per-model usage aggregate emitted by the legacy bridge in its 'done'
 * message (MAF-GAP-012). Populated from the engine's real token/cost
 * trackers; player_id is not known at this level, so rows are keyed by
 * role via player_model_assignments.
 */
export interface UsageAggregate {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  apiCalls: number;
  latencyMs: number;
}

/**
 * Per-player usage aggregate emitted by the legacy bridge in its 'done'
 * message (MAF-GAP-029). Same tracker data as UsageAggregate but keyed by
 * the engine's real player id, so token_usage/api_calls can carry the
 * per-player dimension the game detail attribution needs.
 */
export interface PlayerUsageAggregate {
  playerId: string;
  playerName?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  apiCalls: number;
  latencyMs: number;
}

export class LegacyGameAdapter extends EventEmitter {
  private eventBus: EventBus;
  private gameRepository: GameRepository;
  private activeGames: Map<string, LegacyGameState>;
  private bridgeScriptPath: string;
  /**
   * Game configs by adapter game id, kept so the ROLES_ASSIGNED handler
   * can resolve per-player provider/model from the request the game was
   * started with (MAF-GAP-043B). Same lifetime as activeGames entries.
   */
  private gameConfigs: Map<string, LegacyGameConfig>;
  
  private static instance: LegacyGameAdapter | null = null;
  
  constructor(eventBus: EventBus, gameRepository: GameRepository) {
    super();
    this.eventBus = eventBus;
    this.gameRepository = gameRepository;
    this.activeGames = new Map();
    this.gameConfigs = new Map();
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
    this.gameConfigs.set(gameId, config);
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

    // Persist per-role model assignments so stats can attribute games to
    // the REAL models that played them (MAF-GAP-012). The legacy engine
    // resolves role models from env vars; mirroring them into
    // player_model_assignments gives the stats service honest per-model
    // data (wins only count for models that actually played).
    if (config.roleModels) {
      try {
        const db = (this.gameRepository as any).db;
        if (db) {
          const insert = db.prepare(`
            INSERT OR REPLACE INTO player_model_assignments
              (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const [role, modelSpec] of Object.entries(config.roleModels)) {
            if (!modelSpec || typeof modelSpec !== 'string') continue;
            const [provider, model] = modelSpec.split('/');
            if (!provider || !model) continue;
            insert.run(
              uuidv4(),
              gameId,
              'ALL', // schema requires player_id NOT NULL; role-level sentinel
              role.toUpperCase(),
              provider,
              model,
              0.7,
              500,
              0,
              Date.now(),
            );
          }
        }
      } catch (e: any) {
        console.error(`[LegacyAdapter] Failed to persist role model assignments: ${e?.message || e}`);
      }
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
        console.log(`[LegacyAdapter:${gameId}] Game completed. Winner: ${message.winner || 'UNKNOWN'}. Total events: ${message.totalEvents}`);
        
        // Update database with winner, duration and completion
        try {
          const db = (this.gameRepository as any).db;
          if (db) {
            const winner = message.winner || 'UNKNOWN';
            // MAF-GAP-012: record a real duration (ended_at - created_at)
            // so avgDuration is not always 0 for legacy games.
            const duration = state.startedAt
              ? Date.now() - state.startedAt.getTime()
              : 0;
            db.prepare(`UPDATE games SET status = 'ENDED', ended_at = ?, duration = ?, config = json_set(config, '$.winner', ?) WHERE id = ?`)
              .run(Date.now(), duration, winner, gameId);
            // MAF-GAP-043: persist per-player won (1 winning side / 0
            // losing side) so model win rates read real data. Only when the
            // bridge reported a real winner; games without players rows
            // (legacy usage-only games) are a no-op.
            if (winner === 'MAFIA' || winner === 'TOWN') {
              this.gameRepository.setPlayersWon(gameId, winner);
            }
            // MAF-GAP-043B: attach the engine's REAL per-player models
            // (bridge usageByPlayer) to any players row the request config
            // could not name (bare POST /api/v1/games without roleModels /
            // llmModel). Config-derived attribution is never overwritten
            // (COALESCE in backfillPlayerModel).
            if (Array.isArray(message.usageByPlayer)) {
              for (const u of message.usageByPlayer as PlayerUsageAggregate[]) {
                if (!u || !u.playerId || !u.provider || !u.model) continue;
                try {
                  this.gameRepository.backfillPlayerModel(u.playerId, u.provider, u.model);
                } catch (e: any) {
                  console.error(`[LegacyAdapter] Failed to backfill player model for ${u.playerId}: ${e?.message || e}`);
                }
              }
            }
            console.log(`[LegacyAdapter:${gameId}] Database updated: winner=${winner}, duration=${duration}ms`);
          }
        } catch (e: any) {
          console.error(`[LegacyAdapter] Failed to update game winner: ${e?.message || e}`);
        }

        // MAF-GAP-012: persist real per-model usage reported by the bridge
        // (token_usage + api_calls + player_game_stats) so cost tracking is
        // no longer hollow for legacy games. MAF-GAP-029: also persist the
        // per-player rows (real player_id) for game detail attribution.
        this.persistUsage(
          gameId,
          message.usage as UsageAggregate[] | undefined,
          message.usageByPlayer as PlayerUsageAggregate[] | undefined,
        );
        
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
   * Persist per-model usage aggregates from the bridge 'done' message into
   * token_usage / api_calls / player_game_stats (MAF-GAP-012).
   *
   * The bridge reports per-model totals (player_id is not known at that
   * level), so each model row is written once with a sentinel player_id of
   * 'ALL' and turn_number 0. When the game has role-based model
   * assignments, per-role rows are also written (player_id 'ALL', role from
   * the assignment) so player_game_stats carries the role attribution.
   *
   * MAF-GAP-029: when the bridge also reports per-player aggregates
   * (usageByPlayer), they are written as token_usage / api_calls rows
   * keyed by the REAL engine player id — the per-player dimension the
   * game detail attribution needs. The 'ALL' per-model rows are kept
   * regardless (the stats pipeline depends on them).
   *
   * All writes are best-effort: a failure logs and never breaks the game
   * completion path.
   */
  private persistUsage(
    gameId: string,
    usage: UsageAggregate[] | undefined,
    usageByPlayer?: PlayerUsageAggregate[] | undefined,
  ): void {
    const hasUsage = !!usage && Array.isArray(usage) && usage.length > 0;
    const hasPlayerUsage = !!usageByPlayer && Array.isArray(usageByPlayer) && usageByPlayer.length > 0;
    if (!hasUsage && !hasPlayerUsage) return;

    const db = (this.gameRepository as any).db;
    if (!db) return;

    const now = Date.now();

    // Role -> model map from player_model_assignments (written at startGame).
    let roleByModel = new Map<string, string>();
    try {
      const rows = db.prepare(
        'SELECT role, provider, model FROM player_model_assignments WHERE game_id = ? AND role IS NOT NULL'
      ).all(gameId) as Array<{ role: string; provider: string; model: string }>;
      for (const r of rows) {
        roleByModel.set(`${r.provider}/${r.model}`, r.role);
      }
    } catch (e: any) {
      console.error(`[LegacyAdapter] Failed to read role model assignments: ${e?.message || e}`);
    }

    const insertTokenUsage = db.prepare(`
      INSERT INTO token_usage
        (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertApiCall = db.prepare(`
      INSERT INTO api_calls
        (id, game_id, player_id, provider, model, endpoint, latency, status_code, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPlayerGameStats = db.prepare(`
      INSERT INTO player_game_stats
        (id, game_id, player_id, role, survived, won, tokens_used, api_calls, actions_taken, role_performance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (usage && Array.isArray(usage)) for (const u of usage) {
      if (!u || !u.provider || !u.model) continue;
      const role = roleByModel.get(`${u.provider}/${u.model}`) || 'UNASSIGNED';

      try {
        insertTokenUsage.run(
          uuidv4(),
          gameId,
          'ALL',
          0,
          u.provider,
          u.model,
          u.promptTokens || 0,
          u.completionTokens || 0,
          u.totalTokens || 0,
          u.cost || 0,
          now,
        );
      } catch (e: any) {
        console.error(`[LegacyAdapter] Failed to persist token usage: ${e?.message || e}`);
      }

      try {
        insertApiCall.run(
          uuidv4(),
          gameId,
          'ALL',
          u.provider,
          u.model,
          'legacy-engine',
          u.latencyMs || 0,
          200,
          now,
        );
      } catch (e: any) {
        console.error(`[LegacyAdapter] Failed to persist api call: ${e?.message || e}`);
      }

      try {
        insertPlayerGameStats.run(
          uuidv4(),
          gameId,
          'ALL',
          role,
          0,
          null,
          u.totalTokens || 0,
          u.apiCalls || 0,
          0,
          null,
        );
      } catch (e: any) {
        console.error(`[LegacyAdapter] Failed to persist player game stats: ${e?.message || e}`);
      }
    }

    // MAF-GAP-029: per-player rows keyed by the real engine player id.
    // token_usage + api_calls only — player_game_stats keeps its per-model
    // 'ALL' shape above (the stats pipeline depends on it). One aggregate
    // api_calls row per player, same convention as the per-model rows.
    if (usageByPlayer && Array.isArray(usageByPlayer)) {
      for (const u of usageByPlayer) {
        if (!u || !u.playerId || !u.provider || !u.model) continue;

        try {
          insertTokenUsage.run(
            uuidv4(),
            gameId,
            u.playerId,
            0,
            u.provider,
            u.model,
            u.promptTokens || 0,
            u.completionTokens || 0,
            u.totalTokens || 0,
            u.cost || 0,
            now,
          );
        } catch (e: any) {
          console.error(`[LegacyAdapter] Failed to persist per-player token usage: ${e?.message || e}`);
        }

        try {
          insertApiCall.run(
            uuidv4(),
            gameId,
            u.playerId,
            u.provider,
            u.model,
            'legacy-engine',
            u.latencyMs || 0,
            200,
            now,
          );
        } catch (e: any) {
          console.error(`[LegacyAdapter] Failed to persist per-player api call: ${e?.message || e}`);
        }
      }
    }

    const persistedUsage = usage && Array.isArray(usage) ? usage : [];
    const persistedPlayerUsage = usageByPlayer && Array.isArray(usageByPlayer) ? usageByPlayer : [];
    console.log(
      `[LegacyAdapter:${gameId}] Persisted ${persistedUsage.length} usage aggregate(s) ` +
        `(tokens=${persistedUsage.reduce((s, u) => s + (u.totalTokens || 0), 0)}, ` +
        `cost=${persistedUsage.reduce((s, u) => s + (u.cost || 0), 0).toFixed(6)})` +
        (persistedPlayerUsage.length > 0
          ? ` + ${persistedPlayerUsage.length} per-player usage row(s)`
          : ''),
    );
  }

  /**
   * Persist one players row per player from a ROLES_ASSIGNED bridge event
   * (MAF-GAP-043B).
   *
   * The row id is the assignment's playerId — the SAME id the event stream
   * uses as actorId, so DB rows and event-derived players stay consistent
   * (extractPlayersFromEvents consumes the same assignments/mafiaTeam
   * shape). name comes from the assignment when the bridge carries it
   * (MAF-GAP-013 synthetic roster includes it), falling back to the
   * extractor's `Player <id-prefix>` convention. isMafia prefers the
   * assignment's explicit boolean (the engine's real value, correct for
   * multi-role mafia players whose primary display role is DOCTOR/etc.),
   * then role === 'MAFIA', then mafiaTeam membership. provider/model come
   * from the request config via resolvePlayerModel; won stays NULL until
   * setPlayersWon at game end.
   *
   * All writes are best-effort: a failure logs and never breaks the event
   * flow. INSERT OR REPLACE keeps the row idempotent if the roster event
   * arrives more than once.
   */
  private persistPlayers(gameId: string, content: Record<string, unknown>): void {
    const assignments = Array.isArray(content.assignments)
      ? (content.assignments as Array<Record<string, unknown>>)
      : [];
    if (assignments.length === 0) return;

    const mafiaTeam = new Set<string>();
    if (Array.isArray(content.mafiaTeam)) {
      for (const id of content.mafiaTeam as unknown[]) {
        if (typeof id === 'string') mafiaTeam.add(id);
      }
    }
    const config = this.gameConfigs.get(gameId);
    let persisted = 0;

    assignments.forEach((assignment, index) => {
      const playerId = typeof assignment.playerId === 'string' ? assignment.playerId : '';
      const role = typeof assignment.role === 'string' && assignment.role ? assignment.role : 'UNASSIGNED';
      if (!playerId) return;

      const isMafia = typeof assignment.isMafia === 'boolean'
        ? assignment.isMafia
        : role === 'MAFIA' || mafiaTeam.has(playerId);
      const name = typeof assignment.name === 'string' && assignment.name
        ? assignment.name
        : `Player ${playerId.substring(0, 8)}`;
      const model = this.resolvePlayerModel(config, role);

      try {
        this.gameRepository.upsertPlayer(gameId, {
          id: playerId,
          name,
          role,
          isMafia,
          joinOrder: index,
          provider: model?.provider,
          model: model?.model,
        });
        persisted += 1;
      } catch (e: any) {
        console.error(`[LegacyAdapter] Failed to persist player ${playerId}: ${e?.message || e}`);
      }
    });

    console.log(`[LegacyAdapter:${gameId}] Persisted ${persisted} player row(s) from ROLES_ASSIGNED`);
  }

  /**
   * Resolve the (provider, model) a player should carry from the game
   * config the adapter holds (MAF-GAP-043B):
   *   1. roleModels[role] — the benchmark runner's per-role split
   *      ('provider/model' specs; the town core is keyed 'TOWN' but the
   *      legacy engine resolves those via VILLAGER_MODEL, so TOWN and
   *      VILLAGER keys match each other, case-insensitively).
   *   2. gameConfig.llmProvider/llmModel — the CLI run-game single-model
   *      request (llmModel is 'provider/model').
   * Returns undefined when the config names no model; the done handler
   * then backfills from the engine's real per-player usage.
   */
  private resolvePlayerModel(
    config: LegacyGameConfig | undefined,
    role: string,
  ): { provider: string; model: string } | undefined {
    const roleModels = config?.roleModels;
    if (roleModels && role) {
      const upper = role.toUpperCase();
      for (const [key, spec] of Object.entries(roleModels)) {
        if (typeof spec !== 'string' || !spec) continue;
        const keyUpper = key.toUpperCase();
        const matches = keyUpper === upper ||
          (keyUpper === 'TOWN' && upper === 'VILLAGER') ||
          (keyUpper === 'VILLAGER' && upper === 'TOWN');
        if (!matches) continue;
        const slash = spec.indexOf('/');
        if (slash > 0) {
          const provider = spec.slice(0, slash);
          const model = spec.slice(slash + 1);
          if (provider && model) return { provider, model };
        }
      }
    }

    const gameConfig = config?.gameConfig;
    if (gameConfig && typeof gameConfig === 'object') {
      const cfg = gameConfig as Record<string, unknown>;
      const llmModel = cfg.llmModel;
      if (typeof llmModel === 'string' && llmModel) {
        const slash = llmModel.indexOf('/');
        if (slash > 0) {
          const provider = llmModel.slice(0, slash);
          const model = llmModel.slice(slash + 1);
          if (provider && model) return { provider, model };
        }
        const llmProvider = cfg.llmProvider;
        if (typeof llmProvider === 'string' && llmProvider) {
          return { provider: llmProvider, model: llmModel };
        }
      }
    }
    return undefined;
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
      // NOTE: terminal STATE_CHANGE events (phase GAME_OVER / winner in
      // content) are remapped to GAME_ENDED below (MAF-GAP-005).
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
    const legacyContent = (legacyEvent.content && typeof legacyEvent.content === 'object'
      ? legacyEvent.content as Record<string, unknown>
      : {});
    // MAF-GAP-005: the legacy engine emits the terminal transition as a
    // STATE_CHANGE with phase 'GAME_OVER' and winner info in content
    // (createGameEvent(gameId, round, "GAME_OVER", ..., { winner, mafiaAlive,
    // townAlive })). Map that to GAME_ENDED instead of the blanket
    // GAME_STARTED so consumers can see when/why a game ended. Non-terminal
    // STATE_CHANGE events (game creation/start, status STARTED) keep mapping
    // to GAME_STARTED.
    const isTerminalStateChange = legacyType === 'STATE_CHANGE'
      && ((legacyEvent.phase as string) === 'GAME_OVER' || legacyContent.winner !== undefined);
    const serverType = isTerminalStateChange
      ? ('GAME_ENDED' as EventType)
      : (typeMapping[legacyType] || ('GAME_CREATED' as EventType));
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
        ...legacyContent,
        playerName: legacyEvent.playerName,
        ...this.normalizeStatementData(serverType, legacyContent),
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

    // MAF-GAP-043B: persist one players row per player from the bridge's
    // full ROLES_ASSIGNED roster (the legacy engine emits it only via the
    // bridge, right before 'done'), so setPlayersWon at game end has rows
    // to update and the benchmark report can attribute wins to models.
    if (serverType === 'ROLES_ASSIGNED') {
      this.persistPlayers(gameId, legacyContent);
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
   * Normalize the public-statement keys on broadcast events.
   *
   * The legacy engine stores the statement under different keys depending on
   * phase (MAFIA_CHAT uses `says`, DAY_DISCUSSION uses `message`), while the
   * web UI and the coordinator path read `statement`/`says`. Without this,
   * DAY_DISCUSSION broadcasts render as EMPTY statements in the split-pane
   * view (sampled game 04fb5d4d: "4 of 5 players all-empty says").
   */
  private normalizeStatementData(
    serverType: string,
    content: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (serverType !== 'AGENT_SAYS_BROADCASTED') {
      return {};
    }
    const c = content || {};
    const statement =
      (c.statement as string) ??
      (c.says as string) ??
      (c.message as string) ??
      '';
    return { statement, says: statement };
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

  /**
   * Extract unique players from game events, mapping role/isMafia/isAlive
   * from role-bearing events when the information is present in the stream.
   *
   * Role sources (applied in event order; first known value wins per player):
   *  - ROLES_ASSIGNED: data.assignments[] ({playerId, role}) + data.mafiaTeam[]
   *  - MORNING_REVEAL: data.deaths[] — each death carries the full player
   *    object ({id, role, isMafia, isAlive}), revealing the victim's role.
   *  - Sheriff investigations: data.targetRoles[] (+ data.targetId) reveals
   *    the target's role(s); the acting player (event.actorId) is the SHERIFF.
   *  - Doctor protections: data.reason + data.targetId — the actor is DOCTOR.
   *  - Vigilante shots: data.action 'SHOOT'|'PASS' — the actor is VIGILANTE.
   *  - Mafia chat: PRIVATE AGENT_SAYS_BROADCASTED (legacy MESSAGE from the
   *    MAFIA_CHAT phase) — the actor is MAFIA.
   *  - Generic payloads: data.role (+ data.playerId/data.targetId), data.targetRole.
   *
   * Players whose role is genuinely never revealed keep 'UNASSIGNED' (and
   * isMafia=false / isAlive=true as neutral defaults).
   */
  static extractPlayersFromEvents(events: GameEvent[]): Array<{
    id: string;
    name: string;
    role: string;
    isMafia: boolean;
    isAlive: boolean;
    joinOrder: number;
  }> {
    const actorIds = new Set<string>();
    const nameByActor = new Map<string, string>();
    const roleByActor = new Map<string, string>();
    const mafiaByActor = new Map<string, boolean>();
    const deadActors = new Set<string>();

    const setRole = (id: string, role: string): void => {
      if (!roleByActor.has(id)) roleByActor.set(id, role);
    };
    const setMafia = (id: string, isMafia: boolean): void => {
      if (!mafiaByActor.has(id)) mafiaByActor.set(id, isMafia);
    };

    for (const event of events) {
      const data =
        event.data && typeof event.data === 'object'
          ? (event.data as Record<string, unknown>)
          : {};
      const actorId = event.actorId;

      // Track actor ids and names (existing behavior)
      if (actorId) {
        actorIds.add(actorId);
        if (!nameByActor.has(actorId) &&
            event.type === 'AGENT_SAYS_BROADCASTED' &&
            typeof data.playerName === 'string') {
          nameByActor.set(actorId, data.playerName);
        }
      }

      // 1. ROLES_ASSIGNED — authoritative full assignment
      if (event.type === 'ROLES_ASSIGNED') {
        if (Array.isArray(data.assignments)) {
          for (const assignment of data.assignments as Array<Record<string, unknown>>) {
            if (typeof assignment.playerId !== 'string' || typeof assignment.role !== 'string') continue;
            actorIds.add(assignment.playerId);
            setRole(assignment.playerId, assignment.role);
            setMafia(assignment.playerId, assignment.role === 'MAFIA');
          }
        }
        if (Array.isArray(data.mafiaTeam)) {
          for (const pid of data.mafiaTeam as unknown[]) {
            if (typeof pid !== 'string') continue;
            actorIds.add(pid);
            setMafia(pid, true);
          }
        }
      }

      // 2. MORNING_REVEAL deaths — full player objects with role/isMafia/isAlive
      if (event.type === 'MORNING_REVEAL' && Array.isArray(data.deaths)) {
        for (const death of data.deaths as Array<Record<string, unknown>>) {
          if (typeof death.id !== 'string') continue;
          actorIds.add(death.id);
          if (typeof death.role === 'string') setRole(death.id, death.role);
          if (typeof death.isMafia === 'boolean') setMafia(death.id, death.isMafia);
          deadActors.add(death.id);
          if (typeof death.name === 'string' && !nameByActor.has(death.id)) {
            nameByActor.set(death.id, death.name);
          }
        }
      }

      // 3. Sheriff investigation — target roles revealed; actor is the sheriff
      if (Array.isArray(data.targetRoles) && typeof data.targetId === 'string') {
        const roles = data.targetRoles as string[];
        const primaryRole = roles.length === 1 ? roles[0] : (roles.includes('MAFIA') ? 'MAFIA' : roles[0]);
        actorIds.add(data.targetId);
        setRole(data.targetId, primaryRole);
        setMafia(data.targetId, roles.includes('MAFIA'));
        if (actorId) {
          setRole(actorId, 'SHERIFF');
          setMafia(actorId, false);
        }
      }

      // 4. Doctor protection — actor is the doctor
      if (actorId &&
          typeof data.reason === 'string' &&
          typeof data.targetId === 'string' &&
          !Array.isArray(data.targetRoles)) {
        setRole(actorId, 'DOCTOR');
        setMafia(actorId, false);
      }

      // 5. Vigilante action — actor is the vigilante
      if (actorId && (data.action === 'SHOOT' || data.action === 'PASS')) {
        setRole(actorId, 'VIGILANTE');
        setMafia(actorId, false);
      }

      // 6. Mafia chat — PRIVATE legacy MESSAGE events only come from the
      //    MAFIA_CHAT phase, so the actor is mafia
      if (actorId &&
          event.type === 'AGENT_SAYS_BROADCASTED' &&
          event.visibility === 'PRIVATE' &&
          (data.legacyType === 'MESSAGE' || data.legacyType === 'MAFIA_CHAT')) {
        setRole(actorId, 'MAFIA');
        setMafia(actorId, true);
      }

      // 7. Generic role-carrying payloads (PLAYER_LYNCHED, MAFIA_KILL_SUCCEEDED, ...)
      if (typeof data.role === 'string') {
        if (typeof data.playerId === 'string') {
          actorIds.add(data.playerId);
          setRole(data.playerId, data.role);
        } else if (typeof data.targetId === 'string') {
          actorIds.add(data.targetId);
          setRole(data.targetId, data.role);
        } else if (actorId) {
          setRole(actorId, data.role);
        }
      }
      if (typeof data.targetRole === 'string' && typeof data.targetId === 'string') {
        actorIds.add(data.targetId);
        setRole(data.targetId, data.targetRole);
      }
    }

    return Array.from(actorIds).map((id, index) => ({
      id,
      name: nameByActor.get(id) || `Player ${id.substring(0, 8)}`,
      role: roleByActor.get(id) || 'UNASSIGNED',
      isMafia: mafiaByActor.get(id) ?? false,
      isAlive: !deadActors.has(id),
      joinOrder: index,
    }));
  }
}

export default LegacyGameAdapter;
