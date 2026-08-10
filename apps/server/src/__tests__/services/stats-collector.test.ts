import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('StatsCollector', () => {
  let repo: FakeRepo;
  let stats: StatsCollector;

  beforeEach(() => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    stats = new StatsCollector(repo as any);
  });

  // ==========================================================================
  // Token usage
  // ==========================================================================

  describe('recordTokenUsage() / getTotalTokens() / getTotalCost()', () => {
    it('persists token usage and aggregates totals per game', () => {
      // Token usage has a FK to games.id; seed the parent rows first.
      repo.seedGame({ id: 'g1' });
      repo.seedGame({ id: 'g2' });

      stats.recordTokenUsage({
        gameId: 'g1',
        playerId: 'p1',
        turnNumber: 1,
        provider: 'OPENAI',
        model: 'gpt-4',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.01,
        timestamp: Date.now(),
      });
      stats.recordTokenUsage({
        gameId: 'g1',
        playerId: 'p2',
        turnNumber: 1,
        provider: 'OPENAI',
        model: 'gpt-4',
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        cost: 0.02,
        timestamp: Date.now(),
      });
      stats.recordTokenUsage({
        gameId: 'g2',
        playerId: 'p1',
        turnNumber: 1,
        provider: 'ANTHROPIC',
        model: 'claude-3',
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
        cost: 0.005,
        timestamp: Date.now(),
      });

      expect(stats.getTotalTokens('g1')).toBe(450);
      expect(stats.getTotalCost('g1')).toBeCloseTo(0.03, 5);
      expect(stats.getTotalTokens('g2')).toBe(75);
      expect(stats.getTotalCost('g2')).toBeCloseTo(0.005, 5);
    });

    it('returns 0 for an unknown game', () => {
      expect(stats.getTotalTokens('nope')).toBe(0);
      expect(stats.getTotalCost('nope')).toBe(0);
    });

    it('returns per-player token usage records ordered by turn', () => {
      repo.seedGame({ id: 'g' });
      stats.recordTokenUsage({
        gameId: 'g', playerId: 'p1', turnNumber: 1, provider: 'X', model: 'm',
        promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0, timestamp: Date.now(),
      });
      stats.recordTokenUsage({
        gameId: 'g', playerId: 'p1', turnNumber: 2, provider: 'X', model: 'm',
        promptTokens: 2, completionTokens: 2, totalTokens: 4, cost: 0, timestamp: Date.now(),
      });
      stats.recordTokenUsage({
        gameId: 'g', playerId: 'p2', turnNumber: 1, provider: 'X', model: 'm',
        promptTokens: 9, completionTokens: 9, totalTokens: 18, cost: 0, timestamp: Date.now(),
      });

      const p1Usage = stats.getPlayerTokenUsage('g', 'p1');
      expect(p1Usage).toHaveLength(2);
      expect(p1Usage[0].turnNumber).toBe(1);
      expect(p1Usage[1].turnNumber).toBe(2);
      expect(p1Usage.map(u => u.totalTokens)).toEqual([2, 4]);
    });
  });

  // ==========================================================================
  // API calls + error rate
  // ==========================================================================

  describe('recordAPICall() / getAPIErrorRate()', () => {
    it('tracks call count and computes error rate', () => {
      // api_calls has FK to games.id; seed the parent row first.
      repo.seedGame({ id: 'g' });
      stats.recordAPICall({
        gameId: 'g', playerId: 'p1', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 100, timestamp: Date.now(),
      });
      stats.recordAPICall({
        gameId: 'g', playerId: 'p1', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 200, error: 'timeout', timestamp: Date.now(),
      });
      stats.recordAPICall({
        gameId: 'g', playerId: 'p2', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 150, statusCode: 500, timestamp: Date.now(),
      });

      const calls = stats.getGameAPICalls('g');
      expect(calls).toHaveLength(3);
      const rate = stats.getAPIErrorRate('g');
      // 1 of 3 calls has a truthy `error`.
      expect(rate).toBeCloseTo(1 / 3, 5);
    });

    it('returns 0 when there are no calls', () => {
      expect(stats.getAPIErrorRate('empty')).toBe(0);
    });
  });

  // ==========================================================================
  // Agent sessions + agent stats
  // ==========================================================================

  describe('recordAgentSession() / getAgentStats()', () => {
    it('groups sessions by player+provider+model and aggregates correctly', () => {
      // agent_sessions has FK to games.id; seed the parent row first.
      repo.seedGame({ id: 'g1' });
      stats.recordAgentSession({
        gameId: 'g1', playerId: 'p1', turnNumber: 1, phase: 'DAY_DISCUSSION',
        prompt: 'hi', response: 'ok', think: 't', says: 's',
        tokensUsed: 10, promptTokens: 5, completionTokens: 5,
        latency: 100, cost: 0.001, provider: 'OPENAI', model: 'gpt-4', timestamp: Date.now(),
      });
      stats.recordAgentSession({
        gameId: 'g1', playerId: 'p1', turnNumber: 2, phase: 'DAY_DISCUSSION',
        prompt: 'hi', response: 'ok', think: 't', says: 's',
        tokensUsed: 20, promptTokens: 10, completionTokens: 10,
        latency: 150, cost: 0.002, provider: 'OPENAI', model: 'gpt-4', timestamp: Date.now(),
      });

      const agentStats = stats.getAgentStats();
      expect(agentStats).toHaveLength(1);
      expect(agentStats[0].agentId).toBe('p1');
      expect(agentStats[0].executions).toBe(2);
      expect(agentStats[0].successes).toBe(2);
      expect(agentStats[0].totalTokens).toBe(30);
      expect(agentStats[0].totalCost).toBeCloseTo(0.003, 5);
      expect(agentStats[0].totalLatency).toBe(250);
      expect(agentStats[0].provider).toBe('OPENAI');
      expect(agentStats[0].model).toBe('gpt-4');
    });
  });

  // ==========================================================================
  // Game stats
  // ==========================================================================

  describe('getGameStats()', () => {
    it('aggregates game counts and win rates', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'MAFIA', duration: 60_000,
        players: [{ id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true }],
      });
      repo.seedGame({
        id: 'g2', status: 'ENDED', winner: 'TOWN', duration: 120_000,
        players: [{ id: 'p2', name: 'P2', role: 'VILLAGER', joinOrder: 0 }],
      });
      repo.seedGame({
        id: 'g3', status: 'IN_PROGRESS',
        players: [{ id: 'p3', name: 'P3', role: 'VILLAGER', joinOrder: 0 }],
      });

      const s = stats.getGameStats();
      expect(s.totalGames).toBe(3);
      expect(s.completedGames).toBe(2);
      expect(s.activeGames).toBe(1);
      expect(s.mafiaWins).toBe(1);
      expect(s.townWins).toBe(1);
      // avg(60000ms, 120000ms) = 90000ms -> 90s (MAF-GAP-026: seconds contract)
      expect(s.avgDuration).toBe(90);
    });

    it('returns avgDuration in seconds and excludes in-progress games (MAF-GAP-026)', () => {
      repo.seedGame({ id: 'dur1', status: 'ENDED', winner: 'MAFIA', duration: 249_053 });
      repo.seedGame({ id: 'dur2', status: 'ENDED', winner: 'TOWN', duration: 120_000 });
      // A running game with a (hypothetical) duration must NOT skew the mean.
      repo.seedGame({ id: 'dur3', status: 'IN_PROGRESS', duration: 999_999_999 });

      const s = stats.getGameStats();
      // avg(249053, 120000) ms = 184526.5 ms -> 184.5 s -> 185 s (rounded).
      // Without the ENDED filter the 999999999 ms row would dominate.
      expect(s.avgDuration).toBe(185);
      expect(s.completedGames).toBe(2);
      expect(s.activeGames).toBe(1);
    });

    it('returns zeroes when no games exist', () => {
      const s = stats.getGameStats();
      expect(s).toEqual({
        totalGames: 0,
        activeGames: 0,
        completedGames: 0,
        avgDuration: 0,
        mafiaWins: 0,
        townWins: 0,
      });
    });
  });

  // ==========================================================================
  // Model stats / comparison
  // ==========================================================================

  describe('getModelComparison()', () => {
    it('returns aggregated per-provider/model stats when the players table has rows', () => {
      // Populate enough rows that gameRepository.getModelStats() works via
      // its raw SQL fallback. We test getModelComparison() (which is what the
      // API actually calls), not the repo-level helper.
      repo.seedGame({
        id: 'm1',
        players: [
          { id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'OPENAI', model: 'gpt-4', won: 1, tokens_used: 100, role_performance: 70 },
          { id: 'p2', name: 'P2', role: 'VILLAGER', joinOrder: 1,
            provider: 'OPENAI', model: 'gpt-4', won: 0, tokens_used: 50, role_performance: 60 },
        ],
      });
      repo.seedGame({
        id: 'm2',
        players: [
          { id: 'p3', name: 'P3', role: 'VILLAGER', joinOrder: 0,
            provider: 'ANTHROPIC', model: 'claude-3', won: 1, tokens_used: 80, role_performance: 80 },
        ],
      });

      const cmp = stats.getModelComparison();
      // Should be at least 1 entry — either from the DB or from the fallback.
      expect(cmp.length).toBeGreaterThan(0);
      // The fallback or DB-derived comparison should be a valid shape.
      for (const m of cmp) {
        expect(typeof m.provider).toBe('string');
        expect(typeof m.model).toBe('string');
        expect(typeof m.gamesPlayed).toBe('number');
        expect(typeof m.winRate).toBe('number');
        expect(m.winRate).toBeGreaterThanOrEqual(0);
        expect(m.winRate).toBeLessThanOrEqual(1);
      }
    });

    it('returns [] when the players table is empty and no real assignments exist (no fabrication)', () => {
      // Game with no players table rows and no player_model_assignments.
      // MAF-GAP-012: the old code fabricated a 'neuralwatt/qwen3.6-35b-fast'
      // row with 100% win rate; the honest answer is an empty list.
      repo.seedGame({
        id: 'fallback',
        status: 'ENDED',
        events: [
          { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
        ],
      });

      const cmp = stats.getModelComparison();
      expect(cmp).toEqual([]);
    });

    it('derives honest per-model rows from player_model_assignments when players table is empty', () => {
      // Legacy path: no players rows, but real role-model assignments exist.
      // Wins must only count for the model whose side actually won.
      repo.seedGame({
        id: 'legacy1',
        status: 'ENDED',
        events: [
          { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
        ],
      });
      repo.seedGame({
        id: 'legacy2',
        status: 'ENDED',
        events: [
          { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
        ],
      });
      const db = repo.db;
      const insert = db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Model A plays MAFIA in both games: wins game 1 (MAFIA won), loses game 2.
      insert.run('a1', 'legacy1', 'ALL', 'MAFIA', 'providerA', 'modelA', 0.7, 500, 0, Date.now());
      insert.run('a2', 'legacy2', 'ALL', 'MAFIA', 'providerA', 'modelA', 0.7, 500, 0, Date.now());
      // Model B plays TOWN in both games: loses game 1, wins game 2.
      insert.run('b1', 'legacy1', 'ALL', 'TOWN', 'providerB', 'modelB', 0.7, 500, 0, Date.now());
      insert.run('b2', 'legacy2', 'ALL', 'TOWN', 'providerB', 'modelB', 0.7, 500, 0, Date.now());

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(2);
      const a = cmp.find(m => m.provider === 'providerA' && m.model === 'modelA')!;
      expect(a.gamesPlayed).toBe(2);
      expect(a.wins).toBe(1);
      expect(a.winRate).toBeCloseTo(0.5, 5);
      const b = cmp.find(m => m.provider === 'providerB' && m.model === 'modelB')!;
      expect(b.gamesPlayed).toBe(2);
      expect(b.wins).toBe(1);
      expect(b.winRate).toBeCloseTo(0.5, 5);
      // No fabricated model may appear.
      expect(cmp.some(m => m.provider === 'neuralwatt' || m.model === 'qwen3.6-35b-fast')).toBe(false);
    });

    it('never counts a game as a win for a model that did not play it', () => {
      repo.seedGame({
        id: 'g-only-town',
        status: 'ENDED',
        events: [
          { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
        ],
      });
      const db = repo.db;
      db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('t1', 'g-only-town', 'ALL', 'TOWN', 'providerB', 'modelB', 0.7, 500, 0, Date.now());

      const cmp = stats.getModelComparison();
      // Only modelB appears, and it LOST this game (MAFIA won).
      expect(cmp).toHaveLength(1);
      expect(cmp[0].provider).toBe('providerB');
      expect(cmp[0].wins).toBe(0);
      expect(cmp[0].winRate).toBe(0);
    });

    it('fills avgTokens/avgCost/avgLatency from real token_usage/api_calls rows (MAF-GAP-018)', () => {
      // Legacy path: no players rows, real assignment + real usage rows as
      // persisted by LegacyGameAdapter.persistUsage after a completed game.
      repo.seedGame({
        id: 'legacy-usage',
        status: 'ENDED',
        events: [
          { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
        ],
      });
      const db = repo.db;
      db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u1', 'legacy-usage', 'ALL', 'TOWN', 'providerB', 'modelB', 0.7, 500, 0, Date.now());

      stats.recordTokenUsage({
        gameId: 'legacy-usage', playerId: 'ALL', turnNumber: 0,
        provider: 'providerB', model: 'modelB',
        promptTokens: 3000, completionTokens: 1500, totalTokens: 4500,
        cost: 0.0036, timestamp: Date.now(),
      });
      stats.recordAPICall({
        gameId: 'legacy-usage', playerId: 'ALL',
        provider: 'providerB', model: 'modelB',
        endpoint: 'legacy-engine', latency: 1840, statusCode: 200,
        timestamp: Date.now(),
      });

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(1);
      expect(cmp[0].provider).toBe('providerB');
      expect(cmp[0].model).toBe('modelB');
      expect(cmp[0].avgTokens).toBe(4500);
      expect(cmp[0].avgCost).toBeCloseTo(0.0036, 6);
      expect(cmp[0].avgLatency).toBe(1840);
    });

    it('keeps honest zeros for a model whose game has no recorded usage', () => {
      repo.seedGame({
        id: 'legacy-no-usage',
        status: 'ENDED',
        events: [
          { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
        ],
      });
      repo.db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('z1', 'legacy-no-usage', 'ALL', 'TOWN', 'providerC', 'modelC', 0.7, 500, 0, Date.now());

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(1);
      expect(cmp[0].avgTokens).toBe(0);
      expect(cmp[0].avgCost).toBe(0);
      expect(cmp[0].avgLatency).toBe(0);
    });

    it('does not leak usage from games the model did not play into its averages', () => {
      // Model played game A only; usage rows exist for game A AND an
      // unrelated game B (same model string, but no assignment for B).
      repo.seedGame({
        id: 'played', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
      });
      repo.seedGame({
        id: 'not-played', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' }],
      });
      repo.db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('p1', 'played', 'ALL', 'MAFIA', 'providerA', 'modelA', 0.7, 500, 0, Date.now());

      stats.recordTokenUsage({
        gameId: 'played', playerId: 'ALL', turnNumber: 0,
        provider: 'providerA', model: 'modelA',
        promptTokens: 100, completionTokens: 50, totalTokens: 150,
        cost: 0.001, timestamp: Date.now(),
      });
      stats.recordTokenUsage({
        gameId: 'not-played', playerId: 'ALL', turnNumber: 0,
        provider: 'providerA', model: 'modelA',
        promptTokens: 9000, completionTokens: 9000, totalTokens: 18000,
        cost: 0.5, timestamp: Date.now(),
      });

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(1);
      expect(cmp[0].gamesPlayed).toBe(1);
      // Only the played game's usage counts — not the 18000-token outlier.
      expect(cmp[0].avgTokens).toBe(150);
      expect(cmp[0].avgCost).toBeCloseTo(0.001, 6);
    });

    it('surfaces recorded usage for ended games with no assignments (POST /games default path)', () => {
      // Legacy default path: no players rows, no assignments — but the
      // adapter persisted real usage at game completion. The model must
      // appear with its real averages and unattributed (0) wins.
      repo.seedGame({
        id: 'unassigned-1', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' }],
      });
      repo.seedGame({
        id: 'unassigned-2', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
      });
      // An IN_PROGRESS game's usage must NOT count.
      repo.seedGame({ id: 'still-running', status: 'IN_PROGRESS' });

      for (const [gameId, tokens, cost] of [['unassigned-1', 1000, 0.002], ['unassigned-2', 3000, 0.004], ['still-running', 99999, 9.99]] as const) {
        stats.recordTokenUsage({
          gameId, playerId: 'ALL', turnNumber: 0,
          provider: 'openai', model: 'gpt-4o-mini',
          promptTokens: tokens, completionTokens: 0, totalTokens: tokens,
          cost, timestamp: Date.now(),
        });
      }

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(1);
      expect(cmp[0].provider).toBe('openai');
      expect(cmp[0].model).toBe('gpt-4o-mini');
      expect(cmp[0].gamesPlayed).toBe(2);
      expect(cmp[0].avgTokens).toBe(2000); // (1000 + 3000) / 2, running game excluded
      expect(cmp[0].avgCost).toBeCloseTo(0.003, 6);
      expect(cmp[0].wins).toBe(0); // role unattributable — never guessed
    });

    it('merges players-table rows with assignment-derived rows instead of short-circuiting', () => {
      // Live-data shape: a few players rows exist (3 games, no usage) AND
      // many assignment-based legacy games have real usage. Both must
      // appear — previously the players rows short-circuited and hid the
      // assignment games entirely.
      repo.seedGame({
        id: 'p-game',
        players: [
          { id: 'pp1', name: 'PP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'CUSTOM', model: 'gpt-4o', won: 1, tokens_used: 0, role_performance: 50 },
        ],
      });
      repo.seedGame({
        id: 'a-game', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' }],
      });
      repo.db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('m1', 'a-game', 'ALL', 'TOWN', 'CUSTOM', 'gpt-4o-mini', 0.7, 500, 0, Date.now());
      stats.recordTokenUsage({
        gameId: 'a-game', playerId: 'ALL', turnNumber: 0,
        provider: 'CUSTOM', model: 'gpt-4o-mini',
        promptTokens: 500, completionTokens: 200, totalTokens: 700,
        cost: 0.0007, timestamp: Date.now(),
      });

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(2);
      const assigned = cmp.find(m => m.model === 'gpt-4o-mini')!;
      expect(assigned.avgTokens).toBe(700);
      expect(assigned.avgCost).toBeCloseTo(0.0007, 6);
      const playersRow = cmp.find(m => m.model === 'gpt-4o')!;
      expect(playersRow.gamesPlayed).toBe(1);
    });

    it('excludes zero-latency api_calls from avgLatency for assignment-derived models (MAF-GAP-026)', () => {
      // Legacy benchmark path: no players rows — the model is known only via
      // player_model_assignments. Its latency must come from non-zero calls.
      repo.seedGame({
        id: 'leg1', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' }],
      });
      repo.db.prepare(`
        INSERT INTO player_model_assignments
          (id, game_id, player_id, role, provider, model, temperature, max_tokens, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('leg1a', 'leg1', 'ALL', 'TOWN', 'CUSTOM', 'legacy-model', 0.7, 500, 0, Date.now());
      for (const latency of [0, 0, 800]) {
        repo.insertApiCall({
          gameId: 'leg1', playerId: 'ALL', provider: 'CUSTOM', model: 'legacy-model',
          endpoint: '/v1/chat/completions', latency, timestamp: Date.now(),
        });
      }

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.model === 'legacy-model')!;
      expect(row).toBeDefined();
      // Mean of non-zero latencies only (800) — zeros no longer drag it down.
      expect(row.avgLatency).toBeCloseTo(800, 5);
    });

    it('excludes zero-latency api_calls from avgLatency for usage-derived models (MAF-GAP-026)', () => {
      // Legacy default path: no players rows, no assignments — usage only.
      repo.seedGame({ id: 'u-lat', status: 'ENDED' });
      stats.recordTokenUsage({
        gameId: 'u-lat', playerId: 'ALL', turnNumber: 0,
        provider: 'openai', model: 'gpt-4o-mini',
        promptTokens: 100, completionTokens: 50, totalTokens: 150,
        cost: 0.001, timestamp: Date.now(),
      });
      for (const latency of [0, 300, 300]) {
        repo.insertApiCall({
          gameId: 'u-lat', playerId: 'ALL', provider: 'openai', model: 'gpt-4o-mini',
          endpoint: '/v1/chat/completions', latency, timestamp: Date.now(),
        });
      }

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.model === 'gpt-4o-mini')!;
      expect(row).toBeDefined();
      expect(row.avgLatency).toBeCloseTo(300, 5); // mean(300, 300) — zero dropped
    });
  });

  // ==========================================================================
  // getModelStats (repository SQL)
  // ==========================================================================

  describe('getModelStats() SQL', () => {
    it('executes without throwing and returns rows when players exist', () => {
      repo.seedGame({
        id: 'sql1',
        players: [
          { id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'OPENAI', model: 'gpt-4', won: 1, tokens_used: 100 },
        ],
      });
      repo.insertTokenUsage({
        gameId: 'sql1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4',
        promptTokens: 100, completionTokens: 50, totalTokens: 150,
        cost: 0.01, timestamp: Date.now(),
      });

      // MAF-GAP-012: the old nested-AVG query threw at runtime; this must
      // execute and return the aggregated row with a real avg_cost.
      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe('OPENAI');
      expect(rows[0].model).toBe('gpt-4');
      expect(rows[0].gamesPlayed).toBe(1);
      expect(rows[0].wins).toBe(1);
      expect(rows[0].avgCost).toBeCloseTo(0.01, 5);
    });

    it('returns [] without throwing when the players table is empty', () => {
      expect(() => repo.getModelStats()).not.toThrow();
      expect(repo.getModelStats()).toEqual([]);
    });

    it('excludes zero/null latency rows from avgLatency (MAF-GAP-026)', () => {
      repo.seedGame({
        id: 'lat1',
        players: [
          { id: 'lp1', name: 'LP1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'OPENAI', model: 'gpt-4', won: 1, tokens_used: 100 },
        ],
      });
      for (const latency of [0, 0, 618, 618]) {
        repo.insertApiCall({
          gameId: 'lat1', playerId: 'lp1', provider: 'OPENAI', model: 'gpt-4',
          endpoint: '/v1/chat/completions', latency, timestamp: Date.now(),
        });
      }

      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      // Mean of the non-zero latencies only (618, 618) — 79.6% of real api_calls
      // rows are latency 0/NULL and were dragging the mean to ~4ms.
      expect(rows[0].avgLatency).toBeCloseTo(618, 5);
    });
  });

  // ==========================================================================
  // Player stats
  // ==========================================================================

  describe('getPlayerPerformance()', () => {
    it('returns null for an unknown player', () => {
      repo.seedGame({
        id: 'g', players: [{ id: 'p1', name: 'P1', role: 'VILLAGER', joinOrder: 0 }],
      });
      expect(stats.getPlayerPerformance('g', 'unknown')).toBeNull();
    });

    it('returns a stats summary for a known player', () => {
      repo.seedGame({
        id: 'g1',
        players: [{ id: 'p1', name: 'P1', role: 'VILLAGER', joinOrder: 0, isAlive: true }],
      });
      stats.recordTokenUsage({
        gameId: 'g1', playerId: 'p1', turnNumber: 1, provider: 'X', model: 'm',
        promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0, timestamp: Date.now(),
      });

      const perf = stats.getPlayerPerformance('g1', 'p1');
      expect(perf).not.toBeNull();
      expect(perf?.playerId).toBe('p1');
      expect(perf?.role).toBe('VILLAGER');
      expect(perf?.survived).toBe(true);
      expect(perf?.tokensUsed).toBe(15);
      expect(perf?.apiCalls).toBe(0);
      expect(perf?.rolePerformance).toBeGreaterThan(0);
    });

    it('derives won correctly from MAFIA winner + mafia player via fallback path', () => {
      // The MAIN path of getPlayerPerformance hard-codes won=false when the
      // player exists in the players table; the fallback path (player NOT in
      // players table) derives won from game events. We exercise that fallback
      // by NOT adding the player to the players table.
      repo.seedGame({
        id: 'g-mafia-wins',
        status: 'ENDED',
        events: [
          // PHASE_CHANGED with winner in data + phase GAME_OVER triggers
          // getGameWinnerFromEvents to return 'MAFIA'.
          { type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' },
          // getPlayersFromEvents reads actorId/targetId from each event to
          // populate playerIds, so we need an event with actorId='p1' AND a
          // MORNING_REVEAL death with isMafia=true.
          { type: 'AGENT_SAYS_BROADCASTED', actorId: 'p1',
            data: { playerName: 'Mafia', statement: 'got em' },
            phase: 'DAY_DISCUSSION' },
          { type: 'MORNING_REVEAL', data: {
              deaths: [{ id: 'p1', name: 'Mafia', role: 'MAFIA', isMafia: true }],
            },
            phase: 'MORNING_REVEAL',
          },
        ],
      });

      const perf = stats.getPlayerPerformance('g-mafia-wins', 'p1');
      expect(perf).not.toBeNull();
      // Because there's no players-table row, the fallback derives from
      // events and treats this actor as a MAFIA-winning mafia player.
      expect(perf?.won).toBe(true);
    });
  });

  // ==========================================================================
  // Report generation
  // ==========================================================================

  describe('generateReport() / exportJSON() / exportCSV()', () => {
    it('generateReport returns a structured report', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'MAFIA', duration: 60_000,
        players: [{ id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true }],
      });

      const report = stats.generateReport();
      expect(report.generatedAt).toBeDefined();
      const summary = report.summary as any;
      expect(summary.totalGames).toBe(1);
      expect(summary.completedGames).toBe(1);
      expect(summary.mafiaWinRate).toBe(1);
    });

    it('generateReport includes per-game details when gameId is provided', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000,
        players: [{ id: 'p1', name: 'P1', role: 'VILLAGER', joinOrder: 0 }],
        events: [
          // Derive winner from events when the games.winner column is missing
          // or stale. The matcher requires phase='GAME_OVER' + data.winner.
          { type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
          { type: 'AGENT_SAYS_BROADCASTED', data: { statement: 'hello', playerName: 'P1' }, actorId: 'p1' },
        ],
      });

      const report = stats.generateReport('g1');
      const gameSection = report.game as any;
      expect(gameSection.id).toBe('g1');
      expect(gameSection.winner).toBe('TOWN');
      expect(gameSection.players).toHaveLength(1);
      expect(gameSection.players[0].name).toBe('P1');
    });

    it('generateReport catches errors and returns a fallback object', () => {
      // Drop the games table to force an error path.
      repo.db.exec('DROP TABLE games');
      const report = stats.generateReport();
      const summary = report.summary as any;
      expect(summary.totalGames).toBe(0);
      expect((report as any).error).toBe('Failed to generate report');
    });

    it('exportJSON returns valid JSON containing the report', () => {
      repo.seedGame({
        id: 'g1', status: 'ENDED', winner: 'MAFIA',
        players: [{ id: 'p1', name: 'P1', role: 'MAFIA', joinOrder: 0, isMafia: true }],
      });

      const json = stats.exportJSON();
      const parsed = JSON.parse(json);
      expect(parsed.summary.totalGames).toBe(1);
    });

    it('exportCSV emits a Metric/Value header row', () => {
      const csv = stats.exportCSV();
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Metric,Value');
      expect(lines).toContain('Total Games,0');
    });
  });

  // ==========================================================================
  // getMatchups
  // ==========================================================================

  describe('getMatchups()', () => {
    it('returns empty array when model_matchups is empty', () => {
      expect(stats.getMatchups()).toEqual([]);
    });
  });
});
