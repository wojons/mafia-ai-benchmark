import React from 'react';
import { Player } from '@mafia/shared/types';

interface ActionPanelProps {
  phase: string;
  players: Player[];
  onAction: (action: string, targetId?: string) => void;
  disabled: boolean;
}

const ActionPanel: React.FC<ActionPanelProps> = ({ phase, players, onAction, disabled }) => {
  if (disabled) {
    return (
      <div className="action-panel disabled">
        <p>Actions not available</p>
      </div>
    );
  }
  
  const nightActions = phase === 'NIGHT_ACTIONS';
  const dayActions = phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING';
  
  return (
    <div className="action-panel">
      <h3>🎯 Actions</h3>
      
      {nightActions && (
        <div className="action-group">
          <h4>Night Actions</h4>
          <div className="action-buttons">
            <button className="btn btn-red" onClick={() => onAction('KILL')}>
              🎭 Kill
            </button>
            <button className="btn btn-green" onClick={() => onAction('PROTECT')}>
              💊 Protect
            </button>
            <button className="btn btn-blue" onClick={() => onAction('INVESTIGATE')}>
              🔍 Investigate
            </button>
            <button className="btn btn-orange" onClick={() => onAction('SHOOT')}>
              🔫 Shoot
            </button>
          </div>
        </div>
      )}
      
      {dayActions && (
        <div className="action-group">
          <h4>Day Actions</h4>
          <div className="action-buttons">
            <button className="btn btn-yellow" onClick={() => onAction('ACCUSE')}>
              👆 Accuse
            </button>
            <button className="btn btn-gray" onClick={() => onAction('CLAIM_ROLE')}>
              🆔 Claim Role
            </button>
            <button className="btn btn-purple" onClick={() => onAction('DEFEND')}>
              🛡️ Defend
            </button>
          </div>
        </div>
      )}
      
      {!nightActions && !dayActions && (
        <p className="no-actions">No actions available in this phase</p>
      )}
      
      {phase === 'NIGHT_ACTIONS' && (
        <p className="action-hint">
          Select a player to perform your night action
        </p>
      )}
    </div>
  );
};

export default ActionPanel;
