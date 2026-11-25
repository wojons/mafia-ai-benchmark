import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseMigrator } from '../../db/migrate.js';
import { GameRepository } from '../../db/repository.js';

/**
 * MAF-INIT-001 corpus integrity gate — attribution enforcement + game-level
 * token rollup.
 *
 * The live corpus carried 18/200 unattributed games (players.provider /
 * players.model nullable, nothing enforced) and NULL games.total_tokens /
 * total_cost on all 5,095 rows while token_usage held real data. Both gates
 * live in the WRITE path here:
 *   - addPlayer/upsertPlayer REQUIRE a non-empty provider+model and throw
 *     loudly otherwise; a schema CHECK carries the same rule for fresh
 *     databases (pre-existing schemas never get rewritten, so the TS guard
 *     is the enforcement that always applies).
 *   - updateGameTokenRollup populates the game-level columns from the
 *     recorded token_usage rows at game end (choice (a): populate +
 *     backfill, never dead columns).
 */
describe('MAF-INIT-001 attribution enforcement + game token rollup', () => {
  let repo: GameRepository;
  let db: Database.Database;

  beforeEach(() => {
    const migrator = new DatabaseMigrator(':memory:');
    migrator.initialize();
    db = migrator.getDatabase();
    repo = new GameRepository(db);
  });

  function makeConfig() {
    return {
      numPlayers: 6,
      roles: [],
      nightPhaseDuration: 60,
      dayPhaseDuration: 60,
      votingDuration: 30,
      maxPlayers: 10,
      minPlayers: 2,
      allowSelfVote: true,
      tieBreaker: 'RANDOM' as const,
      enable3D: false,
      enableVoice: false,
      logLevel: 'INFO' as const,
    };
  }

  function seedGame(): string {
    const game = repo.createGame(makeConfig());
    repo.updateGameStatus(game.id, 'IN_PROGRESS');
    return game.id;
  }

  describe('addPlayer() requires provider + model', () => {
    it('persists an attributed player (normal inserts still pass)', () => {
      const gameId = seedGame();
      const player = repo.addPlayer(gameId, 'Alice', undefined, 'openai', 'gpt-4o-mini');
      const row = db.prepare('SELECT provider, model FROM players WHERE id = ?').get(player.id) as {
        provider: string;
        model: string;
      };
      expect(row).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    });

    it('rejects a missing provider loudly, before any row lands', () => {
      const gameId = seedGame();
      expect(() =>
        repo.addPlayer(gameId, 'Bob', undefined, undefined as unknown as string, 'gpt-4o-mini'),
      ).toThrow(/MAF-INIT-001 attribution enforcement.*provider/);
      expect(countPlayers(gameId)).toBe(0);
    });

    it('rejects a missing model loudly', () => {
      const gameId = seedGame();
      expect(() =>
        repo.addPlayer(gameId, 'Bob', undefined, 'openai', undefined as unknown as string),
      ).toThrow(/MAF-INIT-001 attribution enforcement.*model/);
      expect(countPlayers(gameId)).toBe(0);
    });

    it('rejects blank (whitespace-only) attribution', () => {
      const gameId = seedGame();
      expect(() => repo.addPlayer(gameId, 'Bob', undefined, '   ', 'gpt-4o-mini')).toThrow(
        /MAF-INIT-001/,
      );
      expect(() => repo.addPlayer(gameId, 'Bob', undefined, 'openai', '')).toThrow(/MAF-INIT-001/);
      expect(countPlayers(gameId)).toBe(0);
    });
  });

  describe('upsertPlayer() requires provider + model', () => {
    it('persists an attributed roster row with the given id', () => {
      const gameId = seedGame();
      repo.upsertPlayer(gameId, {
        id: 'p-engine-1',
        name: 'Alice',
        role: 'MAFIA',
        isMafia: true,
        joinOrder: 0,
        provider: 'openai',
        model: 'gpt-4o-mini',
      });
      expect(countPlayers(gameId)).toBe(1);
    });

    it('rejects an unattributed roster row loudly', () => {
      const gameId = seedGame();
      expect(() =>
        repo.upsertPlayer(gameId, {
          id: 'p-engine-1',
          name: 'Alice',
          role: 'MAFIA',
          isMafia: true,
          joinOrder: 0,
          provider: undefined as unknown as string,
          model: 'gpt-4o-mini',
        }),
      ).toThrow(/MAF-INIT-001/);
      expect(countPlayers(gameId)).toBe(0);
    });
  });

  describe('schema CHECK (fresh databases)', () => {
    it('refuses a raw INSERT without provider/model', () => {
      const gameId = seedGame();
      expect(() =>
        db.prepare(
          `INSERT INTO players (id, game_id, name, role, join_order)
           VALUES ('raw-1', ?, 'Raw', 'VILLAGER', 0)`,
        ).run(gameId),
      ).toThrow(/CHECK constraint failed/);
    });

    it('refuses a raw INSERT with blank attribution', () => {
      const gameId = seedGame();
      expect(() =>
        db.prepare(
          `INSERT INTO players (id, game_id, name, role, join_order, provider, model)
           VALUES ('raw-2', ?, 'Raw', 'VILLAGER', 0, '  ', 'gpt-4o-mini')`,
        ).run(gameId),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  describe('updateGameTokenRollup() — game-level token rollup (choice (a))', () => {
    it('populates total_tokens/total_cost from the recorded token_usage rows', () => {
      const gameId = seedGame();
      const insert = db.prepare(
        `INSERT INTO token_usage
           (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp)
         VALUES (?, ?, 'p1', 0, 'openai', 'gpt-4o-mini', 100, 50, 150, 0.02, 0)`,
      );
      insert.run('tu-1', gameId);
      insert.run('tu-2', gameId);

      repo.updateGameTokenRollup(gameId);
      const row = db.prepare('SELECT total_tokens, total_cost FROM games WHERE id = ?').get(gameId) as {
        total_tokens: number;
        total_cost: number;
      };
      expect(row.total_tokens).toBe(300);
      expect(row.total_cost).toBeCloseTo(0.04, 12);
    });

    it('leaves the rollup NULL for a game with no usage rows (never a fabricated 0)', () => {
      const gameId = seedGame();
      repo.updateGameTokenRollup(gameId);
      const row = db.prepare('SELECT total_tokens, total_cost FROM games WHERE id = ?').get(gameId) as {
        total_tokens: number | null;
        total_cost: number | null;
      };
      expect(row.total_tokens).toBeNull();
      expect(row.total_cost).toBeNull();
    });

    it('records a real zero when usage rows exist but carry no tokens', () => {
      const gameId = seedGame();
      db.prepare(
        `INSERT INTO token_usage
           (id, game_id, player_id, turn_number, provider, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp)
         VALUES ('tu-zero', ?, 'ALL', 0, 'openai', 'gpt-4o-mini', 0, 0, 0, 0, 0)`,
      ).run(gameId);
      repo.updateGameTokenRollup(gameId);
      const row = db.prepare('SELECT total_tokens, total_cost FROM games WHERE id = ?').get(gameId) as {
        total_tokens: number;
        total_cost: number;
      };
      expect(row.total_tokens).toBe(0);
      expect(row.total_cost).toBe(0);
    });
  });

  function countPlayers(gameId: string): number {
    const row = db.prepare('SELECT COUNT(*) AS c FROM players WHERE game_id = ?').get(gameId) as {
      c: number;
    };
    return row.c;
  }
});
