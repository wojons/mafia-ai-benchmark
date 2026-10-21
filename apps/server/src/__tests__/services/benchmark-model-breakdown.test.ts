/**
 * DF-MAFIA-AI-BENCHMARK-39 — the leaderboard is a role lottery, not a
 * model benchmark.
 *
 * Store truth (measured on the live store at base 4686d9f): 94% of ENDED
 * games are 5-player, where the mafia side wins 3.7% (147/3967) and town
 * roles win ~99.8%. A model's blended `winRate` was therefore mostly its
 * role-assignment odds, and NEITHER benchmark endpoint published the
 * breakdown that separates skill from role draw:
 *   - /api/v1/benchmark/report modelPerformance rows shipped no
 *     rolePerformance / byNumPlayers at all.
 *   - /api/v1/benchmark/compare models rows carried rolePerformance only
 *     for the CUSTOM/* unattributed bucket; real model rows shipped `{}`
 *     — and NEITHER surface had a per-numPlayers split.
 *
 * Contract pinned here (both endpoints, over a real Express app + real
 * StatsCollector + ephemeral in-memory SQLite — no LLM calls):
 *   1. Every served real-model row carries `rolePerformance` populated
 *      from the REAL players rows — a 5-player corpus must expose the
 *      MAFIA cell AND a town-role cell with non-fabricated numbers
 *      (distinct-game counting: MAF-GAP-048 semantics).
 *   2. Every served real-model row carries `byNumPlayers` keyed by the
 *      game's config.numPlayers ("5") — not a single blended winRate.
 *   3. The breakdown is NOT a 1.0/0.0 lottery artefact: at least one
 *      per-role/per-cell win rate is strictly interior (0 < r < 1),
 *      proving the numbers come from mixed win/loss games, not a
 *      constant-win (all-town) or constant-loss (all-mafia) fixture draw.
 *   4. A game holding the same model TWICE (two roles) counts ONCE in
 *      byNumPlayers' gamesPlayed for that configuration.
 *   5. Key-set invariant survives: report.modelPerformance and
 *      compare.models still agree on the model-row key set; CUSTOM/*
 *      rows stay bucketed in unattributedModels.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createBenchmarkRouter } from '../../routes/benchmark.js';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from './mocks.js';

// Type alias matching the return shape of createSqliteBackedRepository().
type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

type BreakdownEntry = {
  gamesPlayed: number;
  wins: number;
  winRate: number;
};

type ModelRow = {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  rolePerformance: Record<string, BreakdownEntry>;
  byNumPlayers: Record<string, BreakdownEntry>;
};

const rowKey = (row: { provider: string; model: string }): string =>
  `${row.provider}/${row.model}`;

/**
 * Interior-rate check: at least one breakdown cell must sit strictly
 * between 0 and 1. A corpus where every cell is exactly 0 or 1 cannot
 * distinguish "mixed results" from "role lottery on a constant-winner" —
 * this is the anti-lottery guard the row was filed for.
 */
function expectInteriorRateSomewhere(row: ModelRow): void {
  const cells: BreakdownEntry[] = [
    ...Object.values(row.rolePerformance),
    ...Object.values(row.byNumPlayers),
  ];
  const interior = cells.some(
    (c) => c.winRate > 0 && c.winRate < 1,
  );
  expect(interior).toBe(true);
}

