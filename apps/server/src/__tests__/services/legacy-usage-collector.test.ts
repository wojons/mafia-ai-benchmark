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

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

let collector: any;

// Hermetic by default: point the collector at a DB file that does not
// exist so fallback tests never read the real apps/server/data/mafia.db.
const hermeticDbPath = path.join(os.tmpdir(), `mafia-usage-collector-${Date.now()}.db`);

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - legacy CJS module without bundled types
  collector = await import('../../services/legacy-usage-collector.js');
  process.env.DB_PATH = hermeticDbPath;
});

afterAll(() => {
  delete process.env.DB_PATH;
});

afterEach(() => {
  delete process.env.MAFIA_MODEL;
  delete process.env.DOCTOR_MODEL;
  delete process.env.SHERIFF_MODEL;
  delete process.env.VIGILANTE_MODEL;
  delete process.env.VILLAGER_MODEL;
  delete process.env.DEFAULT_MODEL;
  // Restore the hermetic default after tests that pointed at a temp DB.
  process.env.DB_PATH = hermeticDbPath;
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

/** Create a temp SQLite file with a minimal player_model_assignments table. */
function makeAssignmentDb(rows: Array<{ role: string; provider: string; model: string; gameId?: string }>): string {
  const dbPath = path.join(os.tmpdir(), `mafia-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE player_model_assignments (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT,
      role TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    )
  `);
  const insert = db.prepare(
    'INSERT INTO player_model_assignments (id, game_id, player_id, role, provider, model) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    insert.run(
      `pma-${Math.random().toString(36).slice(2, 10)}`,
      row.gameId ?? 'g1',
      'ALL',
      row.role,
      row.provider,
      row.model,
    );
  }
  db.close();
  return dbPath;
}

function cleanupDb(dbPath: string | undefined): void {
  if (!dbPath) return;
  try {
    fs.unlinkSync(dbPath);
  } catch (e) {
    // Already gone — fine.
  }
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

  it('derives fallback rows from persisted player_model_assignments, deduped by model (never from host *_MODEL vars)', async () => {
    // DF-MAFIA-AI-BENCHMARK-2: the collector must mirror what the child
    // actually ran — the persisted assignment rows — not this server's
    // stale env vars. Two roles share one model: dedupe keeps one row.
    const dbPath = makeAssignmentDb([
      { role: 'MAFIA', provider: 'openai', model: 'openai/gpt-4o-mini' },
      { role: 'VILLAGER', provider: 'openai', model: 'openai/gpt-4o-mini' },
      { role: 'DOCTOR', provider: 'anthropic', model: 'anthropic/claude-3' },
    ]);
    process.env.DB_PATH = dbPath;
    process.env.MAFIA_MODEL = 'stale/mafia-model';
    process.env.VIGILANTE_MODEL = 'stale/vigilante-model';
    try {
      const usage = await collector.collectUsage(makeGame(), 'g1');
      expect(usage).toHaveLength(2);
      expect(usage.map((u: any) => u.model).sort()).toEqual(['anthropic/claude-3', 'openai/gpt-4o-mini']);
      expect(usage.some((u: any) => u.model === 'stale/mafia-model')).toBe(false);
      // MAF-GAP-057: prefixed specs keep the FULL spec as the model string
      // (mirroring the engine's tracker spelling) — the provider comes from
      // the spec's first segment / the stored column.
      const mafia = usage.find((u: any) => u.model === 'openai/gpt-4o-mini');
      expect(mafia.provider).toBe('openai');
      expect(mafia.totalTokens).toBe(0);
      expect(mafia.cost).toBe(0);
      expect(mafia.latencyMs).toBe(0);
    } finally {
      delete process.env.DB_PATH;
      cleanupDb(dbPath);
    }
  });

  it('keeps the full spec as the model string for multi-segment role models (MAF-GAP-057)', async () => {
    // Regression: run d7647a7c recorded the second pairing side under a
    // phantom bare 'openai' model because the old split('/') destructure
    // truncated 'CUSTOM/openai/gpt-4o' -> {CUSTOM, openai}. The fallback
    // must keep the lossless spelling from the persisted rows instead.
    const dbPath = makeAssignmentDb([
      { role: 'MAFIA', provider: 'CUSTOM', model: 'CUSTOM/openai/gpt-4o' },
      { role: 'TOWN', provider: 'openai', model: 'openai/gpt-4o' },
    ]);
    process.env.DB_PATH = dbPath;
    process.env.MAFIA_MODEL = 'stale/mafia-model';
    try {
      const usage = await collector.collectUsage(makeGame(), 'g1');
      expect(usage).toHaveLength(2);
      const full = usage.find((u: any) => u.model === 'CUSTOM/openai/gpt-4o');
      const plain = usage.find((u: any) => u.model === 'openai/gpt-4o');
      expect(full).toBeDefined();
      expect(full!.provider).toBe('CUSTOM');
      expect(plain).toBeDefined();
      expect(plain!.provider).toBe('openai');
      // No phantom bare-name rows.
      expect(usage.find((u: any) => u.model === 'openai')).toBeUndefined();
    } finally {
      delete process.env.DB_PATH;
      cleanupDb(dbPath);
    }
  });

  it('falls back to DEFAULT_MODEL once when no persisted assignment rows exist (never host *_MODEL vars)', async () => {
    process.env.MAFIA_MODEL = 'stale/mafia-model';
    process.env.DEFAULT_MODEL = 'openai/gpt-4o';
    try {
      // DB_PATH points at a nonexistent file (beforeAll default): no rows.
      const usage = await collector.collectUsage(makeGame(), 'g1');
      expect(usage).toHaveLength(1);
      expect(usage[0].provider).toBe('openai');
      expect(usage[0].model).toBe('openai/gpt-4o');
      expect(usage[0].totalTokens).toBe(0);
      expect(usage[0].cost).toBe(0);
    } finally {
      delete process.env.DEFAULT_MODEL;
    }
  });

  it('uses the engine default (openai/gpt-4o-mini) when neither assignments nor DEFAULT_MODEL exist', async () => {
    // Mirrors game-engine.js getPlayerModelConfig defaultModel resolution.
    const usage = await collector.collectUsage(makeGame(), 'g1');
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toBe('openai');
    expect(usage[0].model).toBe('openai/gpt-4o-mini');
    expect(usage[0].totalTokens).toBe(0);
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
