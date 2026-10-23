import React from 'react';
import { formatDistanceToNow } from 'date-fns';

export interface GameHistoryRow {
  id: string;
  status: string;
  players: number;
  createdAt: string;
  /** Present on ENDED list/detail rows; absent on running games. */
  endedAt?: string | null;
  /**
   * PERF-MAFIA-4: decoded outcome served on the LIST rows now, so the table
   * never needs a per-game detail fetch. `null`/absent = undecided.
   */
  winner?: 'MAFIA' | 'TOWN' | null;
  /** PERF-MAFIA-4: persisted duration (ms) — fallback when endedAt is absent. */
  duration?: number | null;
  config: Record<string, unknown>;
}

const DASH = '\u2014';

export function getWinner(game: GameHistoryRow): string {
  // PERF-MAFIA-4: prefer the decoded list field; historical detail payloads
  // (and legacy rows) still carry the outcome inside config.winner, so that
  // stays as the fallback rather than being dropped.
  const decode = (value: unknown): string | null => {
    if (value === 'Mafia' || value === 'MAFIA') return 'Mafia';
    if (value === 'Town' || value === 'TOWN') return 'Town';
    return null;
  };
  const cfg = game.config || {};
  return decode(game.winner) ?? decode(cfg.winner) ?? 'Unknown';
}

export function getPlayers(game: GameHistoryRow): string {
  const cfg = game.config || {};
  const names = cfg.playerNames as string[] | undefined;
  if (names && names.length > 0) return names.join(', ');
  return `${game.players} players`;
}

export function formatDuration(ms: number): string {
  if (!ms || isNaN(ms) || ms <= 0) return DASH;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

// DF-MAFIA-AI-BENCHMARK-14: an ended game's duration is endedAt - createdAt.
// The legacy startedAt/gameOverAt pair is null on ended detail rows, so it is
// never consulted here. '—' only when endedAt is genuinely absent (or the
// timestamps do not parse) — never as a placeholder for a computable duration.
export function computeGameDuration(
  createdAt: string | undefined,
  endedAt: string | undefined | null,
): string {
  if (!endedAt || !createdAt) return DASH;
  const created = Date.parse(createdAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(created) || Number.isNaN(ended)) return DASH;
  return formatDuration(ended - created);
}

// PERF-MAFIA-4: the duration cell consumes the ENDED list row directly —
// endedAt when present, else the persisted games.duration (ms) the list now
// serves for rows whose engine never wrote an end timestamp. Straight '—'
// when neither is available.
export function getDuration(game: GameHistoryRow): string {
  const fromTimestamps = computeGameDuration(game.createdAt, game.endedAt);
  if (fromTimestamps !== DASH) return fromTimestamps;
  if (typeof game.duration === 'number') return formatDuration(game.duration);
  return DASH;
}

interface GameHistoryTableProps {
  games: GameHistoryRow[];
  loading: boolean;
}

const GameHistoryTable: React.FC<GameHistoryTableProps> = ({ games, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="text-center text-[var(--color-text-muted)] py-12">
        No completed games yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full border-collapse text-sm" data-testid="game-history">
        <thead>
          <tr>
            <th className="text-left py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Game ID
            </th>
            <th className="text-left py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Players
            </th>
            <th className="text-center py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Winner
            </th>
            <th className="text-right py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Duration
            </th>
            <th className="text-right py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const winner = getWinner(g);
            return (
              <tr key={g.id} className="border-b border-[var(--color-border)]">
                <td className="py-3 px-2 font-mono text-xs text-[var(--color-text-muted)]">
                  {g.id.substring(0, 8)}
                </td>
                <td className="py-3 px-2 text-[var(--color-text-secondary)]">{getPlayers(g)}</td>
                <td className="py-3 px-2 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      winner === 'Mafia'
                        ? 'bg-[rgba(239,68,68,0.1)] text-[var(--color-danger)]'
                        : winner === 'Town'
                        ? 'bg-[rgba(34,197,94,0.1)] text-[var(--color-success)]'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {winner}
                  </span>
                </td>
                <td className="py-3 px-2 text-right text-[var(--color-text-secondary)]">
                  {getDuration(g)}
                </td>
                <td className="py-3 px-2 text-right text-xs text-[var(--color-text-muted)]">
                  {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default GameHistoryTable;