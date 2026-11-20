import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseMigrator } from '../../db/migrate.js';
import {
  GameRepository,
  buildListGameSummariesQuery,
} from '../../db/repository.js';

/**
 * PERF-MAFIA-8: GET /api/v1/games?status=ENDED took 185-223 ms to return 3
 * rows (unfiltered: 2-5 ms). EXPLAIN QUERY PLAN showed
 *   SEARCH g USING INDEX idx_games_status (status=?)
 *   USE TEMP B-TREE FOR ORDER BY
 * i.e. SQLite walked the whole 4,402-row status partition into a sorter before
 * LIMIT could apply. The fix is `idx_games_status_created` on
 * games(status, created_at DESC): the ORDER BY becomes index-satisfied, so the
 * scan stops as soon as LIMIT is reached.
 *
 * These tests pin the three things that can silently regress:
 *   1. the index is created through the schema/migration path — on a FRESH db
 *      and on an existing db that predates the index (the live container is
 *      the second case and only picks it up on the next boot);
 *   2. the plan for the REAL statement (not a copy) has no
 *      "TEMP B-TREE FOR ORDER BY";
 *   3. the response rows are unchanged — same ids, same fields, same order,
 *      including the equal-created_at tie order.
 *
 * Not asserted: "USE TEMP B-TREE FOR count(DISTINCT)" from the
 * event_actor_count correlated subquery. That is a pre-existing aggregate
 * temp B-tree inside a subquery, unrelated to the ORDER BY and untouched by
 * this index; only ever match on the ORDER BY variant.
 */

const ORDER_BY_TEMP_BTREE = /TEMP B-TREE FOR ORDER BY/i;

