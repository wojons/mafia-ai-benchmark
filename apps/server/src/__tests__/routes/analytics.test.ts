/**
 * GET /api/v1/analytics — totals and eventBreakdown are DB-derived
 * (DF-MAFIA-AI-BENCHMARK-52).
 *
 * The route used to serve `totals.events = 0`, `totals.agents = 0` and
 * `eventBreakdown = {}` as hardcoded literals while the same database held
 * 200,981 event rows across 15 types. Every number below is asserted against
 * the SAME seeded SQLite database the route reads, in the same test, so a
 * literal (especially a constant 0) cannot pass:
 *
 *  - totals.events === SELECT COUNT(*) FROM events
 *  - eventBreakdown is non-empty, carries the real per-type counts, and its
 *    values sum to totals.events
 *  - totals.agents === performance.agents.length (one source, one population)
 *    and equals the number of agent rows the seeded token_usage table holds
 *    whenever that count is under the response cap
 *  - an empty database still reports 0 / {} (no fabricated numbers)
 *
 * The route is booted on an ephemeral port over an in-memory repository that
 * carries the real schema (the pattern of routes/games.validation.test.ts and
 * services/degenerate-games.test.ts) — no live server, no writes outside the
 * process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { StatsCollector } from '../../services/stats-collector.js';
import { createStatsRouter } from '../../routes/stats.js';
import { createSqliteBackedRepository } from '../services/mocks.js';

type SqliteRepo = ReturnType<typeof createSqliteBackedRepository>;

/** Event rows across FOUR types so the breakdown is genuinely multi-bucket. */
function fixtureEventsA() {
  return [
    { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
    { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'I suspect Alice.' }, phase: 'DAY_DISCUSSION' },
    { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'Alice is quiet.' }, phase: 'DAY_DISCUSSION' },
    { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'Bob voted early.' }, phase: 'DAY_DISCUSSION' },
    { type: 'PHASE_CHANGED', data: {}, phase: 'NIGHT_ACTIONS' },
    { type: 'PHASE_CHANGED', data: {}, phase: 'DAY_DISCUSSION' },
    { type: 'GAME_OVER', data: { winner: 'TOWN' }, phase: 'GAME_OVER' },
  ];
}

function fixtureEventsB() {
  return [
    { type: 'GAME_STARTED', data: {}, phase: 'SETUP' },
    { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'Claiming doctor.' }, phase: 'DAY_DISCUSSION' },
    { type: 'AGENT_SAYS_BROADCASTED', data: { says: 'Voting Carol.' }, phase: 'DAY_DISCUSSION' },
    { type: 'PHASE_CHANGED', data: {}, phase: 'GAME_OVER' },
  ];
}

/** Expected per-type counts from the two fixtures above (11 rows, 4 types). */
const EXPECTED_BREAKDOWN: Record<string, number> = {
  GAME_STARTED: 2,
  AGENT_SAYS_BROADCASTED: 5,
  PHASE_CHANGED: 3,
  GAME_OVER: 1,
};

function eventCount(repo: SqliteRepo): number {
  return (
    repo.db.prepare('SELECT COUNT(*) AS count FROM events').get() as {
      count: number;
    }
  ).count;
}

/** Distinct (player, provider, model) triples the agent stats are built from. */
function agentRowCount(repo: SqliteRepo): number {
  return (
    repo.db
      .prepare(
        'SELECT COUNT(*) AS count FROM (SELECT DISTINCT player_id, provider, model FROM token_usage)',
      )
      .get() as { count: number }
  ).count;
}

