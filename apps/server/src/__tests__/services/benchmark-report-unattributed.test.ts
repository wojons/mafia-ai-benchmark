/**
 * DF-MAFIA-AI-BENCHMARK-33 — the CUSTOM/* mis-key bucket contract.
 *
 * The legacy adapter's cost-tracking shim (MAF-GAP-018) recorded usage
 * under the CUSTOM passthrough with the PROVIDER NAME in the model column
 * (live data: token_usage provider='CUSTOM', model='openai' — 1101 rows /
 * 208 distinct games / 810,196 avg tokens per game / $0.158 avg cost), and
 * legacy player rows carry the same family ('CUSTOM/qwen3.6-35b-fast').
 * Those aggregates leaked into GET /api/v1/benchmark/report's
 * modelPerformance as ghost "competitor" rows (DF-33: observed
 * {"provider":"CUSTOM","model":"openai","gamesPlayed":208,...} beside the
 * real openai rows, rendered verbatim by the CLI --quick table).
 *
 * Contract pinned here:
 *   1. modelPerformance carries NO CUSTOM-provider rows after key
 *      normalization — rows resolvable behind the passthrough
 *      ('CUSTOM/openai/gpt-4o-mini') re-key to their real provider/model
 *      (MAF-GAP-045) and STAY in the main table with correct counts.
 *   2. The mis-key family moves to an explicit `unattributedModels`
 *      bucket (same row shape + `key`) — auditable, never silently
 *      dropped, never ranked.
 *   3. The bucket field is always present (empty array when nothing is
 *      mis-keyed) so consumers see a stable response shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { StatsCollector } from '../../services/stats-collector.js';
import {
  isUnattributedModelRow,
  partitionModelRows,
} from '../../services/stats-collector/models.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('DF-MAFIA-AI-BENCHMARK-33 — CUSTOM/* mis-key bucket', () => {
  // =====================================================================
  // Unit: the discriminator + partition
  // =====================================================================

  describe('isUnattributedModelRow() / partitionModelRows()', () => {
    it('flags the CUSTOM passthrough rows regardless of the model string', () => {
      // The cost-tracking ghost: provider name stored in the model column.
      expect(isUnattributedModelRow({ provider: 'CUSTOM', model: 'openai' })).toBe(true);
      // The players-table ghost (bare legacy model name).
      expect(
        isUnattributedModelRow({ provider: 'CUSTOM', model: 'qwen3.6-35b-fast' }),
      ).toBe(true);
      // Case-insensitive on the provider.
      expect(isUnattributedModelRow({ provider: 'custom', model: 'anything' })).toBe(true);
      // A prefix-stripped but still-CUSTOM model (defensive: post-
      // normalization rows carry the bare model, never the prefix).
      expect(isUnattributedModelRow({ provider: 'CUSTOM', model: 'gpt-4o-mini' })).toBe(true);
    });
    it('never flags real-backend rows', () => {
      expect(isUnattributedModelRow({ provider: 'openai', model: 'gpt-4o-mini' })).toBe(false);
      expect(isUnattributedModelRow({ provider: 'OPENAI', model: 'gpt-4o' })).toBe(false);
      expect(isUnattributedModelRow({ provider: 'anthropic', model: 'claude-3' })).toBe(false);
      // Non-string garbage (defensive) is never the mis-key family.
      expect(isUnattributedModelRow({ provider: null, model: 'openai' })).toBe(false);
      expect(isUnattributedModelRow(undefined as never)).toBe(false);
      // NOTE: a resolvable-but-still-CUSTOM spelling ('CUSTOM/openai/gpt-4o-mini')
      // is also flagged here, but in practice the partition never sees one —
      // MAF-GAP-045 normalization re-keys it to openai/gpt-4o-mini BEFORE the
      // bucket (pinned by the integration test below via the real StatsCollector).
    });

    it('partitions rows, preserving shape and adding the key on bucket rows', () => {
      const { real, unattributed } = partitionModelRows([
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          gamesPlayed: 3,
          wins: 1,
          winRate: 1 / 3,
          avgTokens: 600,
          avgCost: 0.06,
          avgLatency: 100,
        },
        {
          provider: 'CUSTOM',
          model: 'openai',
          gamesPlayed: 208,
          wins: 0,
          winRate: 0,
          avgTokens: 810196.8,
          avgCost: 0.158,
          avgLatency: 129.4,
        },
      ]);
      expect(real).toHaveLength(1);
      expect(real[0].model).toBe('gpt-4o-mini');
      expect(unattributed).toHaveLength(1);
      expect(unattributed[0].key).toBe('CUSTOM/openai');
      expect(unattributed[0].gamesPlayed).toBe(208);
      expect(unattributed[0].avgTokens).toBe(810196.8);
      expect(unattributed[0].avgLatency).toBe(129.4);
      // The original row shape is preserved on every bucket row.
      for (const field of [
        'provider',
        'model',
        'gamesPlayed',
        'wins',
        'winRate',
        'avgTokens',
        'avgCost',
        'avgLatency',
      ]) {
        expect(field in unattributed[0]).toBe(true);
      }
    });
  });

  // =====================================================================
  // Integration: real StatsCollector + real benchmark router over SQLite
  // =====================================================================

  describe('GET /api/v1/benchmark/report — bucket contract', () => {
    let repo: FakeRepo;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      repo = createSqliteBackedRepository() as unknown as FakeRepo;
      seedFixtures(repo);

      const statsCollector = new StatsCollector(repo as never);
      const app = express();
      app.use(express.json());
      app.use(
        '/',
        createBenchmarkRouter({
          benchmarkRunner: {} as never, // report route never touches the runner
          statsCollector,
        } as never),
      );

      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
      // The "clean repo" test closes its own server instance and nulls the
      // shared closure — tolerate an already-torn-down server here.
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      // PERF-MAFIA-2 report cache is per-repository instance — a fresh
      // repo each test gets a clean cache for free.
      repo.db.close();
    });

    async function fetchReport(): Promise<any> {
      const response = await fetch(`${baseUrl}/api/v1/benchmark/report`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      return body.data;
    }

    it('modelPerformance carries only real models; the mis-key family moves to unattributedModels with its real aggregates', async () => {
      const report = await fetchReport();
      const rows = report.modelPerformance as Array<{
        provider: string;
        model: string;
        gamesPlayed: number;
        wins: number;
        avgTokens: number;
        avgCost: number;
      }>;

      // AC 2: the real row re-keyed from 'CUSTOM/openai/gpt-4o-mini' keeps
      // its full count (1 game, 1 win, usage from its own games).
      const mini = rows.find((r) => r.model === 'gpt-4o-mini');
      expect(mini).toBeDefined();
      expect(mini.provider).toBe('openai');
      expect(mini.gamesPlayed).toBe(1);
      expect(mini.wins).toBe(1);

      // AC 1: no CUSTOM provider row survives in the main table.
      expect(rows.every((r) => r.provider.toUpperCase() !== 'CUSTOM')).toBe(true);

      // The mis-key family lives in the explicit bucket instead:
      const bucket = report.unattributedModels as Array<{
        key: string;
        provider: string;
        model: string;
        gamesPlayed: number;
        wins: number;
        avgTokens: number;
        avgCost: number;
      }>;
      expect(Array.isArray(bucket)).toBe(true);

      // The cost-tracking ghost (token_usage 'CUSTOM/openai' over 2 ended
      // games): exact historical shape — provider name in the model column.
      const openaiGhost = bucket.find((r) => r.key === 'CUSTOM/openai');
      expect(openaiGhost).toBeDefined();
      expect(openaiGhost.model).toBe('openai');
      expect(openaiGhost.gamesPlayed).toBe(2);
      // (1000 + 3000) / 2 — real usage, honestly aggregated, just bucketed.
      expect(openaiGhost.avgTokens).toBe(2000);
      expect(openaiGhost.wins).toBe(0); // unattributable — never guessed

      // The players-table ghost (bare legacy model name).
      const qwenGhost = bucket.find((r) => r.key === 'CUSTOM/qwen3.6-35b-fast');
      expect(qwenGhost).toBeDefined();
      expect(qwenGhost.gamesPlayed).toBe(1);
    });

    it('recommendations never cite an unattributed row as the best model', async () => {
      const report = await fetchReport();
      const recommendations = report.recommendations as string[];
      const bucketKeys = (report.unattributedModels as Array<{ key: string }>).map(
        (r) => r.key,
      );
      for (const rec of recommendations) {
        for (const key of bucketKeys) {
          // The ghost aggregate must not win anything: no recommendation
          // may name a bucketed key as best.
          if (rec.startsWith('Best ')) {
            expect(rec.includes(key)).toBe(false);
          }
        }
      }
    });

    it('keeps unattributedModels present (empty array) when no mis-key rows exist', async () => {
      // A repo whose data carries only real providers.
      const cleanRepo = createSqliteBackedRepository() as unknown as FakeRepo;
      cleanRepo.seedGame({
        id: 'clean-1',
        status: 'ENDED',
        winner: 'TOWN',
        players: [
          {
            id: 'cp1',
            name: 'Clean',
            role: 'VILLAGER',
            joinOrder: 0,
            provider: 'openai',
            model: 'gpt-4o-mini',
            won: 1,
          },
        ],
      });
      const statsCollector = new StatsCollector(cleanRepo as never);
      const app = express();
      app.use(express.json());
      app.use(
        '/',
        createBenchmarkRouter({
          benchmarkRunner: {} as never,
          statsCollector,
        } as never),
      );
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as { port: number };
      const cleanBaseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const response = await fetch(`${cleanBaseUrl}/api/v1/benchmark/report`);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.unattributedModels).toEqual([]);
        expect(body.data.modelPerformance.some((r: any) => r.model === 'gpt-4o-mini')).toBe(
          true,
        );
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        cleanRepo.db.close();
        // Restore the outer afterEach's expectation of a live `server`:
        server = undefined as unknown as Server;
      }
    });
  });
});

/**
 * Seed the fixture shapes DF-33 was filed against (annotated with the
 * historical mis-key shape each row reproduces).
 */
