import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { useUIStore } from '../stores/uiStore';
import PlayerCard from './PlayerCard';
import ChatPanel from './ChatPanel';
import VotePanel from './VotePanel';
import PhaseDisplay from './PhaseDisplay';
import ActionPanel from './ActionPanel';
import Loading from './Loading';

const GameBoard: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { currentGame, gameState, players, events, selectGame, clearCurrentGame } = useGameStore();
  const { showChatPanel, showVotePanel, showPlayerList } = useUIStore();
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  
  useEffect(() => {
    if (gameId) {
      selectGame(gameId);
    }
    
    return () => {
      clearCurrentGame();
    };
  }, [gameId, selectGame, clearCurrentGame]);
  
  if (!currentGame || !gameState) {
    return <Loading message="Loading game..." />;
  }
  
  const alivePlayers = players.filter((p) => p.isAlive);
  const eliminatedPlayers = players.filter((p) => !p.isAlive);
  
  const handleVote = async (targetId: string) => {
    if (!myPlayerId || !gameId) return;
    // Vote logic will be handled by ActionPanel
  };
  
  const handleAction = (actionType: string, targetId?: string) => {
    // Action logic will be handled by ActionPanel
    console.log('Action:', actionType, targetId);
  };
  
  return (
    <div className="game-board">
      {/* Game Header */}
      <div className="game-header">
        <div className="game-info">
          <h1>Game {gameId?.substring(0, 8)}</h1>
          <PhaseDisplay phase={gameState.phase} dayNumber={gameState.dayNumber} />
        </div>
        
        <div className="game-actions">
          <button className="btn btn-small" onClick={() => navigate(`/watch/${gameId}`)}>
            👀 Watch Mode
          </button>
          <button className="btn btn-small" onClick={() => navigate('/')}>
            ← Back
          </button>
        </div>
      </div>
      
      {/* Main Game Area */}
      <div className="game-content">
        {/* Players Section */}
        <div className="players-section">
          <div className="section-header">
            <h2>Players ({alivePlayers.length}/{players.length})</h2>
          </div>
          
          <div className="players-grid">
            {alivePlayers.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                isCurrentPlayer={player.id === myPlayerId}
                gamePhase={gameState.phase}
                onVote={() => handleVote(player.id)}
                onAction={(action) => handleAction(action, player.id)}
              />
            ))}
          </div>
          
          {eliminatedPlayers.length > 0 && (
            <div className="eliminated-section">
              <h3>Eliminated ({eliminatedPlayers.length})</h3>
              <div className="eliminated-list">
                {eliminatedPlayers.map((player) => (
                  <div key={player.id} className="eliminated-player">
                    <span className="player-name">{player.name}</span>
                    <span className="player-role">{player.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Center Panel - Game State Visualization */}
        <div className="center-panel">
          <div className="timer-display">
            <span className="timer-value">{gameState.timeRemaining}s</span>
            <span className="timer-label">Remaining</span>
          </div>
          
          <div className="phase-info">
            <h3>Current Phase</h3>
            <p className="phase-name">{gameState.phase.replace('_', ' ')}</p>
            <p className="turn-info">Turn {gameState.turnNumber}</p>
          </div>
          
          <ActionPanel
            phase={gameState.phase}
            players={alivePlayers}
            onAction={handleAction}
            disabled={!myPlayerId}
          />
        </div>
        
        {/* Right Panel - Chat & Votes */}
        {(showChatPanel || showVotePanel) && (
          <div className="right-panel">
            {showVotePanel && (
              <VotePanel
                votes={gameState.votes}
                players={alivePlayers}
                onVote={handleVote}
                disabled={!myPlayerId || gameState.phase !== 'DAY_VOTING'}
              />
            )}
            
            {showChatPanel && (
              <ChatPanel
                events={events}
                currentPlayerId={myPlayerId || undefined}
              />
            )}
          </div>
        )}
      </div>
      
      {/* Event Log */}
      <div className="event-log">
        <h3>Recent Events</h3>
        <div className="events-list">
          {events.slice(-10).map((event, index) => (
            <div key={index} className={`event-item ${event.type.toLowerCase()}`}>
              <span className="event-time">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span className="event-type">{event.type}</span>
              <span className="event-data">
                {JSON.stringify(event.data).substring(0, 100)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GameBoard;
