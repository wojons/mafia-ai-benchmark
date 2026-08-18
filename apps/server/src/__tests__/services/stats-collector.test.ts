import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../services/stats-collector.js';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import { createSqliteBackedRepository, createFakeEventBus } from './mocks.js';

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

    it('aggregates from token_usage + api_calls when agent_sessions is empty (MAF-GAP-028)', () => {
      // Legacy path shape: no agent_sessions rows at all — token_usage and
      // api_calls (written by LegacyGameAdapter.persistUsage) are the only
      // real data sources. token_usage/api_calls have FK to games.id.
      repo.seedGame({ id: 'g1' });
      repo.seedGame({ id: 'g2' });
      // p1 (OPENAI/gpt-4): two recorded calls across two games, one errored.
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 100, completionTokens: 50,
        totalTokens: 150, cost: 0.01, timestamp: Date.now() });
      repo.insertTokenUsage({ gameId: 'g2', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 200, completionTokens: 100,
        totalTokens: 300, cost: 0.02, timestamp: Date.now() });
      repo.insertApiCall({ gameId: 'g1', playerId: 'p1', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 120, timestamp: Date.now() });
      repo.insertApiCall({ gameId: 'g2', playerId: 'p1', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 180, error: 'timeout', timestamp: Date.now() });
      // p2 (ANTHROPIC/claude-3): one clean call.
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p2', turnNumber: 1,
        provider: 'ANTHROPIC', model: 'claude-3', promptTokens: 50, completionTokens: 25,
        totalTokens: 75, cost: 0.005, timestamp: Date.now() });
      repo.insertApiCall({ gameId: 'g1', playerId: 'p2', provider: 'ANTHROPIC', model: 'claude-3',
        endpoint: '/chat', latency: 90, timestamp: Date.now() });

      const agentStats = stats.getAgentStats();
      expect(agentStats).toHaveLength(2);
      const p1 = agentStats.find(a => a.agentId === 'p1')!;
      expect(p1.executions).toBe(2);
      expect(p1.successes).toBe(1); // one of the two api_calls rows has an error
      expect(p1.totalLatency).toBe(300);
      expect(p1.totalTokens).toBe(450);
      expect(p1.totalCost).toBeCloseTo(0.03, 5);
      expect(p1.provider).toBe('OPENAI');
      expect(p1.model).toBe('gpt-4');
      const p2 = agentStats.find(a => a.agentId === 'p2')!;
      expect(p2.executions).toBe(1);
      expect(p2.successes).toBe(1);
      expect(p2.totalLatency).toBe(90);
      expect(p2.totalTokens).toBe(75);
      expect(p2.totalCost).toBeCloseTo(0.005, 5);
    });

    it('counts recorded usage as successful when api_calls rows are missing (LEFT JOIN keeps the agent)', () => {
      repo.seedGame({ id: 'g' });
      repo.insertTokenUsage({ gameId: 'g', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 80, completionTokens: 20,
        totalTokens: 100, cost: 0.001, timestamp: Date.now() });

      const agentStats = stats.getAgentStats();
      expect(agentStats).toHaveLength(1);
      expect(agentStats[0].executions).toBe(1);
      // A token_usage row is only written for a real billed response, so
      // the execution is a success even without an api_calls row.
      expect(agentStats[0].successes).toBe(1);
      expect(agentStats[0].totalLatency).toBe(0);
      expect(agentStats[0].totalTokens).toBe(100);
    });

    it('merges agent_sessions rows for agents with no recorded token usage (native path)', () => {
      repo.seedGame({ id: 'g1' });
      // Usage-covered agent (legacy path).
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'pLegacy', turnNumber: 0,
        provider: 'CUSTOM', model: 'openai', promptTokens: 400, completionTokens: 100,
        totalTokens: 500, cost: 0.002, timestamp: Date.now() });
      repo.insertApiCall({ gameId: 'g1', playerId: 'pLegacy', provider: 'CUSTOM', model: 'openai',
        endpoint: 'legacy-engine', latency: 800, timestamp: Date.now() });
      // Sessions-only agent (native path writes agent_sessions only).
      stats.recordAgentSession({
        gameId: 'g1', playerId: 'pNative', turnNumber: 1, phase: 'DAY_DISCUSSION',
        prompt: 'hi', response: 'ok', think: 't', says: 's',
        tokensUsed: 10, promptTokens: 5, completionTokens: 5,
        latency: 100, cost: 0.001, provider: 'OPENAI', model: 'gpt-4', timestamp: Date.now(),
      });
      stats.recordAgentSession({
        gameId: 'g1', playerId: 'pNative', turnNumber: 2, phase: 'DAY_DISCUSSION',
        prompt: 'hi', response: 'ok', think: 't', says: 's',
        tokensUsed: 20, promptTokens: 10, completionTokens: 10,
        latency: 150, cost: 0.002, provider: 'OPENAI', model: 'gpt-4', timestamp: Date.now(),
      });

      const agentStats = stats.getAgentStats();
      expect(agentStats).toHaveLength(2);
      // Most active agent first (2 executions > 1).
      expect(agentStats[0].agentId).toBe('pNative');
      expect(agentStats[0].executions).toBe(2);
      expect(agentStats[0].totalTokens).toBe(30);
      const legacy = agentStats.find(a => a.agentId === 'pLegacy')!;
      expect(legacy.executions).toBe(1);
      expect(legacy.successes).toBe(1);
      expect(legacy.totalLatency).toBe(800);
      expect(legacy.totalTokens).toBe(500);
    });

    it('usage-derived rows win over agent_sessions on key collision (no double count)', () => {
      repo.seedGame({ id: 'g1' });
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 100, completionTokens: 50,
        totalTokens: 150, cost: 0.01, timestamp: Date.now() });
      repo.insertApiCall({ gameId: 'g1', playerId: 'p1', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 120, timestamp: Date.now() });
      // Same (player, provider, model) key also present in agent_sessions.
      stats.recordAgentSession({
        gameId: 'g1', playerId: 'p1', turnNumber: 1, phase: 'DAY_DISCUSSION',
        prompt: 'hi', response: 'ok', think: 't', says: 's',
        tokensUsed: 10, promptTokens: 5, completionTokens: 5,
        latency: 100, cost: 0.001, provider: 'OPENAI', model: 'gpt-4', timestamp: Date.now(),
      });

      const agentStats = stats.getAgentStats();
      expect(agentStats).toHaveLength(1);
      expect(agentStats[0].executions).toBe(1); // NOT 2 — the usage row wins
      expect(agentStats[0].totalTokens).toBe(150);
    });

    it('returns [] when no usage, calls, or sessions exist (no fabrication)', () => {
      expect(stats.getAgentStats()).toEqual([]);
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
        failedGames: 0,
        avgDuration: 0,
        mafiaWins: 0,
        townWins: 0,
      });
    });

    it('counts non-terminal statuses as failedGames and balances the total (MAF-GAP-050)', () => {
      repo.seedGame({ id: 'ok1', status: 'ENDED', winner: 'MAFIA', duration: 60_000 });
      repo.seedGame({ id: 'ok2', status: 'IN_PROGRESS' });
      repo.seedGame({ id: 'stuck1', status: 'CANCELLED' });
      repo.seedGame({ id: 'stuck2', status: 'SETUP' });
      repo.seedGame({ id: 'stuck3', status: 'PAUSED' });

      const s = stats.getGameStats();
      expect(s.totalGames).toBe(5);
      expect(s.activeGames).toBe(1);
      expect(s.completedGames).toBe(1);
      expect(s.failedGames).toBe(3);
      // MAF-GAP-050 acceptance: the reconciliation identity must hold —
      // every game lands in exactly one bucket.
      expect(s.totalGames).toBe(s.activeGames + s.completedGames + s.failedGames);
    });

    it('lists failed game ids with status and timestamps via getFailedGames (MAF-GAP-050)', () => {
      repo.seedGame({
        id: 'stuck1', status: 'CANCELLED',
        startedAt: 1_700_000_000_000, endedAt: 1_700_000_100_000,
      });
      repo.seedGame({ id: 'stuck2', status: 'SETUP' });
      repo.seedGame({ id: 'done', status: 'ENDED', winner: 'TOWN', duration: 30_000 });

      const failed = (repo as any).getFailedGames();
      expect(failed).toHaveLength(2);
      expect(failed[0].id).toBe('stuck1');
      expect(failed[0].status).toBe('CANCELLED');
      expect(failed[0].createdAt).toBeInstanceOf(Date);
      expect(failed[0].endedAt).toEqual(new Date(1_700_000_100_000));
      expect(failed[1]).toMatchObject({ id: 'stuck2', status: 'SETUP', endedAt: null });
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
      // Model A plays MAFIA in both games; model B plays TOWN in both games.
      insert.run('a1', 'legacy1', 'ALL', 'MAFIA', 'providerA', 'modelA', 0.7, 500, 0, Date.now());
      insert.run('a2', 'legacy2', 'ALL', 'MAFIA', 'providerA', 'modelA', 0.7, 500, 0, Date.now());
      // Model B plays TOWN in both games.
      insert.run('b1', 'legacy1', 'ALL', 'TOWN', 'providerB', 'modelB', 0.7, 500, 0, Date.now());
      insert.run('b2', 'legacy2', 'ALL', 'TOWN', 'providerB', 'modelB', 0.7, 500, 0, Date.now());

      const cmp = stats.getModelComparison();
      expect(cmp).toHaveLength(2);
      const a = cmp.find(m => m.provider === 'providerA' && m.model === 'modelA')!;
      expect(a.gamesPlayed).toBe(2);
      // No players.won rows exist — wins stay 0 (no fabricated side wins).
      expect(a.wins).toBe(0);
      expect(a.winRate).toBe(0);
      const b = cmp.find(m => m.provider === 'providerB' && m.model === 'modelB')!;
      expect(b.gamesPlayed).toBe(2);
      expect(b.wins).toBe(0);
      expect(b.winRate).toBe(0);
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

    it('counts usage-recorded games as played when assignments are sparse (MAF-GAP-036)', () => {
      // Legacy path: assignments exist for ONE game; usage rows exist for
      // that game AND another ended game the model also played (legacy
      // games often lack assignment rows — token_usage is the played
      // record). Normalization must not drop the usage-only game.
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
      // Both games count (assignment + usage-recorded); averages cover both.
      expect(cmp[0].gamesPlayed).toBe(2);
      expect(cmp[0].avgTokens).toBe((150 + 18000) / 2);
      expect(cmp[0].avgCost).toBeCloseTo((0.001 + 0.5) / 2, 6);
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

    it('attributes wins from real game winners joined to players.is_mafia (MAF-GAP-039)', () => {
      // Ended games with winners in the games table. Each player row
      // records which side its model played on (is_mafia). A model wins a
      // game when ITS side won — never the opposite side, never a game it
      // did not play.
      repo.seedGame({
        id: 'sw-1', status: 'ENDED', winner: 'MAFIA',
        players: [
          { id: 'sw1a', name: 'A1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'OPENAI', model: 'gpt-4', tokens_used: 0 },
          { id: 'sw1b', name: 'B1', role: 'VILLAGER', joinOrder: 1, isMafia: false,
            provider: 'ANTHROPIC', model: 'claude-3', tokens_used: 0 },
        ],
      });
      repo.seedGame({
        id: 'sw-2', status: 'ENDED', winner: 'MAFIA',
        players: [
          { id: 'sw2a', name: 'A2', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'OPENAI', model: 'gpt-4', tokens_used: 0 },
          { id: 'sw2b', name: 'B2', role: 'MAFIA', joinOrder: 1, isMafia: true,
            provider: 'ANTHROPIC', model: 'claude-3', tokens_used: 0 },
        ],
      });
      repo.seedGame({
        id: 'sw-3', status: 'ENDED', winner: 'TOWN',
        players: [
          { id: 'sw3a', name: 'A3', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'OPENAI', model: 'gpt-4', tokens_used: 0 },
        ],
      });

      const cmp = stats.getModelComparison();
      const a = cmp.find(m => m.provider === 'OPENAI' && m.model === 'gpt-4')!;
      const b = cmp.find(m => m.provider === 'ANTHROPIC' && m.model === 'claude-3')!;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a.gamesPlayed).toBe(3);
      // sw-1: MAFIA side won; sw-3: TOWN side won; sw-2: MAFIA won while
      // the model played TOWN — a loss.
      expect(a.wins).toBe(2);
      expect(a.winRate).toBeCloseTo(2 / 3, 5);
      expect(b.gamesPlayed).toBe(2);
      // sw-2 only: its MAFIA player won; its TOWN player lost sw-1.
      expect(b.wins).toBe(1);
      expect(b.winRate).toBeCloseTo(0.5, 5);
    });

    it('falls back to GAME_OVER event winners when games.winner is NULL (MAF-GAP-039)', () => {
      // Live-data shape: games.winner is NULL for legacy ended games — the
      // winner lives in the GAME_OVER-phase event, the same source the
      // report summary's win totals use.
      repo.seedGame({
        id: 'evt-1', status: 'ENDED', winner: null,
        players: [
          { id: 'ev1a', name: 'A1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'CUSTOM', model: 'gpt-4o-mini', tokens_used: 0 },
        ],
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
      });
      repo.seedGame({
        id: 'evt-2', status: 'ENDED', winner: null,
        players: [
          { id: 'ev2a', name: 'A2', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'CUSTOM', model: 'gpt-4o-mini', tokens_used: 0 },
        ],
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'TOWN' }, phase: 'GAME_OVER' }],
      });
      repo.seedGame({
        id: 'evt-3', status: 'ENDED', winner: null,
        players: [
          { id: 'ev3a', name: 'A3', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'CUSTOM', model: 'gpt-4o-mini', tokens_used: 0 },
        ],
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
      });

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'CUSTOM' && m.model === 'gpt-4o-mini')!;
      expect(row).toBeDefined();
      expect(row.gamesPlayed).toBe(3);
      // evt-1 (MAFIA side won) + evt-2 (TOWN side won) = wins; evt-3 the
      // model's TOWN side lost to MAFIA.
      expect(row.wins).toBe(2);
      expect(row.winRate).toBeCloseTo(2 / 3, 5);
    });

    it('persists won=1/0 per player at game end so model wins read real data (MAF-GAP-043)', () => {
      // Write path: an ENDED game's players start with won NULL (the insert
      // never writes the column). setPlayersWon is the game-end hook — it
      // must set 1 for the winning side AND 0 for the losing side so no
      // ENDED-game player row is left NULL.
      repo.seedGame({
        id: 'won-1', status: 'IN_PROGRESS',
        players: [
          { id: 'w1a', name: 'A1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'OPENAI', model: 'gpt-4', tokens_used: 0 },
          { id: 'w1b', name: 'B1', role: 'VILLAGER', joinOrder: 1, isMafia: false,
            provider: 'ANTHROPIC', model: 'claude-3', tokens_used: 0 },
        ],
      });
      // A second game with players that must NOT be touched.
      repo.seedGame({
        id: 'won-2', status: 'IN_PROGRESS',
        players: [
          { id: 'w2a', name: 'A2', role: 'VILLAGER', joinOrder: 0, isMafia: false,
            provider: 'OPENAI', model: 'gpt-4', tokens_used: 0 },
        ],
      });
      // A legacy usage-only game with no players rows — graceful no-op.
      repo.seedGame({ id: 'won-3', status: 'IN_PROGRESS' });

      repo.setPlayersWon('won-1', 'MAFIA');
      repo.setPlayersWon('won-3', 'TOWN'); // must not throw

      const rows = repo.db.prepare(
        'SELECT game_id, is_mafia, won FROM players ORDER BY game_id, join_order'
      ).all() as Array<{ game_id: string; is_mafia: number; won: number | null }>;
      // won-1: MAFIA side won -> 1; TOWN side lost -> 0. Both explicit.
      expect(rows).toEqual([
        { game_id: 'won-1', is_mafia: 1, won: 1 },
        { game_id: 'won-1', is_mafia: 0, won: 0 },
        { game_id: 'won-2', is_mafia: 0, won: null }, // untouched
      ]);

      // The report now attributes the win to the model on the winning side.
      const cmp = stats.getModelComparison();
      const a = cmp.find(m => m.provider === 'OPENAI' && m.model === 'gpt-4')!;
      expect(a).toBeDefined();
      expect(a.wins).toBe(1);
      // gpt-4 also has a player row in won-2 (IN_PROGRESS, untouched), so
      // its gamesPlayed includes that row — wins come only from won=1.
      expect(a.gamesPlayed).toBe(2);
      expect(a.winRate).toBeCloseTo(0.5, 5);
      const b = cmp.find(m => m.provider === 'ANTHROPIC' && m.model === 'claude-3')!;
      expect(b).toBeDefined();
      expect(b.wins).toBe(0);
      expect(b.winRate).toBe(0);
    });

    it('never attributes wins to legacy usage-only rows without players side data (MAF-GAP-039)', () => {
      // token_usage rows with player_id='ALL' carry no side/role info.
      // Even though the game has a real winner, that winner must NOT be
      // attributed to the usage row — that was the MAF-GAP-036 sideWon
      // fabrication. Wins stay 0 and that is the documented semantics.
      repo.seedGame({ id: 'uo-1', status: 'ENDED', winner: 'MAFIA' });
      stats.recordTokenUsage({
        gameId: 'uo-1', playerId: 'ALL', turnNumber: 0,
        provider: 'openai', model: 'gpt-4o-mini',
        promptTokens: 100, completionTokens: 50, totalTokens: 150,
        cost: 0.001, timestamp: Date.now(),
      });

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini')!;
      expect(row).toBeDefined();
      expect(row.gamesPlayed).toBe(1);
      expect(row.wins).toBe(0);
      expect(row.winRate).toBe(0);
    });

    it('attributes wins to models whose players rows went through the legacy adapter path (MAF-GAP-043B)', () => {
      // Full write path: ROLES_ASSIGNED roster -> players rows with
      // role/is_mafia/provider/model, then done(winner) -> setPlayersWon.
      // The report must read real winRate from those rows — this is the
      // game-creation flow POST /api/v1/games and benchmark runs use.
      repo.seedGame({ id: 'adapter-1', status: 'IN_PROGRESS' });
      const adapter = new LegacyGameAdapter(createFakeEventBus(), repo as any);
      (adapter as any).gameConfigs.set('adapter-1', {
        numPlayers: 2,
        roleModels: {
          MAFIA: 'openai/gpt-4o-mini',
          TOWN: 'anthropic/claude-3',
        },
      });
      (adapter as any).activeGames.set('adapter-1', {
        gameId: 'adapter-1',
        process: null,
        eventCount: 1,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5000),
      });

      (adapter as any).translateAndPublishEvent('adapter-1', {
        eventType: 'ROLES_ASSIGNED',
        playerId: null,
        playerName: null,
        visibility: 'ADMIN_ONLY',
        phase: 'GAME_OVER',
        content: {
          assignments: [
            { playerId: 'p1', name: 'Maf', role: 'MAFIA', isMafia: true },
            { playerId: 'p2', name: 'Vil', role: 'VILLAGER', isMafia: false },
          ],
        },
        round: 0,
        timestamp: new Date().toISOString(),
      }, 1);
      (adapter as any).handleBridgeMessage('adapter-1', {
        type: 'done',
        winner: 'TOWN',
        totalEvents: 1,
        dayCount: 1,
        usage: [],
      });

      const cmp = stats.getModelComparison();
      const mafiaModel = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini')!;
      expect(mafiaModel).toBeDefined();
      expect(mafiaModel.gamesPlayed).toBe(1);
      expect(mafiaModel.wins).toBe(0); // mafia side lost
      expect(mafiaModel.winRate).toBe(0);

      const townModel = cmp.find(m => m.provider === 'anthropic' && m.model === 'claude-3')!;
      expect(townModel).toBeDefined();
      expect(townModel.gamesPlayed).toBe(1);
      expect(townModel.wins).toBe(1); // town side won
      expect(townModel.winRate).toBe(1);
    });

    it('merges CUSTOM/provider-prefixed rows into the plain provider/model row (MAF-GAP-045)', () => {
      // Live fragmentation: provider='CUSTOM' rows carry the model ALREADY
      // fully prefixed ('openai/gpt-4o-mini') while the usage path stores
      // provider='openai' with plain 'gpt-4o-mini'. Both are the same real
      // model — the canonical key is the model's OWN prefix, so exactly
      // ONE row must survive, and it must NOT be CUSTOM/openai/gpt-4o-mini.
      // (The old normalizeModelKey only stripped a prefix matching the
      // row's OWN provider, so these produced two report rows.)
      repo.seedGame({
        id: 'gap045-a',
        players: [
          { id: 'a1', name: 'A1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 100 },
        ],
      });
      repo.seedGame({
        id: 'gap045-b',
        players: [
          { id: 'b1', name: 'B1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'CUSTOM', model: 'openai/gpt-4o-mini', won: 1, tokens_used: 90 },
        ],
      });

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini')!;
      expect(row).toBeDefined();
      // Two distinct games (one per spelling) — the canonical GROUP BY
      // counts distinct games, it does not drop either spelling's games.
      expect(row.gamesPlayed).toBe(2);
      expect(row.wins).toBe(2);
      expect(row.winRate).toBe(1);
      // The fragmented spelling must be gone: no CUSTOM/openai/gpt-4o-mini row.
      expect(cmp.find(m => m.provider === 'CUSTOM' && m.model === 'openai/gpt-4o-mini')).toBeUndefined();
      // And only ONE row for this real model.
      expect(cmp.filter(m => m.model === 'gpt-4o-mini')).toHaveLength(1);
    });

    it('merge-max across sources keeps the most-games row and max wins (MAF-GAP-045)', () => {
      // The same game can be recorded by BOTH the players table (dbStats)
      // and token_usage (usage source): game mm-a has a players row AND
      // usage rows. Summing sources would count mm-a twice (3); merge-max
      // keeps the most complete source (usage, 2 games) and never
      // fabricates wins: wins = max(1, 0) = 1.
      repo.seedGame({
        id: 'mm-a', status: 'ENDED',
        players: [
          { id: 'm1', name: 'M1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 100 },
        ],
      });
      repo.seedGame({ id: 'mm-b', status: 'ENDED' });
      for (const [gameId, tokens, cost] of [['mm-a', 500, 0.0005], ['mm-b', 300, 0.0003]] as const) {
        stats.recordTokenUsage({
          gameId, playerId: 'ALL', turnNumber: 0,
          provider: 'openai', model: 'gpt-4o-mini',
          promptTokens: tokens, completionTokens: 0, totalTokens: tokens,
          cost, timestamp: Date.now(),
        });
      }

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini')!;
      expect(row).toBeDefined();
      expect(row.gamesPlayed).toBe(2); // max(1 dbStats, 2 usage) — NOT 3 (mm-a double-counted)
      expect(row.wins).toBe(1); // max(1 dbStats win, 0 usage wins) — never fabricated
      expect(row.winRate).toBeCloseTo(0.5, 5);
    });

    it('merged row keeps REAL latency when the dominant source lacks it (MAF-GAP-045)', () => {
      // Live shape: the dominant source's row can report avgLatency 0
      // because IT has no api_calls, while the other source has real
      // calls. The merge keeps the dominant row (most games) but must NOT
      // zero out the real 750ms — the loser's real metric fills the gap.
      // Games fill-a/fill-b: players rows (dbStats, 2 games, NO api_calls
      // -> latency 0). Game fill-c: usage-only with api_calls 700+800
      // (usage source, 1 game, latency 750).
      repo.seedGame({
        id: 'fill-a',
        players: [
          { id: 'fa1', name: 'FA1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 100 },
        ],
      });
      repo.seedGame({
        id: 'fill-b',
        players: [
          { id: 'fb1', name: 'FB1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 0, tokens_used: 90 },
        ],
      });
      repo.seedGame({ id: 'fill-c', status: 'ENDED' });
      stats.recordTokenUsage({
        gameId: 'fill-c', playerId: 'ALL', turnNumber: 0,
        provider: 'openai', model: 'gpt-4o-mini',
        promptTokens: 100, completionTokens: 50, totalTokens: 150,
        cost: 0.001, timestamp: Date.now(),
      });
      for (const latency of [700, 800]) {
        repo.insertApiCall({
          gameId: 'fill-c', playerId: 'ALL', provider: 'openai', model: 'gpt-4o-mini',
          endpoint: '/v1/chat/completions', latency, timestamp: Date.now(),
        });
      }

      const cmp = stats.getModelComparison();
      const row = cmp.find(m => m.provider === 'openai' && m.model === 'gpt-4o-mini')!;
      expect(row).toBeDefined();
      expect(row.gamesPlayed).toBe(2); // dominant = dbStats (2 games)
      expect(row.avgLatency).toBeCloseTo(750, 5); // real value survives the merge
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

    it('excludes physically-impossible sub-50ms latencies from avgLatency (MAF-GAP-026 floor)', () => {
      // CUSTOM/openai legacy-engine rows carry 23-49ms values that are
      // impossible for a billed LLM call (the API contract treats latency as
      // ms; real calls measure 600ms+). The 50ms floor keeps the mean honest.
      repo.seedGame({
        id: 'lat2',
        players: [
          { id: 'lp2', name: 'LP2', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'CUSTOM', model: 'openai', won: 1, tokens_used: 100 },
        ],
      });
      for (const latency of [23, 30, 700, 800]) {
        repo.insertApiCall({
          gameId: 'lat2', playerId: 'lp2', provider: 'CUSTOM', model: 'openai',
          endpoint: 'legacy-engine', latency, timestamp: Date.now(),
        });
      }

      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      // Sub-50ms rows dropped: mean(700, 800) = 750.
      expect(rows[0].avgLatency).toBeCloseTo(750, 5);
    });

    it('counts one win per game per model, not one per winning player row (MAF-GAP-048)', () => {
      // A game with 4 town winners of the SAME model is ONE win for that
      // model — the old SUM(CASE WHEN p.won = 1) inflated wins to 4 and
      // COUNT(*) inflated games_played to the player-row count. Live
      // symptom: openai/gpt-4o-mini showed wins=6 with only 2 distinct
      // won games.
      repo.seedGame({
        id: 'g048a',
        players: [
          { id: 'w1', name: 'W1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 100 },
          { id: 'w2', name: 'W2', role: 'TOWN', joinOrder: 1, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 90 },
          { id: 'w3', name: 'W3', role: 'TOWN', joinOrder: 2, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 80 },
          { id: 'w4', name: 'W4', role: 'TOWN', joinOrder: 3, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 70 },
        ],
      });
      repo.seedGame({
        id: 'g048b',
        players: [
          { id: 'l1', name: 'L1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 0, tokens_used: 50 },
        ],
      });

      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe('openai');
      expect(rows[0].model).toBe('gpt-4o-mini');
      expect(rows[0].gamesPlayed).toBe(2); // distinct games, not 5 player rows
      expect(rows[0].wins).toBe(1); // 4 winners in ONE game = 1 win
      expect(rows[0].winRate).toBeCloseTo(0.5, 5);
    });

    it('merges provider-prefixed model spellings into one row (MAF-GAP-048 normalized key)', () => {
      // provider='openai' with model='openai/gpt-4o-mini' and model='gpt-4o-mini'
      // are the same real model. The raw GROUP BY split them into two
      // rows; the normalized key (MAF-GAP-036 expression) merges them so
      // the report shows one row with distinct-game totals.
      repo.seedGame({
        id: 'g048c',
        players: [
          { id: 'n1', name: 'N1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'openai/gpt-4o-mini', won: 1, tokens_used: 100 },
        ],
      });
      repo.seedGame({
        id: 'g048d',
        players: [
          { id: 'n2', name: 'N2', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 90 },
        ],
      });

      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe('openai');
      expect(rows[0].model).toBe('gpt-4o-mini');
      expect(rows[0].gamesPlayed).toBe(2);
      expect(rows[0].wins).toBe(2);
      expect(rows[0].winRate).toBeCloseTo(1, 5);
    });

    it('merges CUSTOM/provider-prefixed rows into the canonical key (MAF-GAP-045)', () => {
      // Legacy benchmark-path rows carry provider='CUSTOM' with the model
      // ALREADY prefixed ('openai/gpt-4o-mini'). The canonical provider is
      // the model's OWN prefix — the old single-prefix expression only
      // stripped a prefix matching the row's provider, so this row kept a
      // fragmented CUSTOM/openai/gpt-4o-mini key. It must merge with the
      // plain openai/gpt-4o-mini spelling into ONE row.
      repo.seedGame({
        id: 'g045a',
        players: [
          { id: 'g1', name: 'G1', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'openai', model: 'gpt-4o-mini', won: 1, tokens_used: 100 },
        ],
      });
      repo.seedGame({
        id: 'g045b',
        players: [
          { id: 'g2', name: 'G2', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'CUSTOM', model: 'openai/gpt-4o-mini', won: 1, tokens_used: 90 },
        ],
      });

      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe('openai');
      expect(rows[0].model).toBe('gpt-4o-mini');
      expect(rows[0].gamesPlayed).toBe(2); // both distinct games counted
      expect(rows[0].wins).toBe(2);
    });

    it('keeps the honest CUSTOM/openai legacy floor row intact (MAF-GAP-045)', () => {
      // provider='CUSTOM' with model='openai' (no slash) is a REAL model
      // name, not a prefixed spelling — it must keep its identity and not
      // merge into anything.
      repo.seedGame({
        id: 'g045c',
        players: [
          { id: 'g3', name: 'G3', role: 'TOWN', joinOrder: 0, isMafia: false,
            provider: 'CUSTOM', model: 'openai', won: 0, tokens_used: 100 },
        ],
      });

      const rows = repo.getModelStats();
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe('CUSTOM');
      expect(rows[0].model).toBe('openai');
      expect(rows[0].gamesPlayed).toBe(1);
      expect(rows[0].wins).toBe(0);
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
  // getCompareReport (benchmark report — MAF-GAP-036)
  // ==========================================================================

  describe('getCompareReport()', () => {
    it('merges provider-prefixed model spellings into ONE row (MAF-GAP-036)', () => {
      // Live-data shape: some players rows carry the provider inside the
      // model column (openai/openai/gpt-4o-mini), others do not
      // (openai/gpt-4o-mini). Both are the same real model and must
      // aggregate into a single row.
      repo.seedGame({
        id: 'r1', status: 'ENDED',
        players: [
          { id: 'r1p1', name: 'R1P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'openai/gpt-4o-mini', won: 1, tokens_used: 100 },
        ],
      });
      repo.seedGame({
        id: 'r2', status: 'ENDED',
        players: [
          { id: 'r2p1', name: 'R2P1', role: 'VILLAGER', joinOrder: 0,
            provider: 'openai', model: 'gpt-4o-mini', won: 0, tokens_used: 200 },
        ],
      });

      const report = stats.getCompareReport();
      const rows = report.models.filter(
        (m) => m.provider === 'openai' &&
          (m.model === 'gpt-4o-mini' || m.model === 'openai/gpt-4o-mini'),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].provider).toBe('openai');
      expect(rows[0].model).toBe('gpt-4o-mini');
      expect(rows[0].gamesPlayed).toBe(2);
      expect(rows[0].wins).toBe(1);
    });

    it('counts wins from players.won per row — game-level winner never fabricates wins', () => {
      // All three games are won by MAFIA at the game level, but only ONE
      // player row carries won=1. Wins must come from players.won per
      // player-model row, not from the game-level winner.
      repo.seedGame({
        id: 'w1', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
        players: [
          { id: 'w1p1', name: 'W1P1', role: 'TOWN', joinOrder: 0,
            provider: 'openai', model: 'gpt-4o-mini', won: 1 },
        ],
      });
      repo.seedGame({
        id: 'w2', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
        players: [
          { id: 'w2p1', name: 'W2P1', role: 'TOWN', joinOrder: 0,
            provider: 'openai', model: 'gpt-4o-mini', won: 0 },
        ],
      });
      repo.seedGame({
        id: 'w3', status: 'ENDED',
        events: [{ type: 'PHASE_CHANGED', data: { winner: 'MAFIA' }, phase: 'GAME_OVER' }],
        players: [
          { id: 'w3p1', name: 'W3P1', role: 'TOWN', joinOrder: 0,
            provider: 'openai', model: 'gpt-4o-mini', won: 0 },
        ],
      });

      const report = stats.getCompareReport();
      const row = report.models.find(
        (m) => m.provider === 'openai' && m.model === 'gpt-4o-mini',
      );
      expect(row).toBeDefined();
      expect(row!.gamesPlayed).toBe(3);
      expect(row!.wins).toBe(1);
      expect(row!.winRate).toBeCloseTo(1 / 3, 5);
    });

    it('mixed-outcome multi-game aggregates have winRate strictly between 0 and 1', () => {
      repo.seedGame({
        id: 'm1', status: 'ENDED',
        players: [
          { id: 'm1p1', name: 'M1P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'openai/gpt-4o-mini', won: 1 },
        ],
      });
      repo.seedGame({
        id: 'm2', status: 'ENDED',
        players: [
          { id: 'm2p1', name: 'M2P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 0 },
        ],
      });
      repo.seedGame({
        id: 'm3', status: 'ENDED',
        players: [
          { id: 'm3p1', name: 'M3P1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'openai', model: 'gpt-4o-mini', won: 0 },
        ],
      });

      const report = stats.getCompareReport();
      const row = report.models.find(
        (m) => m.provider === 'openai' && m.model === 'gpt-4o-mini',
      );
      expect(row).toBeDefined();
      expect(row!.gamesPlayed).toBe(3);
      expect(row!.wins).toBe(1);
      expect(row!.winRate).toBeGreaterThan(0);
      expect(row!.winRate).toBeLessThan(1);
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

    it('modelPerformance wins agree with the summary winner derivation (MAF-GAP-039)', () => {
      // The report must not contradict itself: the summary counts real
      // game winners (mafiaWinRate) and the per-model rows get wins from
      // those SAME winners via the model's side (players.is_mafia).
      repo.seedGame({
        id: 'r1', status: 'ENDED', winner: 'MAFIA', duration: 60_000,
        players: [
          { id: 'r1a', name: 'M1', role: 'MAFIA', joinOrder: 0, isMafia: true,
            provider: 'OPENAI', model: 'gpt-4', tokens_used: 0 },
          { id: 'r1b', name: 'T1', role: 'VILLAGER', joinOrder: 1, isMafia: false,
            provider: 'ANTHROPIC', model: 'claude-3', tokens_used: 0 },
        ],
      });

      const report = stats.generateReport();
      const summary = report.summary as any;
      const modelPerformance = report.modelPerformance as any[];
      expect(summary.mafiaWinRate).toBe(1);

      const winnerRow = modelPerformance.find(
        (m) => m.provider === 'OPENAI' && m.model === 'gpt-4',
      );
      const loserRow = modelPerformance.find(
        (m) => m.provider === 'ANTHROPIC' && m.model === 'claude-3',
      );
      expect(winnerRow).toBeDefined();
      expect(winnerRow.wins).toBe(1);
      expect(winnerRow.winRate).toBe(1);
      expect(loserRow).toBeDefined();
      expect(loserRow.wins).toBe(0);
      expect(loserRow.winRate).toBe(0);
    });

    it('generateReport populates agentStats from real recorded usage (MAF-GAP-028)', () => {
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000 });
      repo.insertTokenUsage({ gameId: 'g1', playerId: 'p1', turnNumber: 1,
        provider: 'OPENAI', model: 'gpt-4', promptTokens: 100, completionTokens: 50,
        totalTokens: 150, cost: 0.01, timestamp: Date.now() });
      repo.insertApiCall({ gameId: 'g1', playerId: 'p1', provider: 'OPENAI', model: 'gpt-4',
        endpoint: '/chat', latency: 120, timestamp: Date.now() });

      const report = stats.generateReport();
      const agentStats = report.agentStats as any[];
      expect(agentStats.length).toBeGreaterThan(0);
      expect(agentStats[0].agentId).toBe('p1');
      expect(agentStats[0].executions).toBe(1);
      expect(agentStats[0].successes).toBe(1);
      expect(agentStats[0].totalTokens).toBe(150);
      expect(agentStats[0].provider).toBe('OPENAI');
      expect(agentStats[0].model).toBe('gpt-4');
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

    it('generateReport exposes failedGames and stuck-game ids in the summary (MAF-GAP-050)', () => {
      repo.seedGame({
        id: 'stuck1', status: 'CANCELLED', endedAt: 1_700_000_100_000,
      });
      repo.seedGame({ id: 'stuck2', status: 'SETUP' });
      repo.seedGame({ id: 'done', status: 'ENDED', winner: 'TOWN', duration: 30_000 });
      repo.seedGame({ id: 'running', status: 'IN_PROGRESS' });

      const report = stats.generateReport();
      const summary = report.summary as any;
      expect(summary.failedGames).toBe(2);
      expect(summary.failedGameIds).toHaveLength(2);
      expect(summary.failedGameIds[0]).toMatchObject({
        id: 'stuck1',
        status: 'CANCELLED',
        endedAt: '2023-11-14T22:15:00.000Z',
      });
      expect(typeof summary.failedGameIds[0].createdAt).toBe('string');
      expect(summary.failedGameIds[1]).toMatchObject({
        id: 'stuck2',
        status: 'SETUP',
        endedAt: null,
      });
      // MAF-GAP-050 acceptance: the summary reconciles on live data.
      expect(summary.totalGames).toBe(
        summary.activeGames + summary.completedGames + summary.failedGames,
      );
    });

    it('generateReport returns an empty failedGameIds list when every game reached a bucket', () => {
      repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 30_000 });
      repo.seedGame({ id: 'g2', status: 'IN_PROGRESS' });

      const report = stats.generateReport();
      const summary = report.summary as any;
      expect(summary.failedGames).toBe(0);
      expect(summary.failedGameIds).toEqual([]);
    });

    it('generateReport catches errors and returns a fallback object', () => {
      // Drop the games table to force an error path.
      repo.db.exec('DROP TABLE games');
      const report = stats.generateReport();
      const summary = report.summary as any;
      expect(summary.totalGames).toBe(0);
      expect((report as any).error).toBe('Failed to generate report');
      // The response contract stays stable on the error path (MAF-GAP-028).
      expect(report.generatedAt).toBeDefined();
      expect(report.modelPerformance).toEqual([]);
      expect(report.agentStats).toEqual([]);
      expect(report.recommendations).toEqual([]);
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

    it('exportCSV includes the failed games bucket (MAF-GAP-050)', () => {
      repo.seedGame({ id: 'stuck', status: 'CANCELLED' });
      const csv = stats.exportCSV();
      const lines = csv.split('\n');
      expect(lines).toContain('Failed Games,1');
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