function seedFixtures(repo: FakeRepo): void {
  // -----------------------------------------------------------------
  // A REAL model whose legacy spelling hides behind the passthrough:
  // provider='CUSTOM', model='openai/gpt-4o-mini'. MAF-GAP-045
  // normalization re-keys it to openai/gpt-4o-mini — it must STAY in the
  // main table with its real count (this row is NOT the DF-33 family).
  // -----------------------------------------------------------------
  repo.seedGame({
    id: 'g-real',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pReal',
        name: 'town-real',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'CUSTOM',
        model: 'openai/gpt-4o-mini',
      },
    ],
  });
  repo.insertTokenUsage({
    gameId: 'g-real', playerId: 'pReal', turnNumber: 1,
    provider: 'CUSTOM', model: 'openai/gpt-4o-mini',
    promptTokens: 300, completionTokens: 300, totalTokens: 600, cost: 0.06,
  });

  // -----------------------------------------------------------------
  // DF-33 mis-key family, token_usage source: the legacy cost-tracker
  // recorded the PROVIDER in the model column ('CUSTOM/openai') — live
  // evidence: 1101 rows / 208 games / avg 810,196.8 tokens per game.
  // Two ended games here, unattributed (no players rows).
  // -----------------------------------------------------------------
  repo.seedGame({ id: 'g-miskey-1', status: 'ENDED', winner: 'TOWN' });
  repo.seedGame({ id: 'g-miskey-2', status: 'ENDED', winner: 'MAFIA' });
  repo.insertTokenUsage({
    gameId: 'g-miskey-1', playerId: 'ALL', turnNumber: 0,
    provider: 'CUSTOM', model: 'openai',
    promptTokens: 500, completionTokens: 500, totalTokens: 1000, cost: 0.10,
  });
  repo.insertTokenUsage({
    gameId: 'g-miskey-2', playerId: 'ALL', turnNumber: 0,
    provider: 'CUSTOM', model: 'openai',
    promptTokens: 1500, completionTokens: 1500, totalTokens: 3000, cost: 0.30,
  });

  // -----------------------------------------------------------------
  // DF-33 mis-key family, players-table source: a bare legacy model name
  // under the passthrough ('CUSTOM/qwen3.6-35b-fast' — observed live).
  // -----------------------------------------------------------------
  repo.seedGame({
    id: 'g-qwen',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      {
        id: 'pQwen',
        name: 'legacy-qwen',
        role: 'VILLAGER',
        isMafia: false,
        won: 1,
        joinOrder: 0,
        provider: 'CUSTOM',
        model: 'qwen3.6-35b-fast',
      },
    ],
  });
}