/** Insert a game row directly so the test owns created_at exactly. */
function insertGame(
  db: Database.Database,
  id: string,
  createdAt: number,
  status: string,
  extra: { winner?: 'MAFIA' | 'TOWN' | null; endedAt?: number | null } = {},
): void {
  db.prepare(
    `INSERT INTO games (id, created_at, started_at, ended_at, status, config, winner, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    createdAt,
    createdAt + 5,
    extra.endedAt ?? null,
    status,
    JSON.stringify({ numPlayers: 6, winner: extra.winner ?? null }),
    extra.winner ?? null,
    extra.endedAt != null ? extra.endedAt - createdAt : null,
  );
}

function queryPlan(
  db: Database.Database,
  q: { sql: string; params: unknown[] },
): string[] {
  return db
    .prepare('EXPLAIN QUERY PLAN ' + q.sql)
    .all(...q.params)
    .map((row) => (row as { detail: string }).detail);
}

describe('PERF-MAFIA-8 — idx_games_status_created through the schema path', () => {
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    migrator = new DatabaseMigrator(':memory:');
  });

  afterEach(() => {
    migrator.close();
  });

  it('creates games(status, created_at DESC) when a fresh DB is initialized', () => {
    const result = migrator.initialize();
    expect(result.success).toBe(true);

    const db = migrator.getDatabase();
    const indexNames = (
      db.prepare("PRAGMA index_list('games')").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(indexNames).toContain('idx_games_status_created');

    // The plan is only index-satisfied if the column ORDER and DIRECTIONS are
    // right: status ASC (equality prefix) then created_at DESC (the ORDER BY).
    const xinfo = db
      .prepare("PRAGMA index_xinfo('idx_games_status_created')")
      .all() as Array<{ name: string | null; desc: number; key: number }>;
    const keyColumns = xinfo
      .filter((col) => col.key === 1)
      .map((col) => ({ name: col.name, desc: col.desc }));
    expect(keyColumns).toEqual([
      { name: 'status', desc: 0 },
      { name: 'created_at', desc: 1 },
    ]);
  });

  it('is idempotent — re-initializing an existing DB leaves one copy of the index', () => {
    migrator.initialize();
    migrator.initialize();

    const count = migrator
      .getDatabase()
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_games_status_created'",
      )
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('adds the index to a DB created before the index existed (the live container case)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-perf8-'));
    const dbPath = path.join(tmpBase, 'legacy.db');
    try {
      // Reconstruct a pre-fix schema: the same file with the PERF-MAFIA-8
      // CREATE INDEX statement removed, i.e. exactly what a deployed DB holds.
      const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
      const schema = fs
        .readFileSync(schemaPath, 'utf-8')
        .split('\n')
        .filter((line) => !line.includes('idx_games_status_created'))
        .join('\n');
      const legacy = new Database(dbPath);
      legacy.exec(schema);
      // One pre-existing row, so the index build has data to walk.
      insertGame(legacy, 'legacy-1', 1_700_000_000, 'ENDED', { winner: 'TOWN' });
      const before = (
        legacy.prepare("PRAGMA index_list('games')").all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(before).not.toContain('idx_games_status_created');
      legacy.close();

      // Next boot runs the schema through the migrator: CREATE INDEX IF NOT
      // EXISTS adds it without touching data.
      const upgraded = new DatabaseMigrator(dbPath);
      expect(upgraded.initialize().success).toBe(true);
      const db = upgraded.getDatabase();
      const after = (
        db.prepare("PRAGMA index_list('games')").all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(after).toContain('idx_games_status_created');
      expect(
        (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c,
      ).toBe(1);
      upgraded.close();
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});

describe('PERF-MAFIA-8 — the list statement is index-ordered, not sorted', () => {
  let migrator: DatabaseMigrator;
  let repo: GameRepository;

  beforeEach(() => {
    migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
    repo = new GameRepository(migrator.getDatabase());

    // Enough rows that the planner has a real partition to consider (the live
    // shape is 4,402 ENDED rows): 300 ENDED, interleaved with non-ENDED rows.
    const db = migrator.getDatabase();
    const seed = db.transaction(() => {
      for (let i = 0; i < 300; i++) {
        insertGame(db, `ended-${i}`, 1_700_000_000 + i * 60, 'ENDED', {
          winner: i % 3 === 0 ? 'MAFIA' : 'TOWN',
          endedAt: 1_700_000_000 + i * 60 + 300,
        });
        if (i % 5 === 0) {
          insertGame(db, `live-${i}`, 1_700_000_000 + i * 60 + 30, 'IN_PROGRESS');
        }
      }
    });
    seed();
  });

  afterEach(() => {
    migrator.close();
  });

  const FILTERED_SHAPES = [
    { label: 'limit=3', filters: { status: 'ENDED' as const, limit: 3 } },
    { label: 'limit=50', filters: { status: 'ENDED' as const, limit: 50 } },
    { label: 'limit=500', filters: { status: 'ENDED' as const, limit: 500 } },
    {
      label: 'limit=50 offset=100',
      filters: { status: 'ENDED' as const, limit: 50, offset: 100 },
    },
  ];

  it.each(FILTERED_SHAPES)(
    'uses idx_games_status_created with no ORDER BY temp B-tree ($label)',
    ({ filters }) => {
      const plan = queryPlan(
        migrator.getDatabase(),
        buildListGameSummariesQuery(filters),
      );

      expect(plan.join('\n')).toMatch(/idx_games_status_created/);
      expect(plan.some((detail) => ORDER_BY_TEMP_BTREE.test(detail))).toBe(
        false,
      );
    },
  );

  it('control arm: dropping the index reproduces the temp B-tree (the assertion above discriminates)', () => {
    const db = migrator.getDatabase();
    const q = buildListGameSummariesQuery({ status: 'ENDED', limit: 3 });

    expect(
      queryPlan(db, q).some((detail) => ORDER_BY_TEMP_BTREE.test(detail)),
    ).toBe(false);

    db.exec('DROP INDEX idx_games_status_created');
    const preFixPlan = queryPlan(db, q);
    expect(preFixPlan.join('\n')).toMatch(/idx_games_status\b/);
    expect(
      preFixPlan.some((detail) => ORDER_BY_TEMP_BTREE.test(detail)),
    ).toBe(true);
  });

  it('keeps the payload shape and newest-first order for every page size', () => {
    const db = migrator.getDatabase();
    const ordered = db
      .prepare(
        "SELECT id FROM games WHERE status = 'ENDED' ORDER BY created_at DESC, rowid ASC",
      )
      .all() as Array<{ id: string }>;
    const expectedIds = ordered.map((row) => row.id);
    expect(expectedIds).toHaveLength(300);

    const page3 = repo.listGameSummaries({ status: 'ENDED', limit: 3 });
    const page50 = repo.listGameSummaries({ status: 'ENDED', limit: 50 });
    const page500 = repo.listGameSummaries({ status: 'ENDED', limit: 500 });

    expect(page3.map((row) => row.id)).toEqual(expectedIds.slice(0, 3));
    expect(page50.map((row) => row.id)).toEqual(expectedIds.slice(0, 50));
    expect(page500.map((row) => row.id)).toEqual(expectedIds);

    // Offset paging is a contiguous slice of the same order, and every row
    // carries the full list-summary shape (no field pushed out of the row by
    // the index change).
    const paged = repo.listGameSummaries({ status: 'ENDED', limit: 50, offset: 100 });
    expect(paged.map((row) => row.id)).toEqual(expectedIds.slice(100, 150));

    const sample = page3[0];
    expect(Object.keys(sample).sort()).toEqual([
      'config',
      'createdAt',
      'duration',
      'endedAt',
      'id',
      'players',
      'startedAt',
      'status',
      'winner',
    ]);
    // Newest row is ended-299 (created_at ascends with i), and 299 % 3 === 2,
    // so the seeded winner is TOWN — i.e. the projection still reads
    // games.winner, not a column shifted by the index change.
    expect(sample.id).toBe('ended-299');
    expect(sample.winner).toBe('TOWN');
    expect(sample.status).toBe('ENDED');
    expect(sample.endedAt).not.toBeNull();
    expect(sample.players).toBe(0);
  });

  it('preserves the pre-index tie order for rows sharing created_at', () => {
    const db = migrator.getDatabase();
    const tied = 1_700_000_000 + 10_000;
    for (const id of ['tie-b', 'tie-a', 'tie-c']) {
      insertGame(db, id, tied, 'ENDED', { winner: 'TOWN' });
    }

    const q = buildListGameSummariesQuery({ status: 'ENDED' });
    const ids = (db.prepare(q.sql).all(...q.params) as Array<{ id: string }>).map(
      (row) => row.id,
    );
    const tieIds = ids.filter((id) => id.startsWith('tie-'));
    // Equal created_at values come back in insertion (rowid) order — this is
    // the order the pre-fix idx_games_status scan + stable sorter produced, so
    // the index direction does not reshuffle ties.
    expect(tieIds).toEqual(['tie-b', 'tie-a', 'tie-c']);
  });
});
