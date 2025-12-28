/**
 * Game Repository
 * 
 * Database operations for games, players, and events.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Game, Player, GameEvent, GameConfig, PlayerStats } from '@mafia/shared/types';

export class GameRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
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
   * Get game by ID
   */
  getGame(gameId: string): Game | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Record<string, unknown>;
    
    if (!row) return null;
    
    const players = this.getPlayers(gameId);
    const events = this.getEvents(gameId);
    
    return {
      id: row.id as string,
      createdAt: new Date(row.created_at as number),
      startedAt: row.started_at ? new Date(row.started_at as number) : undefined,
      endedAt: row.ended_at ? new Date(row.ended_at as number) : undefined,
      status: row.status as Game['status'],
      players,
      config: JSON.parse(row.config as string),
      currentState: {
        phase: 'SETUP',
        dayNumber: 1,
        turnNumber: 1,
        timeRemaining: 0,
        activePlayers: players.filter(p => p.isAlive).map(p => p.id),
        eliminatedPlayers: [],
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
   * Update player role
   */
  updatePlayerRole(playerId: string, role: Player['role'], isMafia: boolean): void {
    this.db.prepare(`
      UPDATE players SET role = ?, is_mafia = ? WHERE id = ?
    `).run(role, isMafia ? 1 : 0, playerId);
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
    avgDuration: number;
    mafiaWins: number;
    townWins: number;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM games').get() as { count: number };
    const active = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE status = 'IN_PROGRESS'").get() as { count: number };
    const completed = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE status = 'ENDED'").get() as { count: number };
    const avgDuration = this.db.prepare('SELECT AVG(duration) as avg FROM games WHERE duration IS NOT NULL').get() as { avg: number | null };
    const mafiaWins = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE winner = 'MAFIA'").get() as { count: number };
    const townWins = this.db.prepare("SELECT COUNT(*) as count FROM games WHERE winner = 'TOWN'").get() as { count: number };
    
    return {
      totalGames: total.count,
      activeGames: active.count,
      completedGames: completed.count,
      avgDuration: avgDuration.avg || 0,
      mafiaWins: mafiaWins.count,
      townWins: townWins.count,
    };
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
  }> {
    const rows = this.db.prepare(`
      SELECT 
        provider,
        model,
        COUNT(*) as games_played,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        AVG(tokens_used) as avg_tokens,
        AVG(
          SELECT AVG(cost) FROM token_usage 
          WHERE game_id = players.game_id AND player_id = players.id
        ) as avg_cost
      FROM players
      WHERE provider IS NOT NULL
      GROUP BY provider, model
      ORDER BY games_played DESC
    `).all() as Record<string, unknown>[];
    
    return rows.map(row => ({
      provider: row.provider as string,
      model: row.model as string,
      gamesPlayed: row.games_played as number,
      wins: row.wins as number,
      winRate: row.games_played > 0 ? (row.wins as number) / (row.games_played as number) : 0,
      avgTokens: row.avg_tokens as number || 0,
      avgCost: row.avg_cost as number || 0,
    }));
  }
}

export default GameRepository;
