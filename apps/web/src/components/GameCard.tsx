import React from 'react';
import { formatDistanceToNow } from 'date-fns';

/**
 * The REAL list-row shape returned by GET /api/v1/games
 * (DF-MAFIA-AI-BENCHMARK-13, verified live 2026-09-25): rows carry
 * [config, createdAt, id, players, status] where `players` is a plain
 * NUMBER and there is NO currentState field.
 */
export interface GameListRow {
  id: string;
  createdAt: string | Date;
  /** Plain player COUNT on list rows — not a Player[] array. */
  players: number;
  status: string;
  config?: Record<string, unknown>;
}

export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'SETUP': return 'blue';
    case 'IN_PROGRESS': return 'green';
    case 'ENDED': return 'gray';
    default: return 'gray';
  }
};

/**
 * Map a list row's status to an honest phase-like label. GET /api/v1/games
 * rows carry NO currentState, so the Phase line reads from the row's own
 * status; unknown statuses render as the raw status rather than 'N/A'.
 * (DF-MAFIA-AI-BENCHMARK-13)
 */
export const getStatusPhaseLabel = (status: string): string => {
  switch (status) {
    case 'SETUP': return 'Setup';
    case 'IN_PROGRESS': return 'In Progress';
    case 'PAUSED': return 'Paused';
    case 'ENDED': return 'Game Over';
    case 'CANCELLED': return 'Cancelled';
    default: return status.replace(/_/g, ' ');
  }
};

interface GameCardProps {
  game: GameListRow;
  onOpen: (gameId: string) => void;
  onWatch: (gameId: string) => void;
}

const GameCard: React.FC<GameCardProps> = ({ game, onOpen, onWatch }) => {
  return (
    <div
      className="game-card"
      onClick={() => onOpen(game.id)}
    >
      <div className="game-card-header">
        <span className={`status-badge ${getStatusColor(game.status)}`}>
          {game.status.replace('_', ' ')}
        </span>
        <span className="game-id">{game.id.substring(0, 8)}...</span>
      </div>

      <div className="game-card-body">
        <div className="player-count">
          {/* List rows carry `players` as a plain NUMBER (the verified payload
              shape), not a Player[] array. */}
          <span className="count">{game.players}</span>
          <span className="label">Players</span>
        </div>

        <div className="game-info">
          <div className="info-row">
            <span>Created:</span>
            <span>{formatDistanceToNow(new Date(game.createdAt), { addSuffix: true })}</span>
          </div>
          <div className="info-row">
            <span>Phase:</span>
            <span>{getStatusPhaseLabel(game.status)}</span>
          </div>
        </div>
      </div>

      <div className="game-card-footer">
        {game.status === 'IN_PROGRESS' ? (
          <button
            className="btn btn-small btn-green"
            onClick={(e) => {
              e.stopPropagation();
              onWatch(game.id);
            }}
          >
            👀 Watch
          </button>
        ) : game.status === 'SETUP' ? (
          <button
            className="btn btn-small btn-blue"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(game.id);
            }}
          >
            ➕ Join
          </button>
        ) : (
          <button
            className="btn btn-small"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(game.id);
            }}
          >
            📊 View
          </button>
        )}
      </div>
    </div>
  );
};

export default GameCard;