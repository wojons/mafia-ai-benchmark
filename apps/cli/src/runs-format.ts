/**
 * Runs-format — pure shaping for the per-run JSONL run-record corpus
 * (MAF-LAYER-1).
 *
 * Every ENDED game is exported as one JSONL file whose line 1 is a RunRecord
 * and whose following lines are RunEventLine entries in game order. All
 * shaping happens here as pure functions over the REST API payloads
 * (GET /api/v1/games/:gameId, GET /api/v1/games/:gameId/replay) so the
 * serialization is deterministic and testable without a live server: the
 * same payload always renders the same bytes.
 */

import type {
  RunEventLine,
  RunIndexEntry,
  RunProvenance,
  RunRecord,
  RunSeat,
} from '@mafia/shared/types';

/** Player shape as served by GET /api/v1/games/:gameId (camelCase wire). */
interface ApiPlayer {
  id: string;
  name?: string;
  role: string;
  isAlive: boolean;
  isMafia: boolean;
  joinOrder: number;
  won?: number;
  provider?: string;
  model?: string;
}

/** Game-detail shape as served by GET /api/v1/games/:gameId. */
export interface ApiGameDetail {
  id: string;
  createdAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  status?: string;
  winner?: string | null;
  players: ApiPlayer[];
}

/** Event shape as served by GET /api/v1/games/:gameId/replay (ISO strings). */
export interface ApiEvent {
  id: string;
  type: string;
  timestamp: string;
  actorId?: string | null;
  visibility?: string | null;
  data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Derive the seat-level attribution label (MAF-INIT-001): 'unknown' when ANY
 * seat lacks a non-empty provider AND model — historical games are labeled,
 * never invented (a missing attribution is never filled in); 'single' when
 * fully attributed with exactly one (provider, model) pair; 'mixed' when
 * fully attributed across ≥ 2 pairs.
 */
export function deriveRunProvenance(seats: RunSeat[]): RunProvenance {
  if (seats.length === 0) return 'unknown';
  const attributedPairs = new Set<string>();
  for (const seat of seats) {
    const provider = typeof seat.provider === 'string' ? seat.provider.trim() : '';
    const model = typeof seat.model === 'string' ? seat.model.trim() : '';
    if (!provider || !model) return 'unknown';
    attributedPairs.add(`${provider}\u0000${model}`);
  }
  return attributedPairs.size === 1 ? 'single' : 'mixed';
}

/**
 * Shape one seat. seat = joinOrder + 1 (1-based, in join order); survived is
 * the player's end-of-game aliveness; won is the server-reported per-player
 * result, derived from the decided winner exactly the way the server's
 * legacy-fallback branch derives it (MAF-GAP-056) when the column is absent,
 * and null only when the game itself has no decided outcome.
 */
export function buildRunSeat(player: ApiPlayer, winner: string | null): RunSeat {
  const derivedWon =
    typeof player.won === 'number'
      ? player.won
      : winner !== null
        ? (player.isMafia === (winner === 'MAFIA') ? 1 : 0)
        : null;
  return {
    seat: player.joinOrder + 1,
    player_id: player.id,
    provider: player.provider ?? null,
    model: player.model ?? null,
    role: player.role,
    survived: player.isAlive,
    won: derivedWon,
  };
}

/**
 * Build the run-record header (line 1). Legacy games never record
 * startedAt, so createdAt stands in — the same fallback the server's
 * legacy list projection serves. num_players is the ACTUAL seat count,
 * never the config intent.
 */
export function buildRunRecord(game: ApiGameDetail): RunRecord {
  const winner = game.winner ?? null;
  const seats = game.players
    .slice()
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((p) => buildRunSeat(p, winner));
  return {
    game_id: game.id,
    started_at: game.startedAt ?? game.createdAt ?? null,
    ended_at: game.endedAt ?? null,
    num_players: game.players.length,
    winner,
    provenance: deriveRunProvenance(seats),
    seats,
  };
}

/**
 * Project one event to its fixed on-disk shape. Only fields the corpus
 * contract names are kept (arbitrary payloads ride inside data/metadata
 * verbatim); ordering comes from orderEvents, never from this projection.
 */
export function projectEvent(event: ApiEvent): RunEventLine {
  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    actor_id: event.actorId ?? null,
    visibility: event.visibility ?? null,
    data: event.data ?? null,
    metadata: event.metadata ?? null,
  };
}

/**
 * Order events in game order: ascending timestamp, ties broken by the
 * storage sequence counter (metadata.sequence), with the fetch order as a
 * stable last resort. The replay endpoint already sorts server-side, but the
 * corpus must not depend on that — the same payload always orders the same.
 */
export function orderEvents(events: ApiEvent[]): ApiEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const tsA = a.event.timestamp;
      const tsB = b.event.timestamp;
      if (tsA !== tsB) return tsA < tsB ? -1 : 1;
      const seqA = eventSequence(a.event);
      const seqB = eventSequence(b.event);
      if (seqA !== seqB) return seqA - seqB;
      return a.index - b.index;
    })
    .map(({ event }) => event);
}

function eventSequence(event: ApiEvent): number {
  const seq = (event.metadata as { sequence?: unknown } | null | undefined)?.sequence;
  return typeof seq === 'number' ? seq : Number.MAX_SAFE_INTEGER;
}

/** The index entry mirrors the header, plus the run file's relative path. */
export function buildIndexEntry(record: RunRecord, relativePath: string): RunIndexEntry {
  return {
    game_id: record.game_id,
    path: relativePath,
    started_at: record.started_at,
    winner: record.winner,
    provenance: record.provenance,
    seats: record.seats,
  };
}

/**
 * Serialize the JSONL body: line 1 = run record, then one projected event
 * per line in game order, each terminated with \n (JSONL convention).
 * Deterministic by construction — fixed key insertion order everywhere.
 */
export function serializeRunFile(record: RunRecord, events: ApiEvent[]): string {
  const lines: string[] = [JSON.stringify(record)];
  for (const event of orderEvents(events)) {
    lines.push(JSON.stringify(projectEvent(event)));
  }
  return lines.join('\n') + '\n';
}

/** Serialize one index line (JSONL convention). */
export function serializeIndexLine(entry: RunIndexEntry): string {
  return JSON.stringify(entry) + '\n';
}
