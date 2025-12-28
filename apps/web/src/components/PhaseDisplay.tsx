import React from 'react';

interface PhaseDisplayProps {
  phase: string;
  dayNumber: number;
}

const PhaseDisplay: React.FC<PhaseDisplayProps> = ({ phase, dayNumber }) => {
  const getPhaseInfo = (phase: string) => {
    switch (phase) {
      case 'SETUP':
        return { icon: '⚙️', color: 'blue', label: 'Setup' };
      case 'NIGHT_ACTIONS':
        return { icon: '🌙', color: 'purple', label: 'Night Actions' };
      case 'MORNING_REVEAL':
        return { icon: '🌅', color: 'orange', label: 'Morning Reveal' };
      case 'DAY_DISCUSSION':
        return { icon: '☀️', color: 'yellow', label: 'Day Discussion' };
      case 'DAY_VOTING':
        return { icon: '🗳️', color: 'green', label: 'Voting' };
      case 'RESOLUTION':
        return { icon: '⚖️', color: 'gray', label: 'Resolution' };
      case 'GAME_OVER':
        return { icon: '🏆', color: 'gold', label: 'Game Over' };
      default:
        return { icon: '❓', color: 'gray', label: phase };
    }
  };
  
  const info = getPhaseInfo(phase);
  
  return (
    <div className={`phase-display color-${info.color}`}>
      <span className="phase-icon">{info.icon}</span>
      <div className="phase-info">
        <span className="phase-label">{info.label}</span>
        {phase !== 'SETUP' && phase !== 'GAME_OVER' && (
          <span className="day-label">Day {dayNumber}</span>
        )}
      </div>
    </div>
  );
};

export default PhaseDisplay;
