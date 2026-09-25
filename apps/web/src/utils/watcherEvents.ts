/**
 * Watcher event derivation (DF-MAFIA-AI-BENCHMARK-11).
 *
 * Single derivation used for BOTH recorded history (GET /games/:id/events)
 * and live WS rows, so a spectator's votes/discussion/timeline are identical
 * whether events arrive live or are replayed from history. Raw event rows
 * arrive as plain JSON (HTTP) or as the WS `GAME_EVENT` payload; both are
 * normalized here before derivation.
 */
import type { GameEvent, Vote } from '@mafia/shared/types';

export interface WatcherEvent {
  id: string;
  gameId?: string;
  type: string;
  timestamp: Date;
  visibility: string;
  actorId?: string;
  targetId?: string;
  data: Record<string, unknown>;
  metadata: {
    turnNumber: number;
    dayNumber: number;
    phase: string;
    sequence: number;
  };
}

export interface WatcherStatement {
  playerName: string;
  statement: string;
  timestamp: Date;
}

export interface WatcherTimelineItem {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Normalize one raw event row — from GET /games/:id/events history OR from
 * a WS `GAME_EVENT` payload — into a WatcherEvent. Accepts either the raw
 * event object or the full server envelope `{ type: 'GAME_EVENT', payload }`.
 * Returns null for rows that are not derivable game events (SSE
 * `connected`, malformed rows).
 */
export function normalizeWsEvent(
  input: unknown,
  fallbackGameId?: string,
): WatcherEvent | null {
  let row = input;

  const record = asObject(row);
  if (record.type === 'GAME_EVENT' && record.payload && typeof record.payload === 'object') {
    row = record.payload;
  }

  if (!row || typeof row !== 'object') return null;
  const r = asObject(row);

  const type = str(r.type);
  if (!type || type === 'connected') return null;

  const meta = asObject(r.metadata);
  const tsRaw = r.timestamp;
  let timestamp = tsRaw instanceof Date ? tsRaw : new Date(tsRaw as string | number);
  if (Number.isNaN(timestamp.getTime())) timestamp = new Date(0);

  const id =
    str(r.id) ??
    `${type}:${str(meta.sequence) ?? '0'}:${Number.isNaN(timestamp.getTime()) ? '0' : timestamp.getTime()}`;

  return {
    id,
    gameId: str(r.gameId) ?? fallbackGameId,
    type,
    timestamp,
    visibility: str(r.visibility) ?? 'PUBLIC',
    actorId: str(r.actorId),
    targetId: str(r.targetId),
    data: asObject(r.data),
    metadata: {
      turnNumber: Number(meta.turnNumber ?? 0) || 0,
      dayNumber: Number(meta.dayNumber ?? 0) || 0,
      phase: str(meta.phase) ?? 'UNKNOWN',
      sequence: Number(meta.sequence ?? 0) || 0,
    },
  };
}

/**
 * Merge hydrated history with live WS events, deduplicating by event id.
 * History rows come first (authoritative recorded order); live-only rows are
 * appended. Result is sorted chronologically by sequence then timestamp.
 */
export function mergeEventsById(
  history: WatcherEvent[],
  live: WatcherEvent[],
): WatcherEvent[] {
  const byId = new Map<string, WatcherEvent>();
  for (const event of history) {
    byId.set(event.id, event);
  }
  for (const event of live) {
    if (!byId.has(event.id)) {
      byId.set(event.id, event);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) =>
      a.metadata.sequence - b.metadata.sequence ||
      a.timestamp.getTime() - b.timestamp.getTime(),
  );
}

/**
 * Human-readable one-liner for the recent-events timeline. This is the same
 * vocabulary the WS handler used for live events (GameWatcher's
 * generateEventMessage), now applied identically to hydrated history rows.
 */
export function describeEvent(event: WatcherEvent): string | null {
  const data = event.data;
  switch (event.type) {
    case 'PHASE_CHANGED': {
      const toPhase = str(data.toPhase) ?? str(data.to);
      return toPhase ? `Phase changed to ${toPhase.replace(/_/g, ' ')}` : null;
    }
    case 'PLAYER_KILLED':
    case 'PLAYER_LYNCHED': {
      const name =
        str(data.playerName) ?? str(data.name) ?? event.targetId ?? event.actorId;
      if (!name) return null;
      const role = str(data.role) ?? str(data.playerRole);
      const verb = event.type === 'PLAYER_LYNCHED' ? 'lynched' : 'killed';
      return `${name} was ${verb}${role ? ` (${role})` : ''}`;
    }
    case 'AGENT_SAYS_BROADCASTED': {
      const statement =
        str(data.statement) ?? str(data.says) ?? str(data.message);
      if (!statement) return null;
      const name = str(data.playerName) ?? str(data.name) ?? event.actorId;
      return `${name ?? 'Unknown'}: "${statement}"`;
    }
    case 'VOTE_CAST': {
      const voterId = str(data.voterId) ?? event.actorId;
      const targetId = str(data.targetId) ?? event.targetId;
      if (!voterId && !targetId) return null;
      return `${voterId ?? 'Unknown'} voted for ${targetId ?? 'Unknown'}`;
    }
    case 'WINNER_DETERMINED': {
      const winner = str(data.winner);
      return winner ? `🏆 ${winner} WINS!` : null;
    }
    case 'MORNING_REVEAL': {
      const deaths = Array.isArray(data.deaths)
        ? (data.deaths as Array<Record<string, unknown>>)
        : [];
      if (deaths.length === 0) return null;
      const names = deaths
        .map((d) => str(d.name) ?? str(d.playerId) ?? 'unknown')
        .join(', ');
      return `Morning reveal: ${names} died overnight`;
    }
    default:
      return null;
  }
}

/**
 * Derive the spectator lists from event rows — the single derivation shared
 * by hydrated history and live WS events so the two can never disagree.
 *
 * - votes: one entry per VOTE_CAST, in cast order (VotePanel aggregates).
 * - statements: AGENT_SAYS_BROADCASTED rows with a non-empty statement,
 *   chronological.
 * - timeline: recent events with a human-readable message, chronological
 *   (renderers reverse for newest-first display).
 */
export function deriveWatcherState(events: WatcherEvent[]): {
  votes: Vote[];
  statements: WatcherStatement[];
  timeline: WatcherTimelineItem[];
} {
  const votes: Vote[] = [];
  const statements: WatcherStatement[] = [];
  const timeline: WatcherTimelineItem[] = [];

  for (const event of events) {
    const data = event.data;

    if (event.type === 'VOTE_CAST') {
      const voterId = str(data.voterId) ?? event.actorId ?? 'unknown';
      const targetId = str(data.targetId) ?? event.targetId ?? 'unknown';
      votes.push({
        voterId,
        targetId,
        timestamp: event.timestamp,
        phase: (str(event.metadata.phase) ?? 'SETUP') as Vote['phase'],
        dayNumber: event.metadata.dayNumber,
      });
    } else if (event.type === 'AGENT_SAYS_BROADCASTED') {
      const statement = str(data.statement) ?? str(data.says) ?? str(data.message);
      if (statement) {
        statements.push({
          playerName: str(data.playerName) ?? str(data.name) ?? event.actorId ?? 'Unknown',
          statement,
          timestamp: event.timestamp,
        });
      }
    }

    const message = describeEvent(event);
    if (message) {
      timeline.push({
        id: event.id,
        type: event.type,
        message,
        timestamp: event.timestamp,
      });
    }
  }

  return { votes, statements, timeline };
}

/**
 * Type bridge: WatcherEvent is structurally GameEvent-compatible at the
 * rendering boundary (ChatPanel reads type/timestamp/actorId/data only), but
 * metadata.phase/visibility are widened to string for legacy rows.
 */
export function asGameEvents(events: WatcherEvent[]): GameEvent[] {
  return events as unknown as GameEvent[];
}