describe('DF-MAFIA-AI-BENCHMARK-39 — per-role + per-numPlayers breakdown on served model rows', () => {
  let repo: FakeRepo;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as FakeRepo;
    seedFivePlayerCorpus(repo);

    const statsCollector = new StatsCollector(repo as never);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as never, // these routes never touch the runner
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
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    repo.db.close();
  });

  async function fetchData(path: string): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    return body.data;
  }

  // =====================================================================
  // 1. compare.models — real rows carry a populated rolePerformance AND
  //    a byNumPlayers "5" split.
  // =====================================================================

  it('compare.models exposes per-role win rates and the "5" numPlayers split (not a blended lottery score)', async () => {
    const data = await fetchData('/api/v1/benchmark/compare');
    const rows = data.models as ModelRow[];

    expect(rows.length).toBeGreaterThan(0);

    // Non-vacuity: the seeded real models must actually be on the
    // leaderboard — otherwise the assertions below pass on nothing.
    const keys = rows.map(rowKey);
    expect(keys).toContain('openai/gpt-4o-mini');
    expect(keys).toContain('openai/gpt-4o');

    for (const row of rows) {
      // DF-39: every SERVED row carries both maps (present, possibly
      // honest-empty for usage-only models with no players rows).
      expect(row.rolePerformance).toBeDefined();
      expect(row.byNumPlayers).toBeDefined();
      // Rows WITH players participation must expose non-empty cells.
      if (rowKey(row) === 'CUSTOM/openai' || row.model === 'deepseek-v4-flash') continue;
      const roles = Object.keys(row.rolePerformance);
      expect(roles.length, `${rowKey(row)} rolePerformance`).toBeGreaterThan(0);
      expect(
        Object.keys(row.byNumPlayers).length,
        `${rowKey(row)} byNumPlayers`,
      ).toBeGreaterThan(0);
      for (const entry of Object.values(row.rolePerformance)) {
        expect(entry.gamesPlayed).toBeGreaterThan(0);
        expect(entry.wins).toBeLessThanOrEqual(entry.gamesPlayed);
        expect(entry.winRate).toBeGreaterThanOrEqual(0);
        expect(entry.winRate).toBeLessThanOrEqual(1);
      }
      for (const entry of Object.values(row.byNumPlayers)) {
        expect(entry.gamesPlayed).toBeGreaterThan(0);
        expect(entry.wins).toBeLessThanOrEqual(entry.gamesPlayed);
        expect(entry.winRate).toBeGreaterThanOrEqual(0);
        expect(entry.winRate).toBeLessThanOrEqual(1);
      }
    }

    // The whole point of the row: BOTH real models sat in BOTH roles
    // across the corpus, so each must expose MAFIA (the doomed side that
    // wins 3.7% live) AND at least one town role.
    const mini = rows.find((r) => rowKey(r) === 'openai/gpt-4o-mini')!;
    expect(mini.rolePerformance.MAFIA).toBeDefined();
    const townRoles = Object.keys(mini.rolePerformance).filter(
      (r) => r !== 'MAFIA',
    );
    expect(townRoles.length).toBeGreaterThan(0);

    // The per-configuration split must exist, keyed by numPlayers "5".
    expect(mini.byNumPlayers['5']).toBeDefined();
    expect(mini.byNumPlayers['5'].gamesPlayed).toBeGreaterThan(0);
  });

  it('compare.models breakdown cells are real mixed-outcome counts, not a 1.0/0.0 lottery artefact', async () => {
    // Corpus: gpt-4o-mini lost its mafia game (mafia lost) and won one
    // villager game but lost the other — interior rates somewhere on the
    // row prove cells are counted from real won/lost games, not a
    // constant draw that makes every cell 0.0 or 1.0.
    const data = await fetchData('/api/v1/benchmark/compare');
    const rows = data.models as ModelRow[];

    const mini = rows.find((r) => rowKey(r) === 'openai/gpt-4o-mini')!;
    // MAFIA cell: mafia LOST that game (corpus seeds mafia losses) —
    // 0 wins from real games played.
    expect(mini.rolePerformance.MAFIA.gamesPlayed).toBe(1);
    expect(mini.rolePerformance.MAFIA.wins).toBe(0);
    expect(mini.rolePerformance.MAFIA.winRate).toBe(0);

    // The blended row is NOT the mafia cell: same-model participation in
    // town roles keeps the blended rate strictly above the mafia cell's
    // 0 and strictly below 1 (interior across the corpus).
    expect(mini.winRate).toBeGreaterThan(0);
    expect(mini.winRate).toBeLessThan(1);

    // And at least one breakdown cell carries a strictly interior rate.
    expectInteriorRateSomewhere(mini);
  });

  // =====================================================================
  // 2. report.modelPerformance — the report path carries the SAME
  //    breakdown (the report never published any of this before DF-39).
  // =====================================================================

  it('report.modelPerformance exposes the same per-role win rates and the "5" numPlayers split', async () => {
    const report = await fetchData('/api/v1/benchmark/report');
    const rows = report.modelPerformance as ModelRow[];

    expect(rows.length).toBeGreaterThan(0);
    const keys = rows.map(rowKey);
    expect(keys).toContain('openai/gpt-4o-mini');

    const mini = rows.find((r) => rowKey(r) === 'openai/gpt-4o-mini')!;
    // Non-empty MAFIA + a town role — the role-lottery signature made
    // visible instead of hidden behind a blended winRate.
    expect(mini.rolePerformance.MAFIA).toBeDefined();
    expect(
      Object.keys(mini.rolePerformance).filter((r) => r !== 'MAFIA').length,
    ).toBeGreaterThan(0);
    expect(mini.rolePerformance.MAFIA.gamesPlayed).toBe(1);
    expect(mini.rolePerformance.MAFIA.winRate).toBe(0);

    // Per-configuration split keyed by the game's config.numPlayers.
    expect(mini.byNumPlayers['5']).toBeDefined();
    expect(mini.byNumPlayers['5'].gamesPlayed).toBeGreaterThan(0);
    expect(mini.byNumPlayers['10']).toBeUndefined(); // no 10p games seeded

    expectInteriorRateSomewhere(mini);
  });

  // =====================================================================
  // 3. Distinct-game semantics inside the breakdown (QA-MAFIA-
  //    AI-BENCHMARK-1 lineage): one game holding the same model in TWO
  //    roles counts ONCE in byNumPlayers gamesPlayed for that config.
  // =====================================================================

  it('counts a game holding the same model in two roles ONCE in byNumPlayers (distinct-game semantics)', async () => {
    const dualRepo = createSqliteBackedRepository() as unknown as FakeRepo;
    // One 5-player game: gpt-4o holds MAFIA (slot 0) and DOCTOR (slot 1),
    // plus three villager players of other models. TOWN won, so the
    // VILLAGER row won and MAFIA lost — but BOTH are the same model.
    dualRepo.seedGame({
      id: 'dual-1',
      status: 'ENDED',
      numPlayers: 5,
      winner: 'TOWN',
      players: [
        {
          id: 'dp-mafia', name: 'dual-mafia', role: 'MAFIA', isMafia: true,
          won: 0, joinOrder: 0, provider: 'openai', model: 'gpt-4o',
        },
        {
          id: 'dp-doctor', name: 'dual-doctor', role: 'DOCTOR', isMafia: false,
          won: 1, joinOrder: 1, provider: 'openai', model: 'gpt-4o',
        },
        {
          id: 'dp-v1', name: 'other-a', role: 'VILLAGER', isMafia: false,
          won: 1, joinOrder: 2, provider: 'anthropic', model: 'claude-3',
        },
        {
          id: 'dp-v2', name: 'other-b', role: 'VILLAGER', isMafia: false,
          won: 1, joinOrder: 3, provider: 'anthropic', model: 'claude-3',
        },
        {
          id: 'dp-v3', name: 'other-c', role: 'VILLAGER', isMafia: false,
          won: 1, joinOrder: 4, provider: 'xai', model: 'grok-4',
        },
      ],
    });

    // Non-vacuity floor (mirrors the DF-25/DF-36 test shape): the source
    // of the breakdown really carries the dual-role participation.
    const dualCollector = new StatsCollector(dualRepo as never);
    const app = express();
    app.use(express.json());
    app.use(
      '/',
      createBenchmarkRouter({
        benchmarkRunner: {} as never,
        statsCollector: dualCollector,
      } as never),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    const dualBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${dualBaseUrl}/api/v1/benchmark/compare`);
      const body = await response.json();
      expect(body.success).toBe(true);
      const rows = body.data.models as ModelRow[];
      const fourO = rows.find((r) => rowKey(r) === 'openai/gpt-4o');
      expect(fourO).toBeDefined();

      // Role cells DO separate the two participations (each role played
      // in exactly 1 game; mafia lost, doctor won).
      expect(fourO!.rolePerformance.MAFIA.gamesPlayed).toBe(1);
      expect(fourO!.rolePerformance.MAFIA.wins).toBe(0);
      expect(fourO!.rolePerformance.DOCTOR.gamesPlayed).toBe(1);
      expect(fourO!.rolePerformance.DOCTOR.wins).toBe(1);

      // The configuration cell counts DISTINCT games: 1 game, and the
      // model's side won it (the DOCTOR player's side) — wins follow the
      // real players.won rows, exactly one win per game here.
      expect(fourO!.byNumPlayers['5'].gamesPlayed).toBe(1);
      expect(fourO!.byNumPlayers['5'].wins).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      dualRepo.db.close();
      server = undefined as unknown as Server;
    }
  });

  // =====================================================================
  // 4. Key-set invariant (DF-25/DF-36 lineage): the endpoint surfaces
  //    still agree on the model-row key set, and CUSTOM/* rows stay in
  //    unattributedModels with their breakdown fields honestly present.
  // =====================================================================

  it('keeps report/compare model-row key parity and buckets CUSTOM/* rows away from the leaderboard', async () => {
    const [report, compare] = await Promise.all([
      fetchData('/api/v1/benchmark/report'),
      fetchData('/api/v1/benchmark/compare'),
    ]);

    const reportKeys = (report.modelPerformance as ModelRow[]).map(rowKey).sort();
    const compareKeys = (compare.models as ModelRow[]).map(rowKey).sort();
    expect(compareKeys).toEqual(reportKeys);

    expect(reportKeys.every((k) => !k.toUpperCase().startsWith('CUSTOM/'))).toBe(true);
    expect(
      (compare.unattributedModels as Array<{ key: string }>).every((r) =>
        r.key.toUpperCase().startsWith('CUSTOM/'),
      ),
    ).toBe(true);
  });

  it('serves honest empty breakdown maps for a usage-only model with no players rows', async () => {
    // deepseek-v4-flash exists ONLY as token_usage rows (no players
    // rows): no role was ever recorded, so both maps stay EMPTY — a
    // fabricated cell would be invented data; absence is the honest
    // answer (Bane rule: a NULL must carry a reason, which the empty
    // map + the row's blended row state is).
    const [report, compare] = await Promise.all([
      fetchData('/api/v1/benchmark/report'),
      fetchData('/api/v1/benchmark/compare'),
    ]);

    for (const rows of [
      report.modelPerformance as ModelRow[],
      compare.models as ModelRow[],
    ]) {
      const ds = rows.find((r) => r.model === 'deepseek-v4-flash');
      if (ds) {
        expect(Object.keys(ds.rolePerformance)).toEqual([]);
        expect(Object.keys(ds.byNumPlayers)).toEqual([]);
      }
    }
  });
});

/**
 * Seed a 5-player corpus mirroring the live-store shape the row was
 * filed against: mafia-side losses in 5p games (the 3.7% side) plus
 * same-model town participation, so the blended winRate is provably a
 * role draw and the breakdown separates it. All games are numPlayers=5
 * ENDED games; no LLM calls anywhere.
 *
 *   openai/gpt-4o-mini: MAFIA in g39-1 (mafia lost -> won 0);
 *                       VILLAGER in g39-2 (won) and in g39-3 twice
 *                       (one won, one lost row — distinct-game check
 *                       territory), so its blended rate is interior.
 *   openai/gpt-4o:      DOCTOR in g39-1 (won), VILLAGER in g39-2 (lost).
 */
function seedFivePlayerCorpus(repo: FakeRepo): void {
  // g39-1: TOWN wins. mini = doomed mafia, gpt-4o = winning doctor.
  repo.seedGame({
    id: 'g39-1',
    status: 'ENDED',
    numPlayers: 5,
    winner: 'TOWN',
    players: [
      {
        id: 'p39-1a', name: 'mafia-mini', role: 'MAFIA', isMafia: true,
        won: 0, joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini',
      },
      {
        id: 'p39-1b', name: 'doctor-4o', role: 'DOCTOR', isMafia: false,
        won: 1, joinOrder: 1, provider: 'openai', model: 'gpt-4o',
      },
      {
        id: 'p39-1c', name: 'villager-a', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 2, provider: 'anthropic', model: 'claude-3',
      },
      {
        id: 'p39-1d', name: 'villager-b', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 3, provider: 'xai', model: 'grok-4',
      },
      {
        id: 'p39-1e', name: 'sheriff-a', role: 'SHERIFF', isMafia: false,
        won: 1, joinOrder: 4, provider: 'anthropic', model: 'claude-3',
      },
    ],
  });

  // g39-2: MAFIA wins. mini = losing villager, gpt-4o = losing doctor…
  // wait: both town players lose. claude rides the mafia side and wins.
  repo.seedGame({
    id: 'g39-2',
    status: 'ENDED',
    numPlayers: 5,
    winner: 'MAFIA',
    players: [
      {
        id: 'p39-2a', name: 'mafia-claude', role: 'MAFIA', isMafia: true,
        won: 1, joinOrder: 0, provider: 'anthropic', model: 'claude-3',
      },
      {
        id: 'p39-2b', name: 'villager-mini', role: 'VILLAGER', isMafia: false,
        won: 0, joinOrder: 1, provider: 'openai', model: 'gpt-4o-mini',
      },
      {
        id: 'p39-2c', name: 'doctor-4o-b', role: 'DOCTOR', isMafia: false,
        won: 0, joinOrder: 2, provider: 'openai', model: 'gpt-4o',
      },
      {
        id: 'p39-2d', name: 'villager-c', role: 'VILLAGER', isMafia: false,
        won: 0, joinOrder: 3, provider: 'xai', model: 'grok-4',
      },
      {
        id: 'p39-2e', name: 'sheriff-b', role: 'SHERIFF', isMafia: false,
        won: 0, joinOrder: 4, provider: 'anthropic', model: 'claude-3',
      },
    ],
  });

  // g39-3: TOWN wins. mini plays TWO villager seats in the same game
  // (distinct-game counting pressure) — one seat won, both seats the
  // same model: ONE distinct game.
  repo.seedGame({
    id: 'g39-3',
    status: 'ENDED',
    numPlayers: 5,
    winner: 'TOWN',
    players: [
      {
        id: 'p39-3a', name: 'villager-mini-1', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 0, provider: 'openai', model: 'gpt-4o-mini',
      },
      {
        id: 'p39-3b', name: 'villager-mini-2', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 1, provider: 'openai', model: 'gpt-4o-mini',
      },
      {
        id: 'p39-3c', name: 'mafia-grok', role: 'MAFIA', isMafia: true,
        won: 0, joinOrder: 2, provider: 'xai', model: 'grok-4',
      },
      {
        id: 'p39-3d', name: 'doctor-claude', role: 'DOCTOR', isMafia: false,
        won: 1, joinOrder: 3, provider: 'anthropic', model: 'claude-3',
      },
      {
        id: 'p39-3e', name: 'villager-e', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 4, provider: 'anthropic', model: 'claude-3',
      },
    ],
  });

  // Legacy usage-only game: deepseek-v4-flash, no players rows.
  repo.seedGame({ id: 'g39-6', status: 'ENDED', numPlayers: 5, winner: 'TOWN' });
  repo.insertTokenUsage({
    gameId: 'g39-6', playerId: 'ALL', turnNumber: 1,
    provider: 'openai', model: 'deepseek-v4-flash',
    promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cost: 0.20,
  });

  // DF-33 mis-key ghost: must stay in unattributedModels, not rendered
  // beside the real competitors.
  repo.seedGame({
    id: 'g39-7',
    status: 'ENDED',
    numPlayers: 5,
    winner: 'TOWN',
    players: [
      {
        id: 'p39-7a', name: 'legacy-ghost', role: 'VILLAGER', isMafia: false,
        won: 1, joinOrder: 0, provider: 'CUSTOM', model: 'qwen3.6-35b-fast',
      },
    ],
  });
}