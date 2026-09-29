import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseMigrator } from '../../db/migrate.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * RELENG-MAFIA-20260928-04: legacy ENDED games carry a NULL/empty
 * games.winner because older runs predate the column write (MAF-GAP-056
 * fixed the writer, not the store). initialize() backfills the winner from
 * the most recent GAME_ENDED event's $.winner, only when it is MAFIA or
 * TOWN. Idempotent: re-running initialize() is a no-op.
 */
describe('DatabaseMigrator — RELENG-MAFIA-20260928-04 games.winner backfill', () => {
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
  });

  afterEach(() => {
    migrator.close();
  });

  function seedGame(id: string, status: string, winner: string | null): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO games (id, status, winner, config) VALUES (?, ?, ?, '{}')`)
      .run(id, status, winner);
  }

  function insertEvent(id: string, gameId: string, type: string, phase: string, data: Record<string, unknown>): void {
    migrator.getDatabase().prepare(`
      INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
      VALUES (?, ?, ?, unixepoch(), 'PUBLIC', NULL, NULL, ?, 1, 1, ?, 1)
    `).run(id, gameId, type, JSON.stringify(data), phase);
  }

  function winnerOf(id: string): string | null {
    const row = migrator.getDatabase().prepare('SELECT winner FROM games WHERE id = ?').get(id) as { winner: string | null };
    return row.winner;
  }

  it('backfills winner TOWN from a GAME_ENDED event on an ENDED game with NULL winner', () => {
    seedGame('g1', 'ENDED', null);
    insertEvent('e1', 'g1', 'GAME_ENDED', 'GAME_OVER', { winner: 'TOWN', reason: 'All mafia eliminated' });
    migrator.initialize(); // re-run applies the backfill
    expect(winnerOf('g1')).toBe('TOWN');
  });

  it('backfills winner MAFIA and leaves an existing winner untouched', () => {
    seedGame('g2', 'ENDED', null);
    insertEvent('e2', 'g2', 'GAME_ENDED', 'GAME_OVER', { winner: 'MAFIA' });
    seedGame('g3', 'ENDED', 'TOWN');
    insertEvent('e3', 'g3', 'GAME_ENDED', 'GAME_OVER', { winner: 'MAFIA' });
    migrator.initialize();
    expect(winnerOf('g2')).toBe('MAFIA');
    expect(winnerOf('g3')).toBe('TOWN');
  });

  it('uses the most recent GAME_ENDED event (latest rowid wins)', () => {
    seedGame('g4', 'ENDED', null);
    insertEvent('e4a', 'g4', 'GAME_ENDED', 'GAME_OVER', { winner: 'MAFIA' });
    insertEvent('e4b', 'g4', 'GAME_ENDED', 'GAME_OVER', { winner: 'TOWN' });
    migrator.initialize();
    expect(winnerOf('g4')).toBe('TOWN');
  });

  it('leaves NULL when the GAME_ENDED winner is UNKNOWN', () => {
    seedGame('g5', 'ENDED', null);
    insertEvent('e5', 'g5', 'GAME_ENDED', 'GAME_OVER', { winner: 'UNKNOWN' });
    migrator.initialize();
    expect(winnerOf('g5')).toBeNull();
  });

  it('leaves non-ENDED games and games without GAME_ENDED events untouched', () => {
    seedGame('g6', 'IN_PROGRESS', null);
    insertEvent('e6', 'g6', 'GAME_ENDED', 'GAME_OVER', { winner: 'MAFIA' });
    seedGame('g7', 'ENDED', null); // no events at all
    migrator.initialize();
    expect(winnerOf('g6')).toBeNull();
    expect(winnerOf('g7')).toBeNull();
  });

  it('is idempotent — a second initialize() run is a no-op with no error', () => {
    seedGame('g8', 'ENDED', null);
    insertEvent('e8', 'g8', 'GAME_ENDED', 'GAME_OVER', { winner: 'TOWN' });
    const first = migrator.initialize();
    expect(first.success).toBe(true);
    expect(winnerOf('g8')).toBe('TOWN');
    const second = migrator.initialize();
    expect(second.success).toBe(true);
    expect(winnerOf('g8')).toBe('TOWN');
  });
});

/**
 * File-backed variant: prove the backfill round-trips through the same
 * on-disk path the live DB uses (initialize -> seed -> initialize x2), not
 * just the :memory: case.
 */
describe('DatabaseMigrator — winner backfill on a file-backed temp DB', () => {
  let tmpBase: string;
  let dbPath: string;
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-winner-backfill-'));
    dbPath = path.join(tmpBase, 'test.db');
  });

  afterEach(() => {
    migrator?.close();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  function openAndSeed(): void {
    migrator = new DatabaseMigrator(dbPath);
    migrator.initialize();
    migrator.getDatabase()
      .prepare(`INSERT INTO games (id, status, winner, config) VALUES ('g1', 'ENDED', NULL, '{}')`)
      .run();
    migrator.getDatabase().prepare(`
      INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
      VALUES ('e1', 'g1', 'GAME_ENDED', unixepoch(), 'PUBLIC', NULL, NULL, ?, 1, 1, 'GAME_OVER', 1)
    `).run(JSON.stringify({ winner: 'TOWN' }));
  }

  function winnerOf(): string | null {
    const row = migrator.getDatabase().prepare(`SELECT winner FROM games WHERE id = 'g1'`).get() as { winner: string | null };
    return row.winner;
  }

  it('seeds NULL, backfills to TOWN, and a re-opened initialize() run leaves it unchanged', () => {
    openAndSeed();
    expect(winnerOf()).toBeNull(); // seeded NULL: initialize() does not rewrite seeded rows
    const seededWinner = winnerOf();

    migrator.close();
    migrator = new DatabaseMigrator(dbPath);
    const first = migrator.initialize();
    expect(first.success).toBe(true);
    expect(winnerOf()).toBe('TOWN');
    expect(winnerOf()).not.toBe(seededWinner);

    migrator.close();
    migrator = new DatabaseMigrator(dbPath);
    const second = migrator.initialize();
    expect(second.success).toBe(true);
    expect(winnerOf()).toBe('TOWN');
  });
});
