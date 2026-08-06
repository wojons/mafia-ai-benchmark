import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseMigrator } from '../../db/migrate.js';

/**
 * MAF-GAP-005: legacy terminal STATE_CHANGE events were stored with type
 * GAME_STARTED (a completed game's final transition looked like a game
 * START). initialize() now backfills those rows to GAME_ENDED. The backfill
 * is idempotent: after the adapter fix, no new rows match the terminal
 * signature, so re-running initialize() is a no-op.
 */
describe('DatabaseMigrator — MAF-GAP-005 terminal event backfill', () => {
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
    // events.game_id has an FK to games(id); seed one minimal game row.
    migrator.getDatabase()
      .prepare(`INSERT INTO games (id, config) VALUES ('g1', '{}')`)
      .run();
  });

  function insertEvent(id: string, type: string, phase: string, data: Record<string, unknown>): void {
    migrator.getDatabase().prepare(`
      INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
      VALUES (?, 'g1', ?, unixepoch(), 'PUBLIC', NULL, NULL, ?, 1, 1, ?, 1)
    `).run(id, type, JSON.stringify(data), phase);
  }

  function typeOf(id: string): string {
    const row = migrator.getDatabase().prepare('SELECT type FROM events WHERE id = ?').get(id) as { type: string };
    return row.type;
  }

  it('rewrites mislabeled terminal events (type GAME_STARTED + phase GAME_OVER) to GAME_ENDED', () => {
    insertEvent('e1', 'GAME_STARTED', 'GAME_OVER', { winner: 'MAFIA', mafiaAlive: [true], townAlive: [false, false] });
    migrator.initialize(); // re-run applies the backfill
    expect(typeOf('e1')).toBe('GAME_ENDED');
  });

  it('rewrites mislabeled terminal events detected by winner in data (no GAME_OVER phase)', () => {
    insertEvent('e2', 'GAME_STARTED', 'DAY_VOTING', { winner: 'TOWN', mafiaAlive: [false], townAlive: [true, true] });
    migrator.initialize();
    expect(typeOf('e2')).toBe('GAME_ENDED');
  });

  it('leaves legitimate GAME_STARTED events untouched', () => {
    insertEvent('e3', 'GAME_STARTED', 'SETUP', { status: 'IN_PROGRESS' });
    insertEvent('e4', 'GAME_STARTED', 'DAY_DISCUSSION', { status: 'IN_PROGRESS' });
    migrator.initialize();
    expect(typeOf('e3')).toBe('GAME_STARTED');
    expect(typeOf('e4')).toBe('GAME_STARTED');
  });

  it('is a no-op when nothing is mislabeled (idempotent re-runs)', () => {
    insertEvent('e5', 'GAME_ENDED', 'GAME_OVER', { winner: 'MAFIA' });
    insertEvent('e6', 'GAME_STARTED', 'SETUP', {});
    migrator.initialize();
    migrator.initialize();
    expect(typeOf('e5')).toBe('GAME_ENDED');
    expect(typeOf('e6')).toBe('GAME_STARTED');
  });
});
