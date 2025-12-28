import React from 'react';
import { Player } from '@mafia/shared/types';

interface PlayerCardProps {
  player: Player;
  isCurrentPlayer: boolean;
  gamePhase: string;
  onVote: () => void;
  onAction: (action: string) => void;
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  isCurrentPlayer,
  gamePhase,
  onVote,
  onAction,
}) => {
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'MAFIA': return '🎭';
      case 'DOCTOR': return '👨‍⚕️';
      case 'SHERIFF': return '👮';
      case 'VIGILANTE': return '🔫';
      default: return '👤';
    }
  };
  
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'MAFIA': return 'red';
      case 'DOCTOR': return 'green';
      case 'SHERIFF': return 'blue';
      case 'VIGILANTE': return 'orange';
      default: return 'gray';
    }
  };
  
  const canVote = gamePhase === 'DAY_VOTING' && !isCurrentPlayer;
  const canAct = ['NIGHT_ACTIONS', 'DAY_DISCUSSION', 'DAY_VOTING'].includes(gamePhase);
  
  return (
    <div className={`player-card ${isCurrentPlayer ? 'current' : ''} ${player.isMafia ? 'mafia' : ''}`}>
      <div className="player-avatar">
        <span className="avatar-icon">{getRoleIcon(player.role)}</span>
        {isCurrentPlayer && <span className="you-badge">YOU</span>}
      </div>
      
      <div className="player-info">
        <h4 className="player-name">{player.name}</h4>
        <span className={`player-role role-${getRoleColor(player.role)}`}>
          {player.role}
        </span>
      </div>
      
      <div className="player-status">
        <span className={`status-indicator ${player.isAlive ? 'alive' : 'eliminated'}`}>
          {player.isAlive ? '● Alive' : '○ Eliminated'}
        </span>
      </div>
      
      {canVote && (
        <div className="player-actions">
          <button className="btn btn-small" onClick={onVote}>
            Vote
          </button>
        </div>
      )}
      
      {canAct && isCurrentPlayer && gamePhase === 'NIGHT_ACTIONS' && (
        <div className="player-actions">
          <button className="btn btn-small btn-red" onClick={() => onAction('KILL')}>
            Kill
          </button>
          <button className="btn btn-small btn-green" onClick={() => onAction('PROTECT')}>
            Protect
          </button>
          <button className="btn btn-small btn-blue" onClick={() => onAction('INVESTIGATE')}>
            Investigate
          </button>
        </div>
      )}
      
      {canAct && isCurrentPlayer && player.role === 'VIGILANTE' && (
        <div className="player-actions">
          <button className="btn btn-small btn-orange" onClick={() => onAction('SHOOT')}>
            Shoot
          </button>
        </div>
      )}
    </div>
  );
};

export default PlayerCard;
