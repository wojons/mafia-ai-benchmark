/**
 * Game Repository
 * 
 * Database operations for games, players, and events.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Game, Player, GameEvent, GameConfig, PlayerStats } from '@mafia/shared/types';

/** Row shape from player_model_assignments table. */
export interface PlayerModelAssignmentRow {
  id: string;
  game_id: string;
  player_id: string | null;
  player_name: string | null;
  role: string | null;
  player_index: number | null;
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  priority: number;
  created_at: number;
}

export class GameRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }

  getDatabase(): Database.Database {
    return this.db;
  }
  
  // ==================== GAMES ====================
  
  /**
   * Create a new game
   */
  createGame(config: GameConfig): Game {
    const gameId = uuidv4();
    const now = Date.now();
    
    this.db.prepare(`
      INSERT INTO games (id, status, config, created_at)
      VALUES (?, 'SETUP', ?, ?)
    `).run(gameId, JSON.stringify(config), now);
    
    return {
      id: gameId,
      createdAt: new Date(now),
      status: 'SETUP',
      players: [],
      config,
      currentState: {
        phase: 'SETUP',
        dayNumber: 1,
        turnNumber: 1,
        timeRemaining: 0,
        activePlayers: [],
        eliminatedPlayers: [],
        votes: [],
        nightActions: [],
      },
      events: [],
    };
  }
  
  /**
   * Derive the ids of every eliminated player from the game's event
   * stream (MAF-GAP-044). Death events (MORNING_REVEAL night deaths and
   * per-death elimination events PLAYER_LYNCHED / PLAYER_ELIMINATED /
   * PLAYER_KILLED) carry full player objects in data.deaths; each death's
   * id is eliminated. Order follows the event stream (insertion order).
   */
  private deriveEliminatedPlayerIds(events: GameEvent[]): string[] {
    const eliminated = new Set<string>();
    for (const event of events) {
      const isDeathEvent = event.type === 'MORNING_REVEAL'
        || event.type === 'PLAYER_LYNCHED'
        || event.type === 'PLAYER_ELIMINATED'
        || event.type === 'PLAYER_KILLED';
      if (!isDeathEvent) continue;
      const data = event.data as Record<string, unknown> | undefined;
      if (!data || !Array.isArray(data.deaths)) continue;
      for (const death of data.deaths as Array<Record<string, unknown>>) {
        if (typeof death.id === 'string') eliminated.add(death.id);
      }
    }
    return Array.from(eliminated);
  }

  /**
   * Get game by ID
   */
  getGame(gameId: string): Game | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Record<string, unknown>;
    
    if (!row) return null;
    
    const events = this.getEvents(gameId);
    const players = this.getPlayers(gameId);

    // MAF-GAP-044: eliminated players come from the event stream (death
    // events), never from the hardcoded empty list. The players table
    // rows are persisted at ROLES_ASSIGNED time (is_alive = 1 for all),
    // so the event-derived dead set is overlaid onto the returned players
    // and activePlayers — otherwise eliminations stay invisible in the
    // detail endpoint.
    const eliminatedPlayers = this.deriveEliminatedPlayerIds(events);
    const deadSet = new Set(eliminatedPlayers);
    const playersWithDeaths = players.map(p =>
      deadSet.has(p.id) ? { ...p, isAlive: false } : p,
    );
    
    return {
      id: row.id as string,
      createdAt: new Date(row.created_at as number),
      startedAt: row.started_at ? new Date(row.started_at as number) : undefined,
      endedAt: row.ended_at ? new Date(row.ended_at as number) : undefined,
      status: row.status as Game['status'],
      players: playersWithDeaths,
      config: JSON.parse(row.config as string),
      currentState: {
        // MAF-GAP-044: an ENDED game's phase is GAME_OVER, never SETUP.
        phase: row.status === 'ENDED' ? 'GAME_OVER' : 'SETUP',
        dayNumber: 1,
        turnNumber: 1,
        timeRemaining: 0,
        activePlayers: playersWithDeaths.filter(p => p.isAlive).map(p => p.id),
        eliminatedPlayers,
        votes: [],
        nightActions: [],
      },
      events,
    };
  }
  
  /**
   * Update game status
   */
  updateGameStatus(gameId: string, status: Game['status']): void {
    const updates: Record<string, unknown> = { status };
    
    if (status === 'IN_PROGRESS' || status === 'PAUSED') {
      updates.started_at = Date.now();
    } else if (status === 'ENDED' || status === 'CANCELLED') {
      updates.ended_at = Date.now();
    }
    
    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    
    const values = [...Object.values(updates), gameId];
    
    this.db.prepare(`UPDATE games SET ${setClause} WHERE id = ?`).run(...values);
  }
  
  /**
   * Update game results
   */
  updateGameResults(gameId: string, winner: 'MAFIA' | 'TOWN', stats: {
    duration: number;
    dayCount: number;
    totalTurns: number;
    totalEvents: number;
    totalTokens: number;
    totalCost: number;
  }): void {
    this.db.prepare(`
      UPDATE games SET
        winner = ?,
        duration = ?,
        day_count = ?,
        total_turns = ?,
        total_events = ?,
        total_tokens = ?,
        total_cost = ?,
        ended_at = ?
      WHERE id = ?
    `).run(
      winner,
      stats.duration,
      stats.dayCount,
      stats.totalTurns,
      stats.totalEvents,
      stats.totalTokens,
      stats.totalCost,
      Date.now(),
      gameId
    );
  }
  
  /**
   * List all games with optional filters
   */
  listGames(filters?: { status?: Game['status']; limit?: number; offset?: number }): Game[] {
    let query = 'SELECT * FROM games';
    const conditions: string[] = [];
    const params: unknown[] = [];
    
    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      
      if (filters?.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }
    
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    
    return rows.map(row => this.getGame(row.id as string)!).filter(Boolean);
  }
  
  // ==================== PLAYERS ====================
  
  /**
   * Add player to game
   */
  addPlayer(gameId: string, name: string, agentId?: string, provider?: string, model?: string): Player {
    const playerId = uuidv4();
    const joinOrder = this.db.prepare(
      'SELECT COUNT(*) as count FROM players WHERE game_id = ?'
    ).get(gameId) as { count: number };
    
    this.db.prepare(`
      INSERT INTO players (id, game_id, name, role, is_alive, is_mafia, join_order, agent_id, provider, model)
      VALUES (?, ?, ?, 'UNASSIGNED', 1, 0, ?, ?, ?, ?)
    `).run(playerId, gameId, name, joinOrder.count, agentId, provider, model);
    
    return {
      id: playerId,
      name,
      role: 'UNASSIGNED',
      isAlive: true,
      isMafia: false,
      joinOrder: joinOrder.count,
    };
  }
  
  /**
   * Get players for a game
   */
  getPlayers(gameId: string): Player[] {
    const rows = this.db.prepare(
      'SELECT * FROM players WHERE game_id = ? ORDER BY join_order'
    ).all(gameId) as Record<string, unknown>[];
    
    return rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      role: row.role as Player['role'],
      isAlive: Boolean(row.is_alive),
      isMafia: Boolean(row.is_mafia),
      joinOrder: row.join_order as number,
    }));
  }

  /**
   * Insert or replace a player row with a KNOWN id (MAF-GAP-043B).
   *
   * The legacy bridge persists players from the ROLES_ASSIGNED roster,
   * where the row id MUST match the id used in the event stream (actorId)
   * so event-derived players and table rows stay consistent. addPlayer()
   * cannot be used for that: it generates its own id and cannot set
   * role/is_mafia/join_order. won is left untouched (NULL) — setPlayersWon
   * fills it at game end.
   */
  upsertPlayer(gameId: string, player: {
    id: string;
    name: string;
    role: string;
    isMafia: boolean;
    joinOrder: number;
    provider?: string;
    model?: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO players
        (id, game_id, name, role, is_alive, is_mafia, join_order, agent_id, provider, model)
      VALUES (?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)
    `).run(
      player.id,
      gameId,
      player.name,
      player.role,
      player.isMafia ? 1 : 0,
      player.joinOrder,
      player.provider ?? null,
      player.model ?? null,
    );
  }

  /**
   * Backfill provider/model on a player row ONLY when they are NULL
   * (MAF-GAP-043B). Used at game end to attach the real engine-tracked
   * per-player model (bridge usageByPlayer) to rows the request config
   * could not name. Config-derived attribution is never overwritten.
   */
  backfillPlayerModel(playerId: string, provider: string, model: string): void {
    this.db.prepare(`
      UPDATE players
      SET provider = COALESCE(provider, ?), model = COALESCE(model, ?)
      WHERE id = ?
    `).run(provider, model, playerId);
  }
  
  /**
   * Update player role
   */
  updatePlayerRole(playerId: string, role: Player['role'], isMafia: boolean): void {
    this.db.prepare(`
      UPDATE players SET role = ?, is_mafia = ? WHERE id = ?
    `).run(role, isMafia ? 1 : 0, playerId);
  }

  /**
   * Set won (1/0) for every player of a game based on the game's winner
   * (MAF-GAP-043).
   *
   * The insert path never writes the won column (defaults NULL), so
   * per-model win rates were always 0 — the report's players-table branch
   * reads SUM(CASE WHEN p.won = 1 ...) and side attribution also depends
   * on non-null won. Both sides are written EXPLICITLY: the winning side
   * gets 1 and the losing side 0, so ENDED games never carry NULL won.
   *
   * Only called at game end (never for IN_PROGRESS games). Games with no
   * players rows (legacy usage-only games) are a graceful no-op.
   */
  setPlayersWon(gameId: string, winner: 'MAFIA' | 'TOWN'): void {
    const mafiaWon = winner === 'MAFIA' ? 1 : 0;
    const townWon = winner === 'MAFIA' ? 0 : 1;
    this.db.prepare(`
      UPDATE players SET won = CASE
        WHEN is_mafia = 1 THEN ?
        ELSE ?
      END
      WHERE game_id = ?
    `).run(mafiaWon, townWon, gameId);
  }
  
  /**
   * Eliminate player
   */
  eliminatePlayer(playerId: string): void {
    this.db.prepare('UPDATE players SET is_alive = 0 WHERE id = ?').run(playerId);
  }
  
  /**
   * Update player stats
   */
  updatePlayerStats(playerId: string, stats: Partial<PlayerStats>): void {
    const setClause = Object.keys(stats)
      .map(key => `${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`)
      .join(', ');
    
    const values = Object.values(stats);
    
    this.db.prepare(`UPDATE players SET ${setClause} WHERE id = ?`).run(...values, playerId);
  }
  
  // ==================== EVENTS ====================
  
  /**
   * Add event to game
   */
  addEvent(gameId: string, event: Omit<GameEvent, 'id' | 'gameId' | 'timestamp'>): GameEvent {
    const eventId = uuidv4();
    const now = Date.now();
    
    this.db.prepare(`
      INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      gameId,
      event.type,
      now,
      event.visibility,
      event.actorId || null,
      event.targetId || null,
      JSON.stringify(event.data),
      event.metadata.turnNumber,
      event.metadata.dayNumber,
      event.metadata.phase,
      event.metadata.sequence
    );
    
    return {
      ...event,
      id: eventId,
      gameId,
      timestamp: new Date(now),
    };
  }
  
  /**
   * Get events for a game
   */
  getEvents(gameId: string): GameEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE game_id = ? ORDER BY sequence'
    ).all(gameId) as Record<string, unknown>[];
    
    return rows.map(row => ({
      id: row.id as string,
      gameId: row.game_id as string,
      type: row.type as GameEvent['type'],
      timestamp: new Date(row.timestamp as number),
      visibility: row.visibility as GameEvent['visibility'],
      actorId: row.actor_id as string | undefined,
      targetId: row.target_id as string | undefined,
      data: JSON.parse(row.data as string),
      metadata: {
        turnNumber: row.turn_number as number,
        dayNumber: row.day_number as number,
        phase: row.phase as GameEvent['metadata']['phase'],
        sequence: row.sequence as number,
      },
    }));
  }
  
  /**
   * Get events by type
   */
  getEventsByType(gameId: string, type: GameEvent['type']): GameEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE game_id = ? AND type = ? ORDER BY sequence'
    ).all(gameId, type) as Record<string, unknown>[];
    
    return rows.map(row => ({
      id: row.id as string,
      gameId: row.game_id as string,
      type: row.type as GameEvent['type'],
      timestamp: new Date(row.timestamp as number),
      visibility: row.visibility as GameEvent['visibility'],
      actorId: row.actor_id as string | undefined,
      targetId: row.target_id as string | undefined,
      data: JSON.parse(row.data as string),
      metadata: {
        turnNumber: row.turn_number as number,
        dayNumber: row.day_number as number,
        phase: row.phase as GameEvent['metadata']['phase'],
        sequence: row.sequence as number,
      },
    }));
  }
  
  /**
   * Get next event sequence number
   */
  getNextSequence(gameId: string): number {
    const result = this.db.prepare(
      'SELECT MAX(sequence) as max_seq FROM events WHERE game_id = ?'
    ).get(gameId) as { max_seq: number | null };
    
    return (result.max_seq || 0) + 1;
  }
  
  // ==================== STATISTICS ====================
  
  /**
   * Get game statistics
   */
  getGameStats(): {
    totalGames: number;
    activeGames: number;
    completedGames: number;
    failedGames: number;
    avgDuration: number;
    mafiaWins: number;
    townWins: number;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM games').get() as { count: number };
    const active = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE status = 'IN_PROGRESS'").get() as { count: number };
    const completed = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE status = 'ENDED'").get() as { count: number };
    // MAF-GAP-050: any status that is neither IN_PROGRESS nor ENDED
    // (SETUP, PAUSED, CANCELLED, or anything unexpected) is a "failed"
    // game — it never reached a terminal outcome. Counting by exclusion
    // keeps totalGames == activeGames + completedGames + failedGames true
    // by construction, so the summary always reconciles.
    const failed = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE status NOT IN ('IN_PROGRESS','ENDED')").get() as { count: number };
    const avgDuration = this.db.prepare("SELECT AVG(duration) as avg FROM games WHERE status = 'ENDED' AND duration IS NOT NULL").get() as { avg: number | null };
    const mafiaWins = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE winner = 'MAFIA'").get() as { count: number };
    const townWins = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE winner = 'TOWN'").get() as { count: number };
    
    return {
      totalGames: total.count,
      activeGames: active.count,
      completedGames: completed.count,
      failedGames: failed.count,
      // games.duration is stored in milliseconds; the API contract exposes
      // avgDuration in SECONDS (MAF-GAP-026). Round to the nearest second.
      avgDuration: Math.round((avgDuration.avg || 0) / 1000),
      mafiaWins: mafiaWins.count,
      townWins: townWins.count,
    };
  }

  /**
   * List games that never reached a terminal outcome (MAF-GAP-050) —
   * statuses other than IN_PROGRESS/ENDED (SETUP, PAUSED, CANCELLED, or
   * unknown). Exposed so stuck / no-winner games are auditable instead of
   * being invisible inside the totalGames count. Ordered by creation time.
   */
  getFailedGames(): Array<{
    id: string;
    status: string;
    createdAt: Date;
    endedAt: Date | null;
  }> {
    const rows = this.db.prepare(
      `SELECT id, status, created_at, ended_at FROM games
       WHERE status NOT IN ('IN_PROGRESS','ENDED')
       ORDER BY created_at, id`
    ).all() as Record<string, unknown>[];
    
    return rows.map(row => ({
      id: row.id as string,
      status: row.status as string,
      createdAt: new Date(row.created_at as number),
      endedAt: row.ended_at === null || row.ended_at === undefined
        ? null
        : new Date(row.ended_at as number),
    }));
  }
  
  /**
   * Get model performance
   */
  getModelStats(): Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    winRate: number;
    avgTokens: number;
    avgCost: number;
    avgLatency: number;
  }> {
    // MAF-GAP-012: the previous query nested AVG(SELECT AVG(cost) ...)
    // inside AVG() — invalid SQLite syntax that threw at runtime and
    // masked real data. Use a LEFT JOIN with a correlated subquery so
    // avg_cost is the mean per-player cost from token_usage.
    //
    // MAF-GAP-048: games_played and wins count DISTINCT games, not player
    // rows — a game with 4 town winners of the same model previously
    // inflated wins to 4 (SUM over won player rows) and games_played to
    // the player-row count. Documented semantics (api-specs.md,
    // MAF-GAP-036/039): one win per game per model.
    //
    // The model key is normalized before grouping (same expression as
    // normalizedModelSql in stats-collector/models.ts, MAF-GAP-036) so
    // provider-prefixed spellings (provider='openai', model='openai/gpt-4o-mini'
    // vs model='gpt-4o-mini') merge into ONE row instead of producing
    // duplicate/contradictory entries. The returned model string is the
    // normalized spelling, matching what getModelComparison keys on.
    const pExpr =
      `CASE WHEN p.model LIKE p.provider || '/%' ` +
      `THEN substr(p.model, length(p.provider) + 2) ELSE p.model END`;
    const rows = this.db.prepare(`
      SELECT 
        p.provider,
        ${pExpr} as model,
        COUNT(DISTINCT p.game_id) as games_played,
        COUNT(DISTINCT CASE WHEN p.won = 1 THEN p.game_id END) as wins,
        AVG(p.tokens_used) as avg_tokens,
        COALESCE(AVG((
          SELECT AVG(tu.cost) FROM token_usage tu
          WHERE tu.game_id = p.game_id AND tu.player_id = p.id
        )), 0) as avg_cost,
        COALESCE(AVG((
          SELECT AVG(ac.latency) FROM api_calls ac
          WHERE ac.game_id = p.game_id AND ac.provider = p.provider AND ac.model = p.model
            AND ac.latency >= 50
        )), 0) as avg_latency
      FROM players p
      WHERE p.provider IS NOT NULL
      GROUP BY p.provider, ${pExpr}
      ORDER BY games_played DESC
    `).all() as Record<string, unknown>[];
    
    return rows.map(row => ({
      provider: row.provider as string,
      model: row.model as string,
      gamesPlayed: row.games_played as number,
      wins: row.wins as number,
      winRate: (row.games_played as number) > 0 ? (row.wins as number) / (row.games_played as number) : 0,
      avgTokens: row.avg_tokens as number || 0,
      avgCost: row.avg_cost as number || 0,
      avgLatency: row.avg_latency as number || 0,
    }));
  }

  // ==================== PLAYER MODEL ASSIGNMENTS ====================

  /**
   * Assign a model to a specific player slot.
   * Inserts or replaces the player_model_assignments row for this game + playerIndex.
   */
  assignPlayerModel(
    gameId: string,
    playerIndex: number,
    config: { provider: string; model: string; temperature?: number; maxTokens?: number; priority?: number; playerName?: string }
  ): PlayerModelAssignmentRow {
    const id = uuidv4();
    const now = Date.now();
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens ?? 500;
    const priority = config.priority ?? 0;

    this.db.prepare(`
      INSERT OR REPLACE INTO player_model_assignments
        (id, game_id, player_index, provider, model, temperature, max_tokens, priority, player_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, gameId, playerIndex, config.provider, config.model, temperature, maxTokens, priority, config.playerName || null, now);

    return this.db.prepare('SELECT * FROM player_model_assignments WHERE id = ?').get(id) as PlayerModelAssignmentRow;
  }

  /**
   * Assign a model to all players with a given role.
   */
  assignRoleModel(
    gameId: string,
    role: string,
    config: { provider: string; model: string; temperature?: number; maxTokens?: number; priority?: number }
  ): PlayerModelAssignmentRow {
    const id = uuidv4();
    const now = Date.now();
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens ?? 500;
    const priority = config.priority ?? 0;

    this.db.prepare(`
      INSERT INTO player_model_assignments
        (id, game_id, role, provider, model, temperature, max_tokens, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, gameId, role.toUpperCase(), config.provider, config.model, temperature, maxTokens, priority, now);

    return this.db.prepare('SELECT * FROM player_model_assignments WHERE id = ?').get(id) as PlayerModelAssignmentRow;
  }

  /**
   * Assign models to multiple slots in a batch.
   */
  bulkAssignModels(
    gameId: string,
    assignments: Array<{ playerIndex?: number; role?: string; provider: string; model: string; temperature?: number; maxTokens?: number; priority?: number }>
  ): Array<{ success: boolean; data?: PlayerModelAssignmentRow; error?: string }> {
    const now = Date.now();

    return assignments.map((a, idx) => {
      if (!a.provider || !a.model) {
        return { success: false, error: `Entry ${idx}: provider and model are required` };
      }
      const id = uuidv4();
      const temperature = a.temperature ?? 0.7;
      const maxTokens = a.maxTokens ?? 500;
      const priority = a.priority ?? 0;

      try {
        this.db.prepare(`
          INSERT OR REPLACE INTO player_model_assignments
            (id, game_id, player_index, role, provider, model, temperature, max_tokens, priority, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, gameId, a.playerIndex ?? null, (a.role ?? null) as string | null, a.provider, a.model, temperature, maxTokens, priority, now);

        const row = this.db.prepare('SELECT * FROM player_model_assignments WHERE id = ?').get(id) as PlayerModelAssignmentRow;
        return { success: true, data: row };
      } catch (err) {
        return { success: false, error: `Entry ${idx}: ${(err as Error).message}` };
      }
    });
  }

  /**
   * Get all model assignments for a game.
   */
  getGameModelAssignments(gameId: string): PlayerModelAssignmentRow[] {
    return this.db.prepare(
      'SELECT * FROM player_model_assignments WHERE game_id = ? ORDER BY player_index ASC, created_at ASC'
    ).all(gameId) as PlayerModelAssignmentRow[];
  }
}

export default GameRepository;
