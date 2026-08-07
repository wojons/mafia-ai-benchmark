/**
 * Shared mocks/fakes for service unit tests.
 *
 * These are hand-rolled fakes (no vi.mock) that implement the same surface
 * the real services depend on, so the tests exercise the actual service code
 * without needing SQLite, child processes, or network calls.
 */
import { EventEmitter } from 'events';
import type {
  Game,
  Player,
  GameEvent,
  GameConfig,
  GameState,
  AgentResponse,
  RoleType,
} from '@mafia/shared/types';
import type { EventBus } from '../../services/event-bus.js';
import type { StatsCollector } from '../../services/stats-collector.js';
import type { AgentCoordinator, AgentConfig, AgentExecutionResult } from '../../services/agent-coordinator.js';
import type { LegacyGameAdapter, LegacyGameConfig } from '../../services/legacy-game-adapter.js';

// ---------------------------------------------------------------------------
// EventBus fake — uses a real EventEmitter + a history array so subscribe /
// publish / getGameEvents work the way the production EventBus does.
// ---------------------------------------------------------------------------

export function createFakeEventBus(): EventBus & {
  published: GameEvent[];
  reset(): void;
  emitEvent(event: GameEvent): void;
} {
  const emitter = new EventEmitter();
  const published: GameEvent[] = [];
  const subscriptions = new Map<string, Set<(e: GameEvent) => void>>();
  const history: GameEvent[] = [];

  const fake: any = {
    published,
    reset() {
      published.length = 0;
      history.length = 0;
      subscriptions.clear();
      emitter.removeAllListeners();
    },
    publish(event: GameEvent) {
      published.push(event);
      history.push(event);
      const subs = subscriptions.get(event.type);
      if (subs) for (const fn of subs) fn(event);
      const all = subscriptions.get('*');
      if (all) for (const fn of all) fn(event);
      emitter.emit(event.type, event);
      emitter.emit('*', event);
      return event.id;
    },
    subscribe(eventType: string | string[], handler: (e: GameEvent) => void) {
      const id = Math.random().toString(36).slice(2);
      const types = Array.isArray(eventType) ? eventType : [eventType];
      for (const t of types) {
        if (!subscriptions.has(t)) subscriptions.set(t, new Set());
        subscriptions.get(t)!.add(handler);
      }
      const unsub = () => {
        for (const t of types) subscriptions.get(t)?.delete(handler);
      };
      (unsub as any).id = id;
      return unsub;
    },
    unsubscribe(id: string) {
      // no-op — sufficient for tests that don't unsubscribe by id
    },
    getGameEvents(gameId: string, opts?: { limit?: number; eventType?: string }) {
      let events = history.filter(e => e.gameId === gameId);
      if (opts?.eventType) events = events.filter(e => e.type === opts.eventType);
      if (opts?.limit) events = events.slice(-opts.limit);
      return events;
    },
    getEventHistory() {
      return [...history];
    },
    getStats() {
      return {
        totalEvents: history.length,
        totalSubscriptions: subscriptions.size,
        eventsByType: new Map<string, number>(),
      };
    },
    emitEvent(event: GameEvent) {
      this.publish(event);
    },
  };

  return fake as EventBus & {
    published: GameEvent[];
    reset(): void;
    emitEvent(event: GameEvent): void;
  };
}

// ---------------------------------------------------------------------------
// GameRepository fake — in-memory map of games, players, events.
// Implements just the methods the services actually call.
// ---------------------------------------------------------------------------

let gameCounter = 0;
let eventCounter = 0;

function makeEvent(partial: Partial<GameEvent> & Pick<GameEvent, 'type' | 'gameId'>): GameEvent {
  eventCounter += 1;
  return {
    id: `evt-${eventCounter}`,
    gameId: partial.gameId,
    type: partial.type,
    timestamp: partial.timestamp ?? new Date(),
    visibility: partial.visibility ?? 'PUBLIC',
    actorId: partial.actorId,
    targetId: partial.targetId,
    data: partial.data ?? {},
    metadata: partial.metadata ?? {
      turnNumber: 1,
      dayNumber: 1,
      phase: 'SETUP',
      sequence: eventCounter,
    },
  };
}

