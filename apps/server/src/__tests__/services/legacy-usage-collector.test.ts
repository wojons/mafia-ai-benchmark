/**
 * Unit tests for the legacy usage collector (MAF-GAP-018).
 *
 * Exercises the exact aggregation the legacy bridge emits in its 'done'
 * message: per-model tokens/cost from the engine's CostTracker +
 * TokenTracker, and real per-call latency from the APITracker — the same
 * trackers game-engine.js populates at its real LLM call site
 * (getAIResponse). The game object is a hand-rolled fake with the same
 * surface as MafiaGame; no network, no child process.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

let collector: any;

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - legacy CJS module without bundled types
  collector = await import('../../services/legacy-usage-collector.js');
});

afterEach(() => {
  delete process.env.MAFIA_MODEL;
  delete process.env.DOCTOR_MODEL;
  delete process.env.SHERIFF_MODEL;
  delete process.env.VIGILANTE_MODEL;
  delete process.env.VILLAGER_MODEL;
});

function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'g1',
    costTracker: null,
    tokenTracker: null,
    apiTracker: null,
    ...overrides,
  };
}

describe('collectUsage()', () => {
  it('aggregates tokens/cost from CostTracker and fills the prompt/completion split from TokenTracker', async () => {
    const game = makeGame({
      costTracker: {
        getCostReport: (gameId: string) => ({
          gameId,
          models: [
            { provider: 'openai', model: 'gpt-4o-mini', totalTurns: 12, totalCost: 0.0036, totalTokens: 4500 },
          ],
        }),
      },
      tokenTracker: {
        getGameMetrics: async () => [
          {
            provider: 'openai', model: 'gpt-4o-mini',
            totalPromptTokens: 3000, totalCompletionTokens: 1500, totalTokens: 4500,
            turns: new Array(12), estimatedCost: { totalCost: 0.0036 },
          },
        ],
      },
    });

    const usage = await collector.collectUsage(game);
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toBe('openai');
    expect(usage[0].model).toBe('gpt-4o-mini');
    expect(usage[0].totalTokens).toBe(4500);
    expect(usage[0].promptTokens).toBe(3000);
    expect(usage[0].completionTokens).toBe(1500);
    expect(usage[0].cost).toBeCloseTo(0.0036, 6);
    expect(usage[0].apiCalls).toBe(12);
  });

  it('records real per-model latency from the APITracker call durations', async () => {
    const game = makeGame({
      costTracker: {
        getCostReport: () => ({
          models: [
            { provider: 'openai', model: 'gpt-4o-mini', totalTurns: 3, totalCost: 0.001, totalTokens: 900 },
          ],
        }),
      },
      apiTracker: {
        metrics: new Map([
          ['g1:p1', {
            gameId: 'g1', playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini',
            calls: [{ duration: 1000 }, { duration: 2000 }, { duration: 3000 }],
          }],
          // A different game's calls must not leak into this game's usage.
          ['other:p9', {
            gameId: 'other', playerId: 'p9', provider: 'openai', model: 'gpt-4o-mini',
            calls: [{ duration: 99999 }],
          }],
        ]),
      },
    });

    const usage = await collector.collectUsage(game);
    expect(usage).toHaveLength(1);
    // Mean of 1000/2000/3000 — the foreign game's 99999ms call excluded.
    expect(usage[0].latencyMs).toBe(2000);
  });

  it('never creates a usage row from latency data alone (no fabrication)', async () => {
    const game = makeGame({
      apiTracker: {
        metrics: new Map([
          ['g1:p1', {
            gameId: 'g1', playerId: 'p1', provider: 'openai', model: 'ghost-model',
            calls: [{ duration: 500 }],
          }],
        ]),
      },
    });

    const usage = await collector.collectUsage(game);
    expect(usage.some((u: any) => u.model === 'ghost-model')).toBe(false);
  });

  it('aggregates TokenTracker metrics into per-model rows when CostTracker is absent', async () => {
    const game = makeGame({
      tokenTracker: {
        getGameMetrics: async () => [
          {
            provider: 'anthropic', model: 'claude-3',
            totalPromptTokens: 100, totalCompletionTokens: 50, totalTokens: 150,
            turns: [{}, {}], estimatedCost: { totalCost: 0.001 },
          },
          {
            provider: 'anthropic', model: 'claude-3',
            totalPromptTokens: 200, totalCompletionTokens: 100, totalTokens: 300,
            turns: [{}], estimatedCost: { totalCost: 0.002 },
          },
        ],
      },
    });

    const usage = await collector.collectUsage(game);
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toBe('anthropic');
    expect(usage[0].model).toBe('claude-3');
    expect(usage[0].promptTokens).toBe(300);
    expect(usage[0].completionTokens).toBe(150);
    expect(usage[0].totalTokens).toBe(450);
    expect(usage[0].cost).toBeCloseTo(0.003, 6);
    expect(usage[0].apiCalls).toBe(3);
  });

  it('falls back to env role models with zero usage when no trackers exist (honest zeros, real models)', async () => {
    process.env.MAFIA_MODEL = 'openai/gpt-4o-mini';
    process.env.VILLAGER_MODEL = 'anthropic/claude-3';

    const usage = await collector.collectUsage(makeGame());
    expect(usage).toHaveLength(2);
    const mafia = usage.find((u: any) => u.model === 'gpt-4o-mini');
    expect(mafia.provider).toBe('openai');
    expect(mafia.totalTokens).toBe(0);
    expect(mafia.cost).toBe(0);
    expect(mafia.latencyMs).toBe(0);
  });

  it('returns [] when there are no trackers and no env role models', async () => {
    const usage = await collector.collectUsage(makeGame());
    expect(usage).toEqual([]);
  });
});

describe('collectLatencyByModel()', () => {
  it('returns an empty map when the apiTracker is missing or malformed', () => {
    expect(collector.collectLatencyByModel(makeGame()).size).toBe(0);
    expect(collector.collectLatencyByModel(makeGame({ apiTracker: { metrics: null } })).size).toBe(0);
  });
});

describe('collectUsageByPlayer() (MAF-GAP-029)', () => {
  it('returns per-player rows with real playerId/provider/model/tokens from the TokenTracker', async () => {
    const game = makeGame({
      players: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      tokenTracker: {
        getGameMetrics: async () => [
          {
            gameId: 'g1', playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini',
            totalPromptTokens: 3000, totalCompletionTokens: 1500, totalTokens: 4500,
            turns: new Array(12), estimatedCost: { totalCost: 0.0036 },
          },
          {
            gameId: 'g1', playerId: 'p2', provider: 'anthropic', model: 'claude-3',
            totalPromptTokens: 200, totalCompletionTokens: 100, totalTokens: 300,
            turns: [{}, {}], estimatedCost: { totalCost: 0.002 },
          },
        ],
      },
    });

    const rows = await collector.collectUsageByPlayer(game);
    expect(rows).toHaveLength(2);

    const p1 = rows.find((r: any) => r.playerId === 'p1');
    expect(p1.playerName).toBe('Alice');
    expect(p1.provider).toBe('openai');
    expect(p1.model).toBe('gpt-4o-mini');
    expect(p1.promptTokens).toBe(3000);
    expect(p1.completionTokens).toBe(1500);
    expect(p1.totalTokens).toBe(4500);
    expect(p1.cost).toBeCloseTo(0.0036, 6);
    expect(p1.apiCalls).toBe(12);

    const p2 = rows.find((r: any) => r.playerId === 'p2');
    expect(p2.playerName).toBe('Bob');
    expect(p2.provider).toBe('anthropic');
    expect(p2.model).toBe('claude-3');
    expect(p2.totalTokens).toBe(300);
    expect(p2.cost).toBeCloseTo(0.002, 6);
    expect(p2.apiCalls).toBe(2);
  });

  it('fills apiCalls/latency from APITracker per-player call records without overriding token counts', async () => {
    const game = makeGame({
      tokenTracker: {
        getGameMetrics: async () => [
          {
            gameId: 'g1', playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini',
            totalPromptTokens: 3000, totalCompletionTokens: 1500, totalTokens: 4500,
            turns: new Array(12), estimatedCost: { totalCost: 0.0036 },
          },
        ],
      },
      apiTracker: {
        metrics: new Map([
          ['g1:p1', {
            gameId: 'g1', playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini',
            calls: [{ duration: 1000 }, { duration: 2000 }, { duration: 3000 }],
          }],
          // A different game's calls must not leak into this game's rows.
          ['other:p9', {
            gameId: 'other', playerId: 'p9', provider: 'openai', model: 'gpt-4o-mini',
            calls: [{ duration: 99999 }],
          }],
        ]),
      },
    });

    const rows = await collector.collectUsageByPlayer(game);
    expect(rows).toHaveLength(1);
    const p1 = rows[0];
    // Token tracker stays authoritative for apiCalls (12 turns); the api
    // tracker only contributes the average per-call latency.
    expect(p1.apiCalls).toBe(12);
    expect(p1.latencyMs).toBe(2000);
    expect(rows.some((r: any) => r.playerId === 'p9')).toBe(false);
  });

  it('creates a row from APITracker records alone when the player has no token metric (real calls, zero tokens)', async () => {
    const game = makeGame({
      players: [{ id: 'p1', name: 'Alice' }],
      apiTracker: {
        metrics: new Map([
          ['g1:p1', {
            gameId: 'g1', playerId: 'p1', provider: 'openai', model: 'gpt-4o-mini',
            calls: [{ duration: 400 }, { duration: 600 }],
          }],
        ]),
      },
    });

    const rows = await collector.collectUsageByPlayer(game);
    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe('p1');
    expect(rows[0].provider).toBe('openai');
    expect(rows[0].model).toBe('gpt-4o-mini');
    expect(rows[0].totalTokens).toBe(0);
    expect(rows[0].apiCalls).toBe(2);
    expect(rows[0].latencyMs).toBe(500);
  });

  it('returns [] when no trackers have recorded data (nothing invented)', async () => {
    expect(await collector.collectUsageByPlayer(makeGame())).toEqual([]);
  });
});
