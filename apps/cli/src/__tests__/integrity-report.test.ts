/**
 * Tests for the MAF-INIT-001 corpus integrity report.
 *
 * The counts are pure SQL over a real SQLite database — no live server, no
 * docker. The fixture schema mirrors the games/players columns the report
 * reads, WITHOUT the MAF-INIT-001 players CHECK: the report exists to audit
 * the HISTORICAL corpus (pre-CHECK schemas carry the unattributed rows the
 * write-path enforcement just made impossible). Command-level tests drive
 * the action against a temp DB file, asserting the machine-readable gate
 * line and the loud missing-file failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import {
  computeIntegrityCounts,
  renderIntegrityTable,
  serializeIntegrityJson,
} from '../integrity-format.js';
import { IntegrityReportCommand } from '../commands/integrity.js';

const FIXTURE_SCHEMA = `
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'SETUP',
    total_cost REAL
  );
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    FOREIGN KEY (game_id) REFERENCES games(id)
  );
`;

function openFixtureDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(FIXTURE_SCHEMA);
  return db;
}

function seedGame(
  db: Database.Database,
  id: string,
  status: string,
  opts: { totalCost?: number | null } = {},
): void {
  db.prepare(`INSERT INTO games (id, status, total_cost) VALUES (?, ?, ?)`)
    .run(id, status, opts.totalCost ?? null);
}

function seedPlayer(
  db: Database.Database,
  id: string,
  gameId: string,
  provider: string | null,
  model: string | null,
): void {
  db.prepare(
    `INSERT INTO players (id, game_id, name, role, provider, model)
     VALUES (?, ?, 'p', 'VILLAGER', ?, ?)`,
  ).run(id, gameId, provider, model);
}

describe('computeIntegrityCounts (MAF-INIT-001)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openFixtureDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('counts status totals and the with-cost column', () => {
    seedGame(db, 'g1', 'ENDED', { totalCost: 0.5 });
    seedGame(db, 'g2', 'ENDED');
    seedGame(db, 'g3', 'CANCELLED');
    seedGame(db, 'g4', 'IN_PROGRESS', { totalCost: 0.0 });

    const counts = computeIntegrityCounts(db);
    expect(counts).toEqual({
      total: 4,
      ended: 2,
      cancelled: 1,
      single_model: 0,
      mixed_model: 0,
      unattributed: 4,
      // with-cost = a POPULATED column (0.0 is real recorded data, NULL is
      // absence) — never "cost > 0".
      with_cost: 2,
    });
  });

  it('classifies single-model vs mixed-model vs unattributed per game', () => {
    seedGame(db, 'g-single', 'ENDED');
    seedPlayer(db, 'p1', 'g-single', 'openai', 'gpt-4o-mini');
    seedPlayer(db, 'p2', 'g-single', 'openai', 'gpt-4o-mini');

    seedGame(db, 'g-mixed', 'ENDED');
    seedPlayer(db, 'p3', 'g-mixed', 'openai', 'gpt-4o-mini');
    seedPlayer(db, 'p4', 'g-mixed', 'anthropic', 'claude-3');

    seedGame(db, 'g-unattr', 'ENDED');
    seedPlayer(db, 'p5', 'g-unattr', 'openai', 'gpt-4o-mini');
    seedPlayer(db, 'p6', 'g-unattr', null, 'gpt-4o-mini');

    seedGame(db, 'g-norows', 'ENDED');

    const counts = computeIntegrityCounts(db);
    expect(counts.total).toBe(4);
    expect(counts.single_model).toBe(1);
    expect(counts.mixed_model).toBe(1);
    expect(counts.unattributed).toBe(2);
    // The three classes partition the corpus.
    expect(counts.single_model + counts.mixed_model + counts.unattributed).toBe(counts.total);
  });

  it('treats blank (whitespace) attribution as unattributed', () => {
    seedGame(db, 'g-blank', 'ENDED');
    seedPlayer(db, 'p-blank', 'g-blank', '  ', 'gpt-4o-mini');
    expect(computeIntegrityCounts(db).unattributed).toBe(1);
  });

  it('returns honest zeros for an empty corpus', () => {
    expect(computeIntegrityCounts(db)).toEqual({
      total: 0,
      ended: 0,
      cancelled: 0,
      single_model: 0,
      mixed_model: 0,
      unattributed: 0,
      with_cost: 0,
    });
  });
});

describe('integrity-report rendering (MAF-INIT-001)', () => {
  const counts = {
    total: 5095,
    ended: 4999,
    cancelled: 42,
    single_model: 4700,
    mixed_model: 239,
    unattributed: 156,
    with_cost: 4999,
  };

  it('renders every named count in the human table', () => {
    const table = renderIntegrityTable(counts);
    for (const key of ['total', 'ENDED', 'CANCELLED', 'single-model', 'mixed-model', 'unattributed', 'with-cost']) {
      expect(table).toContain(key);
    }
    expect(table).toContain('5095');
    expect(table).toContain('156');
  });

  it('serializes the machine-readable gate line (fixed key order)', () => {
    const line = serializeIntegrityJson(counts);
    expect(JSON.parse(line)).toEqual(counts);
    expect(line.endsWith('\n')).toBe(true);
  });
});

describe('integrity-report command (file-backed DB)', () => {
  let tmpBase: string;
  let dbPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(path.join(tmpdir(), 'mafia-integrity-'));
    dbPath = path.join(tmpBase, 'test.db');
    const db = openFixtureDb(dbPath);
    seedGame(db, 'g1', 'ENDED', { totalCost: 1.25 });
    seedPlayer(db, 'p1', 'g1', 'openai', 'gpt-4o-mini');
    seedGame(db, 'g2', 'CANCELLED');
    db.close();
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  async function runAction(opts: { db: string; json: boolean }): Promise<string[]> {
    const cmd = new IntegrityReportCommand();
    const out: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m) => out.push(String(m)));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`__exit_${code}`);
    }) as (code?: string | number | null) => never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optsSpy = vi.spyOn(cmd as any, 'opts').mockReturnValue(opts);
    try {
      await cmd.run();
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
      optsSpy.mockRestore();
    }
    return out;
  }

  it('--json emits exactly one machine-readable line on stdout', async () => {
    const out = await runAction({ db: dbPath, json: true });
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]);
    expect(parsed).toEqual({
      total: 2,
      ended: 1,
      cancelled: 1,
      single_model: 1,
      mixed_model: 0,
      unattributed: 1,
      with_cost: 1,
    });
  });

  it('fails loudly on a missing DB file (never creates an empty one)', async () => {
    const missing = path.join(tmpBase, 'missing.db');
    let exitCode: number | undefined;
    const err: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((m) => err.push(String(m)));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      exitCode = typeof code === 'number' ? code : undefined;
      throw new Error(`__exit_${code}`);
    }) as (code?: string | number | null) => never);
    const cmd = new IntegrityReportCommand();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optsSpy = vi.spyOn(cmd as any, 'opts').mockReturnValue({ db: missing, json: true });
    try {
      await cmd.run();
      throw new Error('expected run() to exit non-zero');
    } catch (e) {
      expect((e as Error).message).toBe('__exit_1');
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
      optsSpy.mockRestore();
    }
    expect(exitCode).toBe(1);
    expect(err.join('\n')).toContain('Cannot open game database');
    expect(require('fs').existsSync(missing)).toBe(false);
  });
});
