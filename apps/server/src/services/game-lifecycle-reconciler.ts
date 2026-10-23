import type { GameRepository } from '../db/repository.js';

/**
 * A persisted IN_PROGRESS row is only trustworthy while its owner is present
 * in one of the server's in-memory game registries, or while its persisted
 * heartbeat evidence is recent. The age window is deliberately conservative:
 * a live adapter game is always preserved by the owner check, while a game
 * left behind by a restart is retired once its last known activity is stale.
 */
export const STALE_IN_PROGRESS_MAX_MS = 24 * 60 * 60 * 1000;

export interface GameLifecycleReconcileSummary {
  inspected: number;
  retired: number;
  preservedLive: number;
  preservedRecent: number;
}

export interface GameLifecycleReconcilerOptions {
  liveGameIds?: () => ReadonlySet<string>;
  now?: () => number;
  staleAfterMs?: number;
}

interface InProgressRow {
  id: string;
  created_at: number | null;
  started_at: number | null;
  last_event_at: number | null;
}

/**
 * Reconciles persisted games with the current process' game owners.
 *
 * This is intentionally a synchronous, idempotent seam. Startup calls it
 * before serving traffic, and read surfaces call it again so a row that was
 * discovered after startup cannot remain advertised as live forever. The
 * conditional UPDATE prevents a second pass (or a concurrent terminal write)
 * from changing an already-transitioned game.
 */
export class GameLifecycleReconciler {
  private readonly liveGameIds: () => ReadonlySet<string>;
  private readonly now: () => number;
  private readonly staleAfterMs: number;

  constructor(
    private readonly gameRepository: GameRepository,
    options: GameLifecycleReconcilerOptions = {},
  ) {
    this.liveGameIds = options.liveGameIds ?? (() => new Set<string>());
    this.now = options.now ?? (() => Date.now());
    this.staleAfterMs = options.staleAfterMs ?? STALE_IN_PROGRESS_MAX_MS;
  }

  reconcile(): GameLifecycleReconcileSummary {
    const summary: GameLifecycleReconcileSummary = {
      inspected: 0,
      retired: 0,
      preservedLive: 0,
      preservedRecent: 0,
    };

    try {
      const db = this.gameRepository.getDatabase();
      const rows = db.prepare(`
        SELECT
          g.id,
          g.created_at,
          g.started_at,
          MAX(e.timestamp) AS last_event_at
        FROM games g
        LEFT JOIN events e ON e.game_id = g.id
        WHERE g.status = 'IN_PROGRESS'
        GROUP BY g.id, g.created_at, g.started_at
      `).all() as InProgressRow[];
      const liveIds = this.liveGameIds();
      const now = this.now();

      for (const row of rows) {
        summary.inspected += 1;
        if (liveIds.has(row.id)) {
          summary.preservedLive += 1;
          continue;
        }

        const activityTimes = [row.created_at, row.started_at, row.last_event_at]
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        const lastActivity = activityTimes.length > 0 ? Math.max(...activityTimes) : null;

        // No timestamp is not proof that a game is stale. Leave it alone and
        // let the next pass observe a real timestamp rather than cancelling a
        // row on incomplete legacy data.
        if (lastActivity === null || now - lastActivity <= this.staleAfterMs) {
          summary.preservedRecent += 1;
          continue;
        }

        const result = db.prepare(`
          UPDATE games
          SET status = 'CANCELLED', ended_at = ?
          WHERE id = ? AND status = 'IN_PROGRESS'
        `).run(now, row.id);
        if (result.changes > 0) summary.retired += 1;
      }
    } catch {
      // Reconciliation must fail closed: an unavailable/legacy schema must
      // never turn a read request into an invented terminal state.
    }

    return summary;
  }
}

export default GameLifecycleReconciler;