function seedThreeAgents(repo: SqliteRepo): void {
  const usage = [
    { playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini' },
    { playerId: 'p2', provider: 'anthropic', model: 'claude-sonnet' },
    { playerId: 'p3', provider: 'deepseek', model: 'deepseek-chat' },
  ];
  for (const [i, u] of usage.entries()) {
    repo.insertTokenUsage({
      gameId: 'g1',
      playerId: u.playerId,
      turnNumber: i + 1,
      provider: u.provider,
      model: u.model,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.001,
    });
  }
}

describe('GET /api/v1/analytics — DB-derived totals (DF-MAFIA-AI-BENCHMARK-52)', () => {
  let repo: SqliteRepo;
  let stats: StatsCollector;
  let server: Server;
  let baseUrl: string;

  async function bootRouter(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createStatsRouter({
        statsCollector: stats,
        gameRepository: repo,
      } as any),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function getAnalytics(): Promise<any> {
    const response = await fetch(`${baseUrl}/api/v1/analytics`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    return body.data;
  }

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as SqliteRepo;
    stats = new StatsCollector(repo as any);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('reports totals.events equal to COUNT(*) FROM events and a breakdown that sums to it', async () => {
    repo.seedGame({
      id: 'g1',
      status: 'ENDED',
      winner: 'TOWN',
      duration: 300_000,
      events: fixtureEventsA(),
    });
    repo.seedGame({
      id: 'g2',
      status: 'ENDED',
      winner: 'MAFIA',
      duration: 240_000,
      events: fixtureEventsB(),
    });
    seedThreeAgents(repo);
    await bootRouter();

    // Both numbers in one test: the DB truth and the served value.
    const dbEvents = eventCount(repo);
    expect(dbEvents).toBe(11);

    const data = await getAnalytics();

    expect(data.totals.events).toBe(dbEvents);

    // eventBreakdown: non-empty, real per-type counts, sums to totals.events.
    const breakdown = data.eventBreakdown as Record<string, number>;
    expect(Object.keys(breakdown).length).toBeGreaterThan(0);
    expect(Object.keys(breakdown).sort()).toEqual(
      Object.keys(EXPECTED_BREAKDOWN).sort(),
    );
    for (const [type, expected] of Object.entries(EXPECTED_BREAKDOWN)) {
      const dbTypeCount = (
        repo.db
          .prepare('SELECT COUNT(*) AS count FROM events WHERE type = ?')
          .get(type) as { count: number }
      ).count;
      expect(breakdown[type]).toBe(dbTypeCount);
      expect(breakdown[type]).toBe(expected);
    }
    const breakdownSum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(breakdownSum).toBe(data.totals.events);
  });

  it('reports totals.agents equal to the agent count the response reports under performance.agents', async () => {
    repo.seedGame({
      id: 'g1',
      status: 'ENDED',
      winner: 'TOWN',
      duration: 300_000,
      events: fixtureEventsA(),
    });
    seedThreeAgents(repo);
    await bootRouter();

    // Premise: the agent population source (token_usage) really has rows.
    const dbAgents = agentRowCount(repo);
    expect(dbAgents).toBe(3);

    const data = await getAnalytics();

    expect(Array.isArray(data.performance.agents)).toBe(true);
    expect(data.totals.agents).toBe(data.performance.agents.length);
    expect(data.totals.agents).toBe(dbAgents);
    expect(data.totals.agents).toBeGreaterThan(0);
  });

  it('keeps totals.agents and performance.agents in agreement past the response cap', async () => {
    repo.seedGame({ id: 'g1', status: 'ENDED', winner: 'TOWN', duration: 300_000 });
    // 12 distinct agent triples — more than the 10-row cap on the served list.
    for (let i = 0; i < 12; i += 1) {
      repo.insertTokenUsage({
        gameId: 'g1',
        playerId: `cap-p${i}`,
        turnNumber: i + 1,
        provider: 'openai',
        model: `model-${i}`,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cost: 0.0001,
      });
    }
    await bootRouter();

    expect(agentRowCount(repo)).toBe(12);

    const data = await getAnalytics();

    expect(data.performance.agents.length).toBe(10);
    // The two fields describe the SAME reported rows — no drift, and never 0
    // while the agent table has rows.
    expect(data.totals.agents).toBe(data.performance.agents.length);
    expect(data.totals.agents).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Regression: a constant 0 in the handler must fail this test
  // ==========================================================================

  it('regression: totals.events/totals.agents are not constant 0 while the tables have rows', async () => {
    repo.seedGame({
      id: 'g1',
      status: 'ENDED',
      winner: 'TOWN',
      duration: 300_000,
      events: fixtureEventsA(),
    });
    seedThreeAgents(repo);
    await bootRouter();

    // Premises — both underlying tables really have rows.
    const dbEvents = eventCount(repo);
    const dbAgents = agentRowCount(repo);
    expect(dbEvents).toBeGreaterThan(0);
    expect(dbAgents).toBeGreaterThan(0);

    const data = await getAnalytics();

    // The pre-DF-52 handler served literals 0/0 here; every assertion below
    // fails against that hardcoded version.
    expect(data.totals.events).not.toBe(0);
    expect(data.totals.agents).not.toBe(0);
    expect(data.totals.events).toBe(dbEvents);
    expect(data.totals.agents).toBe(dbAgents);
    expect(Object.keys(data.eventBreakdown).length).toBeGreaterThan(0);
  });

  it('reports 0 events, {} breakdown and 0 agents on an empty database (no fabrication)', async () => {
    await bootRouter();

    expect(eventCount(repo)).toBe(0);
    const data = await getAnalytics();

    expect(data.totals.events).toBe(0);
    expect(data.eventBreakdown).toEqual({});
    expect(data.totals.agents).toBe(0);
    expect(data.performance.agents).toEqual([]);
  });
});
