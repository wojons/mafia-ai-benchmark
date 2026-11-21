import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatsCollector } from '../../services/stats-collector.js';
import { createSqliteBackedRepository } from '../services/mocks.js';

/**
 * DF-MAFIA-AI-BENCHMARK-53: a measurement script wrote raw SQL into the live
 * demo database and left one game row behind in an impossible shape —
 * status='IN_PROGRESS' with started_at/ended_at/winner all NULL while its
 * transcript already carried a GAME_ENDED event. The read path derived the
 * winner from the transcript, so GET /api/v1/games/<id> served
 * `winner: "TOWN"` TOGETHER WITH `status: "IN_PROGRESS"`: a self-contradiction
 * on a product surface, and the row inflated the "live games" counter.
 *
 * The guards under test are read-only:
 *   1. GameRepository.getGame() warns (naming the id and the shape) and serves
 *      the row as ENDED, with the terminal event's timestamp as endedAt, so no
 *      served field contradicts another. It never writes a repair.
 *   2. StatsCollector.getGameStats() drops decided `IN_PROGRESS` rows
 *      from activeGames in BOTH counting branches, and keeps the
 *      MAF-GAP-050 identity (total = active + completed + failed) intact by
 *      demoting them into failedGames.
 */

const CORRUPT_GAME_ID = '37c65720-f984-454d-9e81-a5405dd992dc';

type FakeRepo = ReturnType<typeof createSqliteBackedRepository>;

describe('inconsistent live game row (DF-MAFIA-AI-BENCHMARK-53)', () => {
  let repo: FakeRepo;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The logger honours LOG_LEVEL lazily on every call; make sure the warning
    // level is enabled so the spy observes the guard firing.
    vi.stubEnv('LOG_LEVEL', 'info');
    repo = createSqliteBackedRepository();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  /**
   * The winner exists only in the transcript. A fresh start time proves the
   * fallback stats path excludes the row for its outcome, not its age.
   */
  function seedCorruptedLiveGame(): void {
    repo.seedGame({
      id: CORRUPT_GAME_ID,
      status: 'IN_PROGRESS',
      winner: null,
      startedAt: Date.now(),
      events: [
        {
          type: 'AGENT_SAYS_BROADCASTED',
          data: { playerId: 'p1', says: 'I trust nobody.' },
          phase: 'DAY_DISCUSSION',
          dayNumber: 3,
          turnNumber: 11,
        },
        {
          type: 'GAME_ENDED',
          data: { winner: 'TOWN' },
          phase: 'GAME_OVER',
          dayNumber: 3,
          turnNumber: 12,
        },
      ],
    });
  }

  function seedHealthyGames(): void {
    // A genuine live game: undecided, no winner, fresh heartbeat.
    repo.seedGame({ id: 'live-game', status: 'IN_PROGRESS', winner: null, startedAt: Date.now() });
    // A genuine completed game. duration > 120000 keeps it out of the
    // degenerate exclusion, so it counts as completed in stats.
    repo.seedGame({
      id: 'ended-game',
      status: 'ENDED',
      winner: 'MAFIA',
      startedAt: Date.now() - 300_000,
      endedAt: Date.now(),
      duration: 300_000,
    });
  }

  describe('GameRepository.getGame() detail read', () => {
    it('warns naming the id and serves the corrupted row as ENDED, not live', () => {
      seedCorruptedLiveGame();

      const game = repo.getGame(CORRUPT_GAME_ID);

      expect(game).not.toBeNull();
      // A warning naming the id and the shape was emitted (the read path may
      // also log unrelated warnings, so match the guard's line, not a count).
      const guardCall = warn.mock.calls.find((call) => String(call[0]).includes(CORRUPT_GAME_ID));
      expect(guardCall).toBeDefined();
      const line = String(guardCall![0]);
      expect(line).toContain('status=IN_PROGRESS');
      expect(line).toContain('winner=TOWN');
      // Served fields agree with each other: ENDED + winner + GAME_OVER + end.
      expect(game!.status).toBe('ENDED');
      expect(game!.winner).toBe('TOWN');
      expect(game!.currentState.phase).toBe('GAME_OVER');
      // The terminal event's timestamp becomes endedAt (the row has none).
      expect(game!.endedAt).toBeInstanceOf(Date);
      const summary = repo.listGameSummaries().find((item) => item.id === CORRUPT_GAME_ID);
      expect(summary?.status).toBe('ENDED');
      expect(summary?.winner).toBe('TOWN');
    });

    it('never relabels or warns about a genuine IN_PROGRESS game', () => {
      repo.seedGame({ id: 'live-game', status: 'IN_PROGRESS', winner: null, startedAt: Date.now() });
      repo.addEvent('live-game', {
        type: 'PHASE_CHANGED',
        visibility: 'PUBLIC',
        data: { from: 'SETUP', to: 'DAY_DISCUSSION' },
        metadata: { turnNumber: 2, dayNumber: 1, phase: 'DAY_DISCUSSION', sequence: 1 },
      });

      const game = repo.getGame('live-game');

      expect(warn).not.toHaveBeenCalled();
      expect(game!.status).toBe('IN_PROGRESS');
      expect(game!.currentState.phase).toBe('DAY_DISCUSSION');
      expect(game!.winner).toBeUndefined();
    });
  });

  describe('StatsCollector.getGameStats() activeGames', () => {
    it('excludes the corrupted row but keeps a genuine live game (lifecycle seam)', () => {
      const collector = new StatsCollector(repo as any, {
        reconcile: () => {},
      } as any);
      seedHealthyGames();
      seedCorruptedLiveGame();

      const stats = collector.getGameStats();

      expect(stats.activeGames).toBe(1); // only 'live-game'
      expect(stats.completedGames).toBe(1); // only 'ended-game'
      expect(stats.failedGames).toBe(1); // the corrupted row, demoted
      expect(stats.totalGames).toBe(3);
      // MAF-GAP-050 identity still reconciles.
      expect(stats.activeGames + stats.completedGames + stats.failedGames).toBe(
        stats.totalGames,
      );
    });

    it('applies the same exclusion on the no-lifecycle fallback branch', () => {
      const collector = new StatsCollector(repo as any);
      seedHealthyGames();
      seedCorruptedLiveGame();

      const stats = collector.getGameStats();

      expect(stats.activeGames).toBe(1);
      expect(stats.activeGames + stats.completedGames + stats.failedGames).toBe(
        stats.totalGames,
      );
    });
  });
});
