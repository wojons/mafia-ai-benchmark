/**
 * OBS-006: the ONE definition of game liveness and orphanhood.
 *
 * Design authority: docs/observability-spec.md §3.3. Two seams consume this
 * module and they must never disagree:
 *
 *  - `GameLifecycleReconciler` decides which persisted rows it may retire
 *    (destructive, 24 h window);
 *  - `refreshStorageGauges` decides which rows `mafia_game_in_progress`
 *    reports as orphaned (the alarm a fleet alert pages on).
 *
 * The rule is OWNER-FIRST. A game is live while this process holds it: a
 * `GameEngine` game in memory, or a legacy adapter game whose bridge child
 * process has not exited. Activity recency is NOT ownership — a row whose last
 * event is one second old but which no engine or bridge child owns is already
 * an ORPHAN, because nobody can advance it. (OBS-003 got this backwards: its
 * 5 minute `ORPHAN_GAME_STALE_MS` window outranked the live set, so a game
 * whose bridge child was just killed read as "owned" for up to five minutes —
 * the gauge silently under-reported exactly the case an alert fires on.)
 *
 * Timestamps are only used to answer a narrower question: "did this row ever
 * get a chance to start?" A row that was written moments ago may still be
 * mid-registration (the DB insert and the in-memory registration are two
 * steps), so it is reported as pending rather than orphaned. One grace
 * constant covers that gap.
 */

/**
 * A row created/started/touched less than this recently may still be
 * mid-registration (persist-then-register is not atomic). Not a liveness
 * window: after the grace elapses, an unowned row is an orphan regardless of
 * how fresh its events are.
 */
export const GAME_REGISTRATION_GRACE_MS = 5_000;

/** What a persisted IN_PROGRESS row contributes to the decision. */
export interface GameLivenessRow {
  id: string;
  /** games.created_at (epoch ms), null when the column is empty/legacy. */
  createdAt: number | null;
  /** games.started_at (epoch ms), null for a row that never started. */
  startedAt: number | null;
  /**
   * Newest events.timestamp for the game, ONLY when the caller already paid
   * for it. The maintenance query that feeds the gauge deliberately does not
   * aggregate `events` (OBS-006), so it passes nothing here — recency cannot
   * outrank ownership anyway, so the value only ever refines the grace rule.
   */
  lastEventAt?: number | null;
  /** players rows for the game (0 for a never-started ghost). */
  playerCount: number;
}

/** The closed verdict set. */
export type GameLiveness =
  | 'live'
  | 'never_started'
  | 'orphan'
  | 'pending_registration'
  | 'unattributable';

export interface GameLivenessContext {
  /** Ids this process owns right now (see collectLiveGameIds). */
  liveGameIds: ReadonlySet<string>;
  /** Injectable clock, epoch ms. */
  now: number;
  /** Override GAME_REGISTRATION_GRACE_MS. */
  registrationGraceMs?: number;
}

/** Newest timestamp evidence on a row, or null when it has none. */
export function newestGameActivity(row: GameLivenessRow): number | null {
  const evidence = [row.createdAt, row.startedAt, row.lastEventAt].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return evidence.length > 0 ? Math.max(...evidence) : null;
}

/**
 * Classify one IN_PROGRESS row.
 *
 * `live` wins over every timestamp — that is the whole point of OBS-006.
 */
export function classifyGameLiveness(
  row: GameLivenessRow,
  context: GameLivenessContext,
): GameLiveness {
  if (context.liveGameIds.has(row.id)) return 'live';

  // A created-but-never-started ghost: no engine can ever own it again.
  if (row.startedAt === null && row.playerCount === 0) return 'never_started';

  const newest = newestGameActivity(row);
  if (newest === null) return 'unattributable'; // no evidence is not proof

  const grace = context.registrationGraceMs ?? GAME_REGISTRATION_GRACE_MS;
  if (context.now - newest < grace) return 'pending_registration';
  return 'orphan';
}

/** True for the verdicts the orphan alarm counts. */
export function isOrphanVerdict(verdict: GameLiveness): boolean {
  return verdict === 'orphan' || verdict === 'never_started';
}

/** The slice of a child process the liveness rule needs. */
export interface BridgeChildLike {
  exitCode: number | null;
  signalCode: string | null;
}

/**
 * True while the bridge child is still running. Only OS-confirmed evidence
 * counts: `exitCode`/`signalCode` are set by Node when the process exits, so a
 * child that merely received a signal it ignores is still alive.
 */
export function isBridgeChildAlive(child: BridgeChildLike | null | undefined): boolean {
  if (!child) return false;
  return child.exitCode === null && (child.signalCode ?? null) === null;
}

/** One source of live game ids held in memory by this process. */
export interface LiveGameSource {
  getActiveGames(): Iterable<string>;
  /** Optional narrower predicate; when absent every active id is live. */
  isLive?(gameId: string): boolean;
}

/** Union of the ids every source still owns. Never throws. */
export function collectLiveGameIds(
  sources: ReadonlyArray<LiveGameSource | null | undefined>,
): Set<string> {
  const live = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    let ids: Iterable<string>;
    try {
      ids = source.getActiveGames();
    } catch {
      continue; // a dying registry is not a liveness claim either way
    }
    for (const gameId of ids) {
      if (source.isLive) {
        try {
          if (!source.isLive(gameId)) continue;
        } catch {
          continue;
        }
      }
      live.add(gameId);
    }
  }
  return live;
}

/** An engine whose active ids are all live (it has no child process). */
export function engineLiveGameSource(engine: { getActiveGames(): string[] }): LiveGameSource {
  return { getActiveGames: () => engine.getActiveGames() };
}

/** The slice of LegacyGameAdapter / LegacyGameState this module reads. */
export interface LegacyBridgeAdapter {
  getActiveGames(): string[];
  getGameState(gameId: string): { status: string; process?: BridgeChildLike | null } | undefined;
}

/**
 * A legacy adapter game is live only while it is RUNNING *and* its bridge
 * child has not exited. The adapter keeps the game in its map until the child
 * 'close' handler runs, so `getActiveGames()` alone over-reports by exactly the
 * window OBS-006 is about.
 */
export function legacyBridgeLiveGameSource(adapter: LegacyBridgeAdapter): LiveGameSource {
  return {
    getActiveGames: () => adapter.getActiveGames(),
    isLive: (gameId: string): boolean => {
      const state = adapter.getGameState(gameId);
      if (!state) return false;
      if (state.status !== 'RUNNING') return false;
      return state.process ? isBridgeChildAlive(state.process) : true;
    },
  };
}
