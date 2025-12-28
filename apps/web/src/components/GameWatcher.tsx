import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { websocket } from '../services/websocket';
import { formatDistanceToNow } from 'date-fns';
import Loading from './Loading';

const GameWatcher: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { currentGame, gameState, players, events, selectGame } = useGameStore();
  const [liveUpdates, setLiveUpdates] = useState<Array<{ type: string; message: string; time: Date }>>([]);
  
  useEffect(() => {
    if (gameId) {
      selectGame(gameId);
      
      // Subscribe to game events
      websocket.send({
        type: 'JOIN_GAME',
        payload: { gameId },
      });
      
      // Listen for game events
      const unsubscribe = websocket.on('GAME_EVENT', (data) => {
        const event = data as { type: string; payload: Record<string, unknown> };
        const message = generateEventMessage(event);
        if (message) {
          setLiveUpdates((prev) => [
            { type: event.type, message, time: new Date() },
            ...prev.slice(0, 49),
          ]);
        }
      });
      
      return () => {
        unsubscribe();
      };
    }
  }, [gameId, selectGame]);
  
  const generateEventMessage = (event: { type: string; payload: Record<string, unknown> }): string | null => {
    const { type, payload } = event;
    
    switch (type) {
      case 'PHASE_CHANGED':
        return `Phase changed to ${(payload.toPhase as string).replace('_', ' ')}`;
      case 'PLAYER_KILLED':
        return `${payload.playerName} was killed (${payload.role})`;
      case 'PLAYER_LYNCHED':
        return `${payload.playerName} was lynched (${payload.role})`;
      case 'AGENT_SAYS_BROADCASTED':
        return `${payload.playerName}: "${payload.statement}"`;
      case 'VOTE_CAST':
        return `${payload.voterId} voted for ${payload.targetId}`;
      case 'WINNER_DETERMINED':
        return `🏆 ${payload.winner} WINS!`;
      default:
        return null;
    }
  };
  
  if (!currentGame || !gameState) {
    return <Loading message="Loading game..." />;
  }
  
  return (
    <div className="game-watcher">
      <div className="watcher-header">
        <div className="game-info">
          <h1>👀 Watching Game {gameId?.substring(0, 8)}</h1>
          <div className="live-indicator">
            <span className="pulse" />
            <span>LIVE</span>
          </div>
        </div>
        <button className="btn" onClick={() => navigate('/')}>
          ← Leave
        </button>
      </div>
      
      <div className="watcher-content">
        {/* Game State */}
        <div className="watcher-section">
          <h2>Game State</h2>
          <div className="state-display">
            <div className="state-item">
              <span className="label">Phase</span>
              <span className="value">{gameState.phase.replace('_', ' ')}</span>
            </div>
            <div className="state-item">
              <span className="label">Day</span>
              <span className="value">{gameState.dayNumber}</span>
            </div>
            <div className="state-item">
              <span className="label">Time</span>
              <span className="value">{gameState.timeRemaining}s</span>
            </div>
            <div className="state-item">
              <span className="label">Alive</span>
              <span className="value">{players.filter((p) => p.isAlive).length}</span>
            </div>
          </div>
        </div>
        
        {/* Live Feed */}
        <div className="watcher-section">
          <h2>📺 Live Feed</h2>
          <div className="live-feed">
            {liveUpdates.length === 0 ? (
              <p className="no-updates">Waiting for game events...</p>
            ) : (
              <div className="updates-list">
                {liveUpdates.map((update, index) => (
                  <div key={index} className="update-item">
                    <span className="update-time">
                      {formatDistanceToNow(update.time, { addSuffix: true })}
                    </span>
                    <span className="update-message">{update.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Players */}
        <div className="watcher-section">
          <h2>Players ({players.filter((p) => p.isAlive).length}/{players.length})</h2>
          <div className="players-mini-list">
            {players.map((player) => (
              <div
                key={player.id}
                className={`player-mini ${player.isAlive ? 'alive' : 'eliminated'}`}
              >
                <span className="player-icon">
                  {player.isMafia ? '🎭' : '👤'}
                </span>
                <span className="player-name">{player.name}</span>
                {!player.isAlive && <span className="eliminated-badge">ELIMINATED</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameWatcher;