function makePlayer(partial: Partial<Player> & { name: string; gameId: string }): Player {
  const id = partial.id ?? `player-${++gameCounter}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: partial.name,
    role: partial.role ?? 'UNASSIGNED',
    isAlive: partial.isAlive ?? true,
    isMafia: partial.isMafia ?? false,
    joinOrder: partial.joinOrder ?? 0,
    ...partial,
  } as Player;
}

function makeGame(partial: Partial<Game> & { config: GameConfig }): Game {
  const id = partial.id ?? `game-${++gameCounter}`;
  const events = partial.events ?? [];
  const players = partial.players ?? [];
  return {
    id,
    createdAt: partial.createdAt ?? new Date(),
    startedAt: partial.startedAt,
    endedAt: partial.endedAt,
    status: partial.status ?? 'SETUP',
    players,
    config: partial.config,
    currentState: partial.currentState ?? {
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

export interface FakeRepositoryOptions {
  /** Pre-seed games keyed by ID. Useful for getGame paths. */
  games?: Game[];
  /** Custom UUID generator (defaults to deterministic counter). */
  idFactory?: () => string;
}

export function createFakeGameRepository(options: FakeRepositoryOptions = {}): GameRepository & {
  _state: {
    games: Map<string, Game>;
    events: GameEvent[];
    players: Map<string, Player>; // by id
    sequences: Map<string, number>;
  };
  /** Test helper: pre-seed a game with players. */
  seedGame(game: Game): void;
  /** Test helper: get all events across all games. */
  getAllEvents(): GameEvent[];
  /** Test helper: spy/counter for addEvent calls. */
  addEventSpy: { calls: number };
  /** Test helper: spy/counter for updateGameStatus calls. */
  statusUpdates: Array<{ gameId: string; status: string }>;
} {
  const games = new Map<string, Game>();
  const events: GameEvent[] = [];
  const players = new Map<string, Player>();
  const sequences = new Map<string, number>();
  const statusUpdates: Array<{ gameId: string; status: string }> = [];
  const addEventSpy = { calls: 0 };

  for (const g of options.games ?? []) {
    games.set(g.id, g);
    for (const p of g.players) players.set(p.id, p);
  }

  const repo: any = {
    _state: { games, events, players, sequences },
    addEventSpy,
    statusUpdates,
    seedGame(game: Game) {
      games.set(game.id, game);
      for (const p of game.players) players.set(p.id, p);
    },
    getAllEvents() {
      return [...events];
    },

    // --- methods used by services ---
    createGame(config: GameConfig): Game {
      const id = `game-${++gameCounter}`;
      const game = makeGame({ id, config });
      games.set(id, game);
      return game;
    },
    getGame(gameId: string): Game | null {
      const g = games.get(gameId);
      if (!g) return null;
      // Re-attach latest events list (events stored centrally).
      const latest = events.filter(e => e.gameId === gameId);
      return { ...g, events: latest };
    },
    updateGameStatus(gameId: string, status: Game['status']) {
      statusUpdates.push({ gameId, status });
      const g = games.get(gameId);
      if (g) {
        g.status = status;
        if (status === 'IN_PROGRESS') g.startedAt = new Date();
        if (status === 'ENDED' || status === 'CANCELLED') g.endedAt = new Date();
      }
    },
    updateGameResults(
      gameId: string,
      winner: 'MAFIA' | 'TOWN',
      stats: {
        duration: number;
        dayCount: number;
        totalTurns: number;
        totalEvents: number;
        totalTokens: number;
        totalCost: number;
      }
    ) {
      const g = games.get(gameId);
      if (g) {
        (g as any).winner = winner;
        (g as any).duration = stats.duration;
        (g as any).dayCount = stats.dayCount;
        (g as any).totalTurns = stats.totalTurns;
        (g as any).totalEvents = stats.totalEvents;
        (g as any).totalTokens = stats.totalTokens;
        (g as any).totalCost = stats.totalCost;
      }
    },
    addPlayer(
      gameId: string,
      name: string,
      agentId?: string,
      provider?: string,
      model?: string
    ): Player {
      const player = makePlayer({
        id: `player-${++gameCounter}`,
        name,
        gameId,
        joinOrder: players.size,
        agentId,
        provider,
        model,
      } as any);
      players.set(player.id, player);
      const g = games.get(gameId);
      if (g) g.players = [...g.players, player];
      return player;
    },
    getPlayers(gameId: string): Player[] {
      const g = games.get(gameId);
      return g ? [...g.players] : [];
    },
    updatePlayerRole(playerId: string, role: RoleType, isMafia: boolean) {
      const p = players.get(playerId);
      if (p) {
        p.role = role;
        p.isMafia = isMafia;
      }
    },
    eliminatePlayer(playerId: string) {
      const p = players.get(playerId);
      if (p) p.isAlive = false;
    },
    updatePlayerStats(playerId: string, stats: Record<string, unknown>) {
      const p = players.get(playerId);
      if (!p) return;
      Object.assign(p, stats);
    },
    addEvent(gameId: string, event: Omit<GameEvent, 'id' | 'gameId' | 'timestamp'>): GameEvent {
      addEventSpy.calls += 1;
      const seq = (sequences.get(gameId) ?? 0) + 1;
      sequences.set(gameId, seq);
      const stored = makeEvent({
        ...event,
        gameId,
        metadata: { ...event.metadata, sequence: seq },
      } as any);
      events.push(stored);
      const g = games.get(gameId);
      if (g) g.events = [...g.events, stored];
      return stored;
    },
    getEvents(gameId: string): GameEvent[] {
      return events.filter(e => e.gameId === gameId);
    },
    getEventsByType(gameId: string, type: GameEvent['type']): GameEvent[] {
      return events.filter(e => e.gameId === gameId && e.type === type);
    },
    getNextSequence(gameId: string): number {
      return (sequences.get(gameId) ?? 0) + 1;
    },

    // --- stats/aggregation methods (basic implementation for tests) ---
    getGameStats() {
      const all = Array.from(games.values());
      const ended = all.filter(g => g.status === 'ENDED');
      const active = all.filter(g => g.status === 'IN_PROGRESS').length;
      const durations = ended
        .map(g => (g.endedAt && g.startedAt ? g.endedAt.getTime() - g.startedAt.getTime() : 0))
        .filter(d => d > 0);
      const mafiaWins = ended.filter(g => (g as any).winner === 'MAFIA').length;
      const townWins = ended.filter(g => (g as any).winner === 'TOWN').length;
      return {
        totalGames: all.length,
        activeGames: active,
        completedGames: ended.length,
        avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        mafiaWins,
        townWins,
      };
    },
    getModelStats() {
      // Aggregate tokens/wins from in-memory events. Tests can override per test.
      const modelMap = new Map<string, { provider: string; model: string; gamesPlayed: number; wins: number }>();
      const allEvents = events.filter(e => e.type === 'AGENT_SAYS_BROADCASTED');
      const providerByGame = new Map<string, Map<string, string>>(); // gameId -> playerId -> model
      for (const g of games.values()) {
        const m = new Map<string, string>();
        for (const p of g.players) {
          if ((p as any).provider && (p as any).model) {
            m.set(p.id, `${(p as any).provider}::${(p as any).model}`);
          }
        }
        providerByGame.set(g.id, m);
      }
      for (const e of allEvents) {
        const map = providerByGame.get(e.gameId);
        if (!map || !e.actorId) continue;
        const key = map.get(e.actorId);
        if (!key) continue;
        const [provider, model] = key.split('::');
        const k = `${provider}/${model}`;
        const cur = modelMap.get(k) ?? { provider, model, gamesPlayed: 0, wins: 0 };
        cur.gamesPlayed += 1;
        modelMap.set(k, cur);
      }
      return Array.from(modelMap.values()).map(m => ({
        provider: m.provider,
        model: m.model,
        gamesPlayed: m.gamesPlayed,
        wins: m.wins,
        winRate: m.gamesPlayed > 0 ? m.wins / m.gamesPlayed : 0,
        avgTokens: 0,
        avgCost: 0,
        avgLatency: 0,
      }));
    },
    listGames(filters?: { status?: Game['status']; limit?: number; offset?: number }) {
      let list = Array.from(games.values());
      if (filters?.status) list = list.filter(g => g.status === filters.status);
      list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (filters?.limit) {
        list = list.slice(filters.offset ?? 0, (filters.offset ?? 0) + filters.limit);
      }
      return list;
    },

    // --- minimal db stub for any code path that touches getDatabase() ---
    getDatabase() {
      return null as any;
    },
  };

  return repo as GameRepository & typeof repo;
}

// ---------------------------------------------------------------------------
// StatsCollector fake — records calls; trivial implementations of read APIs.
// ---------------------------------------------------------------------------

export function createFakeStatsCollector(): StatsCollector & {
  tokenUsage: any[];
  apiCalls: any[];
  sessions: any[];
  agentStats: any[];
  totalTokensByGame: Map<string, number>;
  totalCostByGame: Map<string, number>;
} {
  const tokenUsage: any[] = [];
  const apiCalls: any[] = [];
  const sessions: any[] = [];
  const agentStats: any[] = [];
  const totalTokensByGame = new Map<string, number>();
  const totalCostByGame = new Map<string, number>();

  const fake: any = {
    tokenUsage,
    apiCalls,
    sessions,
    agentStats,

    recordTokenUsage(record: any) {
      tokenUsage.push(record);
      totalTokensByGame.set(
        record.gameId,
        (totalTokensByGame.get(record.gameId) ?? 0) + (record.totalTokens ?? 0)
      );
      totalCostByGame.set(
        record.gameId,
        (totalCostByGame.get(record.gameId) ?? 0) + (record.cost ?? 0)
      );
    },
    recordAPICall(record: any) {
      apiCalls.push(record);
    },
    recordAgentSession(record: any) {
      sessions.push(record);
    },
    getAgentStats() {
      return [...agentStats];
    },
    getTotalTokens(gameId: string) {
      return totalTokensByGame.get(gameId) ?? 0;
    },
    getTotalCost(gameId: string) {
      return totalCostByGame.get(gameId) ?? 0;
    },
    getPlayerTokenUsage(_gameId: string, playerId: string) {
      return tokenUsage.filter(t => t.playerId === playerId);
    },
    getGameAPICalls(gameId: string) {
      return apiCalls.filter(c => c.gameId === gameId);
    },
    getAPIErrorRate(gameId: string) {
      const calls = apiCalls.filter(c => c.gameId === gameId);
      if (!calls.length) return 0;
      const errors = calls.filter(c => c.error).length;
      return errors / calls.length;
    },
    getPlayerPerformance() {
      return null;
    },
    getGameStats() {
      return {
        totalGames: 0,
        activeGames: 0,
        completedGames: 0,
        avgDuration: 0,
        mafiaWins: 0,
        townWins: 0,
      };
    },
    getModelComparison() {
      return [];
    },
    getCompareReport() {
      return { models: [], headToHead: [], trends: [] };
    },
    getMatchups() {
      return [];
    },
    generateReport() {
      return { generatedAt: new Date().toISOString(), summary: {} };
    },
    exportJSON(gameId?: string) {
      return JSON.stringify({ gameId: gameId ?? null });
    },
    exportCSV() {
      return '';
    },
    getExportReport() {
      return {
        generatedAt: new Date().toISOString(),
        summary: {
          totalGames: 0,
          activeGames: 0,
          completedGames: 0,
          mafiaWins: 0,
          townWins: 0,
          avgDuration: 0,
          totalTokens: 0,
          totalCost: 0,
        },
        games: [],
        modelAggregates: [],
        headToHead: [],
      };
    },
    exportReportCSV() {
      return '';
    },
    // Required by game-engine.endGame
    totalTokensByGame,
    totalCostByGame,
  };

  return fake as any;
}

// ---------------------------------------------------------------------------
// AgentCoordinator fake — minimal interface used by benchmark-runner.
// ---------------------------------------------------------------------------

export interface FakeAgentCoordinator extends AgentCoordinator {
  registered: AgentConfig[];
  assignments: Array<{ playerId: string; agentId: string }>;
}

export function createFakeAgentCoordinator(): FakeAgentCoordinator {
  const registered: AgentConfig[] = [];
  const assignments: Array<{ playerId: string; agentId: string }> = [];

  const fake: any = {
    registered,
    assignments,
    registerAgent(config: AgentConfig) {
      registered.push(config);
    },
    unregisterAgent(agentId: string) {
      const idx = registered.findIndex(a => a.id === agentId);
      if (idx >= 0) registered.splice(idx, 1);
      return idx >= 0;
    },
    assignAgent(playerId: string, agentId: string) {
      assignments.push({ playerId, agentId });
      return true;
    },
    getAgent() {
      return undefined;
    },
    getAgents() {
      return [...registered];
    },
    getAgentStats() {
      return [];
    },
    async executeAgent(): Promise<AgentExecutionResult> {
      return { success: true, latency: 0 };
    },
    async executeAllAgents(): Promise<Map<string, AgentExecutionResult>> {
      return new Map();
    },
  };

  return fake as FakeAgentCoordinator;
}

// ---------------------------------------------------------------------------
// LegacyGameAdapter fake — records startGame calls and returns a synthetic
// LegacyGameState. No child processes are spawned; tests drive completion by
// publishing terminal events on the fake EventBus.
// ---------------------------------------------------------------------------

export interface FakeLegacyGameAdapter extends LegacyGameAdapter {
  started: Array<{
    config: LegacyGameConfig;
    gameId: string;
  }>;
  nextGameId: () => string;
}

export function createFakeLegacyGameAdapter(repo?: { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }): FakeLegacyGameAdapter {
  const started: Array<{ config: LegacyGameConfig; gameId: string }> = [];
  let counter = 0;

  const fake: any = {
    started,
    nextGameId() {
      counter += 1;
      return `legacy-game-${counter}`;
    },
    startGame(config: LegacyGameConfig = {}) {
      counter += 1;
      const gameId = `legacy-game-${counter}`;
      started.push({ config, gameId });
      // Mirror the real adapter: it inserts a games row before returning so
      // the benchmark_games FK (game_id -> games.id) is satisfied.
      if (repo) {
        repo.db
          .prepare(`INSERT INTO games (id, status, config, created_at) VALUES (?, 'IN_PROGRESS', ?, ?)`)
          .run(gameId, JSON.stringify({ numPlayers: config.numPlayers || 5, engineType: 'legacy' }), Date.now());
      }
      return {
        gameId,
        process: null as any,
        eventCount: 0,
        status: 'RUNNING',
        startedAt: new Date(),
      };
    },
    getActiveGames() {
      return started.map((s) => s.gameId);
    },
    getGameState() {
      return undefined;
    },
    stopGame() {
      return false;
    },
    stopAll() {
      // no-op
    },
  };

  return fake as FakeLegacyGameAdapter;
}

// ---------------------------------------------------------------------------
// In-memory SQLite-backed fake repository.
//
// StatsCollector and BenchmarkRunner call `getDatabase().prepare(...)` and
// run real SQL, so the only way to drive them through unit tests is to give
// them an actual `better-sqlite3` instance. This fake wires the production
// GameRepository class against an in-memory DB with the project schema.
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { GameRepository } from '../../db/repository.js';

let schemaSql: string | null = null;
function loadSchema(): string {
  if (!schemaSql) {
    // Resolve schema.sql relative to the test file itself, NOT process.cwd(),
    // so the test passes no matter what working directory vitest is invoked
    // from (pnpm filter, root-level pnpm test, CI, etc.).
    const here = new URL('.', import.meta.url).pathname;
    const candidates = [
      path.resolve(here, '../../db/schema.sql'),
      path.resolve(process.cwd(), 'src/db/schema.sql'),
      path.resolve(process.cwd(), 'apps/server/src/db/schema.sql'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        schemaSql = fs.readFileSync(c, 'utf-8');
        return schemaSql;
      }
    }
    throw new Error(`Could not find schema.sql in any of: ${candidates.join(', ')}`);
  }
  return schemaSql;
}

export function createSqliteBackedRepository(): GameRepository & {
  db: Database.Database;
  seedGame(opts: {
    id: string;
    status?: string;
    winner?: string | null;
    duration?: number | null;
    startedAt?: number;
    endedAt?: number;
    players?: Array<{
      id: string;
      name: string;
      role: string;
      isAlive?: boolean;
      isMafia?: boolean;
      joinOrder: number;
      provider?: string;
      model?: string;
      survived?: number;
      won?: number;
      tokens_used?: number;
      role_performance?: number;
    }>;
    events?: Array<{
      type: string;
      visibility?: string;
      actorId?: string;
      targetId?: string;
      data: unknown;
      dayNumber?: number;
      turnNumber?: number;
      phase?: string;
    }>;
  }): void;
  insertTokenUsage(record: {
    gameId: string;
    playerId: string;
    turnNumber: number;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    timestamp?: number;
  }): void;
  insertApiCall(record: {
    gameId: string;
    playerId: string;
    provider: string;
    model: string;
    endpoint: string;
    latency: number;
    statusCode?: number;
    error?: string;
    timestamp?: number;
  }): void;
  insertAgentSession(record: {
    gameId: string;
    playerId: string;
    turnNumber: number;
    phase: string;
    prompt: string;
    response?: string;
    think?: string;
    says?: string;
    tokensUsed: number;
    promptTokens: number;
    completionTokens: number;
    latency: number;
    cost: number;
    provider: string;
    model: string;
    timestamp?: number;
  }): void;
  insertBenchmarkRun(opts: {
    id: string;
    config: unknown;
    status?: string;
    created_at?: number;
    completed_at?: number | null;
  }): void;
  insertBenchmarkGame(opts: {
    game_id: string;
    run_id: string;
    pairing_id: string;
    model_a: string;
    model_b: string;
    seed: number;
    model_a_role: string;
    model_b_role: string;
    completed_at?: number | null;
    winner?: string | null;
    valid?: number;
  }): void;
} {
  const db = new Database(':memory:');
  db.exec(loadSchema());

  const repo = new GameRepository(db) as any;

  function seedGame(opts: {
    id: string;
    status?: string;
    winner?: string | null;
    duration?: number | null;
    startedAt?: number;
    endedAt?: number;
    players?: Array<{
      id: string;
      name: string;
      role: string;
      isAlive?: boolean;
      isMafia?: boolean;
      joinOrder: number;
      provider?: string;
      model?: string;
      survived?: number;
      won?: number;
      tokens_used?: number;
      role_performance?: number;
    }>;
    events?: Array<{
      type: string;
      visibility?: string;
      actorId?: string;
      targetId?: string;
      data: unknown;
      dayNumber?: number;
      turnNumber?: number;
      phase?: string;
    }>;
  }): void {
    const id = opts.id;
    const now = Date.now();
    const status = opts.status ?? 'IN_PROGRESS';
    const cfg = { numPlayers: 10, roles: [] };
    db.prepare(
      `INSERT OR IGNORE INTO games (id, status, config, created_at, started_at, ended_at, winner, duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      status,
      JSON.stringify(cfg),
      now,
      opts.startedAt ?? now,
      opts.endedAt ?? null,
      opts.winner ?? null,
      opts.duration ?? null
    );
    if (opts.players) {
      const insertPlayer = db.prepare(
        `INSERT OR REPLACE INTO players
           (id, game_id, name, role, is_alive, is_mafia, join_order, agent_id, provider, model, survived, won, tokens_used, role_performance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of opts.players) {
        insertPlayer.run(
          p.id,
          id,
          p.name,
          p.role,
          (p.isAlive ?? 1) ? 1 : 0,
          (p.isMafia ?? 0) ? 1 : 0,
          p.joinOrder,
          p.id, // agent_id
          p.provider ?? null,
          p.model ?? null,
          p.survived ?? null,
          p.won ?? null,
          p.tokens_used ?? 0,
          p.role_performance ?? 0
        );
      }
    }
    if (opts.events) {
      const insertEvent = db.prepare(
        `INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      let seq = 0;
      for (const e of opts.events) {
        seq += 1;
        insertEvent.run(
          `evt-${id}-${seq}`,
          id,
          e.type,
          Date.now(),
          e.visibility ?? 'PUBLIC',
          e.actorId ?? null,
          e.targetId ?? null,
          JSON.stringify(e.data ?? {}),
          e.turnNumber ?? 1,
          e.dayNumber ?? 1,
          e.phase ?? 'SETUP',
          seq
        );
      }
    }
  }

  function insertTokenUsage(r: any) {
    db.prepare(
      `INSERT INTO token_usage
         (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `tu-${Math.random().toString(36).slice(2, 10)}`,
      r.gameId,
      r.playerId,
      r.turnNumber,
      r.provider,
      r.model,
      r.promptTokens,
      r.completionTokens,
      r.totalTokens,
      r.cost,
      r.timestamp ?? Date.now()
    );
  }

  function insertApiCall(r: any) {
    db.prepare(
      `INSERT INTO api_calls
         (id, game_id, player_id, provider, model, endpoint, latency, status_code, error, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `ac-${Math.random().toString(36).slice(2, 10)}`,
      r.gameId,
      r.playerId,
      r.provider,
      r.model,
      r.endpoint,
      r.latency,
      r.statusCode ?? null,
      r.error ?? null,
      r.timestamp ?? Date.now()
    );
  }

  function insertAgentSession(r: any) {
    db.prepare(
      `INSERT INTO agent_sessions
         (id, game_id, player_id, turn_number, phase, prompt, response, think, says, action_type, action_target, action_confidence, tokens_used, prompt_tokens, completion_tokens, latency, cost, provider, model, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `as-${Math.random().toString(36).slice(2, 10)}`,
      r.gameId,
      r.playerId,
      r.turnNumber,
      r.phase,
      r.prompt,
      r.response ?? null,
      r.think ?? null,
      r.says ?? null,
      null,
      null,
      null,
      r.tokensUsed,
      r.promptTokens,
      r.completionTokens,
      r.latency,
      r.cost,
      r.provider,
      r.model,
      r.timestamp ?? Date.now()
    );
  }

  function insertBenchmarkRun(opts: any) {
    const now = opts.created_at ?? Date.now();
    db.prepare(
      `INSERT INTO benchmark_runs (id, config, status, created_at, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      opts.id,
      JSON.stringify(opts.config),
      opts.status ?? 'QUEUED',
      now,
      opts.completed_at ?? null,
      now
    );
  }

  function insertBenchmarkGame(opts: any) {
    db.prepare(
      `INSERT INTO benchmark_games
         (game_id, run_id, pairing_id, model_a, model_b, seed, model_a_role, model_b_role, winner, completed_at, valid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.game_id,
      opts.run_id,
      opts.pairing_id,
      opts.model_a,
      opts.model_b,
      opts.seed,
      opts.model_a_role,
      opts.model_b_role,
      opts.winner ?? null,
      opts.completed_at ?? null,
      opts.valid ?? 1
    );
  }

  return Object.assign(repo, {
    db,
    seedGame,
    insertTokenUsage,
    insertApiCall,
    insertAgentSession,
    insertBenchmarkRun,
    insertBenchmarkGame,
  });
}

// ---------------------------------------------------------------------------
// Factory helpers — small builders for game/player/event fixtures.
// ---------------------------------------------------------------------------

export function makeTestConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    numPlayers: 5,
    roles: [
      { role: 'MAFIA', count: 1 },
      { role: 'DOCTOR', count: 1 },
      { role: 'SHERIFF', count: 1 },
      { role: 'VIGILANTE', count: 0 },
      { role: 'VILLAGER', count: 2 },
    ],
    nightPhaseDuration: 60,
    dayPhaseDuration: 120,
    votingDuration: 30,
    maxPlayers: 10,
    minPlayers: 5,
    allowSelfVote: false,
    tieBreaker: 'RANDOM',
    enable3D: false,
    enableVoice: false,
    logLevel: 'INFO',
    ...overrides,
  };
}

export function makeTestGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'SETUP',
    dayNumber: 1,
    turnNumber: 1,
    timeRemaining: 60,
    activePlayers: [],
    eliminatedPlayers: [],
    votes: [],
    nightActions: [],
    ...overrides,
  };
}

export function makeTestPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: overrides.id ?? `p-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'TestPlayer',
    role: overrides.role ?? 'VILLAGER',
    isAlive: overrides.isAlive ?? true,
    isMafia: overrides.isMafia ?? false,
    joinOrder: overrides.joinOrder ?? 0,
  };
}

export function makeTestGame(overrides: Partial<Game> = {}): Game {
  const players = overrides.players ?? [makeTestPlayer({ id: 'p1', name: 'Alice', joinOrder: 0 })];
  return makeGame({
    config: overrides.config ?? makeTestConfig(),
    status: overrides.status ?? 'SETUP',
    players,
    ...overrides,
  });
}

export function makeAgentResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    think: overrides.think ?? 'I am thinking...',
    says: overrides.says ?? 'I have something to say.',
    action: overrides.action,
    metadata: overrides.metadata ?? {
      tokensUsed: 10,
      promptTokens: 5,
      completionTokens: 5,
      latency: 100,
      cost: 0.001,
      provider: 'OPENAI',
      model: 'gpt-4',
      turnNumber: 1,
      timestamp: new Date(),
    },
  };
}
