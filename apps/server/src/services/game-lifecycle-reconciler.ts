import { randomUUID } from 'node:crypto';
import type { GameRepository } from '../db/repository.js';
import type { GameEvent } from '@mafia/shared/events';
import { healthcheckFailed } from '../observability/metrics.js';
import {
  classifyGameLiveness,
  newestGameActivity,
  type GameLivenessRow,
} from './game-liveness.js';

/**
 * Liveness is NOT decided here (OBS-006): `classifyGameLiveness` in
 * ./game-liveness.ts is the one definition of "live" / "orphan" / "ghost",
 * shared with the mafia_game_in_progress gauge so the alarm and the retirement
 * seam can never disagree. This window is only about what retirement may DO:
 * it is the age at which an already-orphaned row is safe to cancel — long
 * enough that a restart, a slow deploy or a stale read cannot destroy a game
 * the owner still intends to resume, which is why it is a day and not seconds.
 */
export const STALE_IN_PROGRESS_MAX_MS = 24 * 60 * 60 * 1000;

export interface GameLifecycleReconcileSummary {
  inspected: number;
  retired: number;
  retiredNeverStarted: number;
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
  player_count: number;
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
      retiredNeverStarted: 0,
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
          MAX(e.timestamp) AS last_event_at,
          (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS player_count
        FROM games g
        LEFT JOIN events e ON e.game_id = g.id
        WHERE g.status = 'IN_PROGRESS'
        GROUP BY g.id, g.created_at, g.started_at
      `).all() as InProgressRow[];
      const liveIds = this.liveGameIds();
      const now = this.now();

      for (const row of rows) {
        summary.inspected += 1;

        // OBS-006: the liveness verdict comes from the ONE shared rule, not
        // from a local opinion — the same call decides mafia_game_in_progress.
        const evidence: GameLivenessRow = {
          id: row.id,
          createdAt: row.created_at,
          startedAt: row.started_at,
          lastEventAt: row.last_event_at,
          playerCount: row.player_count,
        };
        const verdict = classifyGameLiveness(evidence, { liveGameIds: liveIds, now });

        if (verdict === 'live') {
          summary.preservedLive += 1;
          continue;
        }

        // DF-MAFIA-AI-BENCHMARK-23-R3: a never-started ghost. An
        // IN_PROGRESS row with no started_at and zero player rows was
        // created but its owner crashed before any play began, so no
        // engine can ever own it again: no heartbeat evidence can make it
        // live and no engine can advance it. Retire it immediately
        // instead of preserving it as "recent" for the whole age window
        // while read surfaces advertise it as live.
        if (verdict === 'never_started') {
          const changed = this.retireAsCancelled(db, now, row.id, 'never started: no engine owner, started_at NULL, zero players');
          if (changed > 0) {
            summary.retired += 1;
            summary.retiredNeverStarted += 1;
          }
          continue;
        }

        // Only an orphan is even a retirement candidate, and retirement is
        // destructive: it keeps its own conservative age window. A
        // 'pending_registration' row may still be mid-registration, and
        // 'unattributable' means no evidence at all — neither is proof of
        // staleness, so both are preserved and re-examined on the next pass.
        const lastActivity = newestGameActivity(evidence);
        if (
          verdict !== 'orphan' ||
          lastActivity === null ||
          now - lastActivity <= this.staleAfterMs
        ) {
          summary.preservedRecent += 1;
          continue;
        }

        const changed = this.retireAsCancelled(db, now, row.id, 'never started or activity stale beyond window');
        if (changed > 0) summary.retired += 1;
      }
    } catch {
      // Reconciliation must fail closed: an unavailable/legacy schema must
      // never turn a read request into an invented terminal state.
    }

    return summary;
  }

  /**
   * Marks an IN_PROGRESS row CANCELLED and records why, following the
   * convention of the existing retire/cancel paths: the row's ended_at is
   * stamped and a GAME_CANCELLED event (reason in its data, mirroring the
   * GAME_ENDED event data shape) is appended to the game's event stream so
   * the retirement is auditable from the event log, not just the log line.
   * The conditional UPDATE keeps the pass idempotent and safe against a
   * concurrent terminal write.
   */
  private retireAsCancelled(
    db: NonNullable<ReturnType<GameRepository['getDatabase']>>,
    now: number,
    gameId: string,
    reason: string,
  ): number {
    const result = db.prepare(`
      UPDATE games
      SET status = 'CANCELLED', ended_at = ?
      WHERE id = ? AND status = 'IN_PROGRESS'
    `).run(now, gameId);
    if (result.changes === 0) return 0;

    try {
      const event: Omit<GameEvent, 'id' | 'gameId' | 'timestamp'> = {
        type: 'GAME_CANCELLED',
        visibility: 'PUBLIC',
        data: { reason },
        metadata: {
          turnNumber: 0,
          dayNumber: 0,
          phase: 'SETUP',
          sequence: 0,
        },
      };
      const eventId = randomUUID();
      db.prepare(`
        INSERT INTO events (id, game_id, type, timestamp, visibility, actor_id, target_id, data, turn_number, day_number, phase, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        gameId,
        event.type,
        now,
        event.visibility,
        event.actorId ?? null,
        event.targetId ?? null,
        JSON.stringify(event.data),
        event.metadata.turnNumber,
        event.metadata.dayNumber,
        event.metadata.phase,
        event.metadata.sequence,
      );
    } catch {
      // The status transition is the durable part of the retirement; the
      // reason event is evidence of the WHY and must never undo it.
      healthcheckFailed('db_write');
    }
    return 1;
  }
}

export default GameLifecycleReconciler;
