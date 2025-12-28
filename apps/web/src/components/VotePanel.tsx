import React from 'react';
import { Player, Vote } from '@mafia/shared/types';

interface VotePanelProps {
  votes: Vote[];
  players: Player[];
  onVote: (targetId: string) => void;
  disabled: boolean;
}

const VotePanel: React.FC<VotePanelProps> = ({ votes, players, onVote, disabled }) => {
  const voteCounts = new Map<string, number>();
  
  votes.forEach((vote) => {
    const count = voteCounts.get(vote.targetId) || 0;
    voteCounts.set(vote.targetId, count + 1);
  });
  
  const getPlayerById = (id: string) => players.find((p) => p.id === id);
  
  return (
    <div className="vote-panel">
      <div className="panel-header">
        <h3>🗳️ Votes</h3>
        <span className="vote-count">{votes.length} votes</span>
      </div>
      
      <div className="vote-display">
        {voteCounts.size === 0 ? (
          <div className="no-votes">
            <p>No votes cast yet</p>
            <p className="hint">Votes will appear here during voting phase</p>
          </div>
        ) : (
          Array.from(voteCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([targetId, count]) => {
              const target = getPlayerById(targetId);
              const percentage = players.length > 0 ? (count / players.length) * 100 : 0;
              
              return (
                <div key={targetId} className="vote-bar">
                  <div className="vote-info">
                    <span className="player-name">{target?.name || 'Unknown'}</span>
                    <span className="vote-count">{count} votes ({percentage.toFixed(0)}%)</span>
                  </div>
                  <div className="vote-progress">
                    <div
                      className="vote-fill"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })
        )}
      </div>
      
      {disabled && (
        <div className="vote-disabled">
          <p>Voting is not available in this phase</p>
        </div>
      )}
      
      {['DAY_VOTING', 'DAY_DISCUSSION'].includes('DAY_VOTING') && !disabled && (
        <div className="vote-actions">
          <p className="action-label">Vote to eliminate:</p>
          <div className="vote-buttons">
            {players
              .filter((p) => p.isAlive)
              .map((player) => (
                <button
                  key={player.id}
                  className="vote-btn"
                  onClick={() => onVote(player.id)}
                >
                  {player.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VotePanel;
