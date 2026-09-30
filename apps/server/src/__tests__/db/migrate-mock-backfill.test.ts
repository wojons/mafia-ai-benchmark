import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseMigrator } from '../../db/migrate.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * MAF-REV-002: historical ENDED games from the dead-endpoint era completed
 * with real-looking events but ZERO real token usage (every provider call
 * fell back to the engine's canned-mock responses). DF-MAFIA-AI-BENCHMARK-12
 * added the write-time flag for NEW games; games completed BEFORE that fix
 * were never flagged. initialize() backfills: an ENDED game with the mock
 * flag absent is flagged mock=1 (stamped $.mockBackfilledAt) iff NO usage
 * row anywhere (token_usage / players / player_game_stats) carries
 * tokens > 0. Games with any real usage stay unflagged. Idempotent:
 * re-running initialize() is a no-op and the stamp is stable.
 */
describe('DatabaseMigrator — MAF-REV-002 historical mock-game backfill', () => {
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
  });

  afterEach(() => {
    migrator.close();
  });

  function seedGame(id: string, status: string, config = '{}'): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO games (id, status, config) VALUES (?, ?, ?)`)
      .run(id, status, config);
  }

  function seedPlayer(id: string, gameId: string, tokensUsed: number): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO players (id, game_id, name, role, join_order, tokens_used)
                VALUES (?, ?, 'p', 'VILLAGER', 1, ?)`)
      .run(id, gameId, tokensUsed);
  }

  function seedTokenUsage(id: string, gameId: string, totalTokens: number): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO token_usage
                (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, timestamp)
                VALUES (?, ?, 'ALL', 0, 'openai', 'gpt-4o-mini', 0, 0, ?, unixepoch())`)
      .run(id, gameId, totalTokens);
  }

  function seedPlayerGameStats(id: string, gameId: string, tokensUsed: number): void {
    migrator.getDatabase()
      .prepare(`INSERT INTO player_game_stats (id, game_id, player_id, role, tokens_used)
                VALUES (?, ?, 'ALL', 'VILLAGER', ?)`)
      .run(id, gameId, tokensUsed);
  }

  function configOf(id: string): Record<string, unknown> {
    const row = migrator.getDatabase()
      .prepare('SELECT config FROM games WHERE id = ?')
      .get(id) as { config: string };
    return JSON.parse(row.config);
  }

  it('flags a zero-usage historical ENDED game with mock=1 and stamps mockBackfilledAt', () => {
    seedGame('g-zero', 'ENDED');
    seedPlayer('p-zero-1', 'g-zero', 0);
    seedPlayer('p-zero-2', 'g-zero', 0);
    seedTokenUsage('tu-zero', 'g-zero', 0); // config-derived fallback row, all zero
    migrator.initialize(); // re-run applies the backfill
    const config = configOf('g-zero');
    expect(config.mock).toBe(1);
    expect(typeof config.mockBackfilledAt).toBe('number');
    expect(config.mockBackfilledAt).toBeGreaterThan(0);
  });

  it('flags a zero-usage ENDED game that has NO usage rows at all', () => {
    // The live historical cluster: players exist, no token_usage row ever
    // recorded tokens (write-time rule requires the payload PRESENT; the
    // backfill treats absence of any positive usage as the signal).
    seedGame('g-norows', 'ENDED');
    seedPlayer('p-norows-1', 'g-norows', 0);
    migrator.initialize();
    expect(configOf('g-norows').mock).toBe(1);
  });

  it('does NOT flag a game with real token_usage tokens', () => {
    seedGame('g-tu', 'ENDED');
    seedPlayer('p-tu', 'g-tu', 0);
    seedTokenUsage('tu-real', 'g-tu', 1234);
    migrator.initialize();
    expect(configOf('g-tu').mock).toBeUndefined();
    expect(configOf('g-tu').mockBackfilledAt).toBeUndefined();
  });

  it('does NOT flag a game with real players.tokens_used', () => {
    seedGame('g-pl', 'ENDED');
    seedPlayer('p-pl-real', 'g-pl', 500);
    migrator.initialize();
    expect(configOf('g-pl').mock).toBeUndefined();
  });

  it('does NOT flag a game with real player_game_stats tokens', () => {
    seedGame('g-pgs', 'ENDED');
    seedPlayer('p-pgs', 'g-pgs', 0);
    seedTokenUsage('tu-pgs', 'g-pgs', 0);
    seedPlayerGameStats('pgs-real', 'g-pgs', 77);
    migrator.initialize();
    expect(configOf('g-pgs').mock).toBeUndefined();
  });

  it('never touches a DF-12 write-time-flagged game (mock=1 without stamp stays as-is)', () => {
    seedGame('g-wt', 'ENDED', '{"mock":1}');
    seedTokenUsage('tu-wt', 'g-wt', 0);
    migrator.initialize();
    const config = configOf('g-wt');
    expect(config.mock).toBe(1);
    // The backfill guard is $.mockBackfilledAt IS NULL on rows still
    // missing the flag — a write-time-flagged row is left untouched, so
    // it keeps its original config (no stamp injected).
    expect(config.mockBackfilledAt).toBeUndefined();
  });

  it('never touches a game with an explicit mock=0 (brief: config.mock absent only)', () => {
    seedGame('g-explicit0', 'ENDED', '{"mock":0}');
    seedTokenUsage('tu-explicit0', 'g-explicit0', 0);
    migrator.initialize();
    const config = configOf('g-explicit0');
    expect(config.mock).toBe(0);
    expect(config.mockBackfilledAt).toBeUndefined();
  });

  it('leaves non-ENDED games untouched even with zero usage', () => {
    seedGame('g-progress', 'IN_PROGRESS');
    seedGame('g-setup', 'SETUP');
    migrator.initialize();
    expect(configOf('g-progress').mock).toBeUndefined();
    expect(configOf('g-setup').mock).toBeUndefined();
  });

  it('is idempotent — a second initialize() run changes nothing and the stamp is stable', () => {
    seedGame('g-idem', 'ENDED');
    seedPlayer('p-idem', 'g-idem', 0);
    const first = migrator.initialize();
    expect(first.success).toBe(true);
    const afterFirst = configOf('g-idem');
    expect(afterFirst.mock).toBe(1);
    expect(typeof afterFirst.mockBackfilledAt).toBe('number');

    const second = migrator.initialize();
    expect(second.success).toBe(true);
    const afterSecond = configOf('g-idem');
    expect(afterSecond).toEqual(afterFirst); // stamp stable, nothing rewritten
  });

  it('flags only the games that qualify — a mixed batch keeps real games countable', () => {
    seedGame('g-mock-a', 'ENDED');
    seedTokenUsage('tu-mock-a', 'g-mock-a', 0);
    seedGame('g-real-a', 'ENDED');
    seedTokenUsage('tu-real-a', 'g-real-a', 42);
    seedGame('g-real-b', 'ENDED');
    seedPlayer('p-real-b', 'g-real-b', 9);
    migrator.initialize();
    const db = migrator.getDatabase();
    const flagged = db.prepare(
      `SELECT COUNT(*) as c FROM games
       WHERE COALESCE(json_extract(config, '$.mock'), 0) = 1`,
    ).get() as { c: number };
    expect(flagged.c).toBe(1);
  });
});

/**
 * File-backed variant: prove the backfill + stamp stability round-trip
 * through the same on-disk path the live DB uses (initialize -> seed ->
 * reopen -> initialize x2), not just the :memory: case.
 */
describe('DatabaseMigrator — mock backfill on a file-backed temp DB', () => {
  let tmpBase: string;
  let dbPath: string;
  let migrator: DatabaseMigrator;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-mock-backfill-'));
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
      .prepare(`INSERT INTO games (id, status, config) VALUES ('g1', 'ENDED', '{}')`)
      .run();
  }

  function configOf(): Record<string, unknown> {
    const row = migrator.getDatabase()
      .prepare(`SELECT config FROM games WHERE id = 'g1'`)
      .get() as { config: string };
    return JSON.parse(row.config);
  }

  it('flags on reopen, and a second reopen leaves the flag and stamp unchanged', () => {
    openAndSeed();
    expect(configOf().mock).toBeUndefined(); // seeded unflagged

    migrator.close();
    migrator = new DatabaseMigrator(dbPath);
    const first = migrator.initialize();
    expect(first.success).toBe(true);
    const afterFirst = configOf();
    expect(afterFirst.mock).toBe(1);
    expect(typeof afterFirst.mockBackfilledAt).toBe('number');

    migrator.close();
    migrator = new DatabaseMigrator(dbPath);
    const second = migrator.initialize();
    expect(second.success).toBe(true);
    expect(configOf()).toEqual(afterFirst);
  });
});
