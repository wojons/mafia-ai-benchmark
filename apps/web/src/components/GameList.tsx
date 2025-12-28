import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { useUIStore } from '../stores/uiStore';
import { formatDistanceToNow } from 'date-fns';

const GameList: React.FC = () => {
  const navigate = useNavigate();
  const { games, fetchGames, createGame, connecting } = useGameStore();
  const { searchQuery, setSearchQuery, layout } = useUIStore();
  const [showNewGame, setShowNewGame] = useState(false);
  const [newGameConfig, setNewGameConfig] = useState({
    numPlayers: 10,
    nightDuration: 60,
    dayDuration: 120,
    votingDuration: 30,
  });
  
  useEffect(() => {
    fetchGames({ limit: 50 });
  }, [fetchGames]);
  
  const filteredGames = games.filter((game) => {
    if (!searchQuery) return true;
    return game.id.toLowerCase().includes(searchQuery.toLowerCase());
  });
  
  const handleCreateGame = async () => {
    try {
      const game = await createGame(newGameConfig);
      navigate(`/game/${game.id}`);
    } catch (error) {
      console.error('Failed to create game:', error);
    }
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SETUP': return 'blue';
      case 'IN_PROGRESS': return 'green';
      case 'ENDED': return 'gray';
      default: return 'gray';
    }
  };
  
  if (connecting) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <p>Loading games...</p>
      </div>
    );
  }
  
  return (
    <div className="game-list-page">
      <div className="page-header">
        <div className="header-content">
          <h1>Games</h1>
          <p>Manage and watch Mafia AI games</p>
        </div>
        
        <div className="header-actions">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search games..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          
          <button className="btn btn-primary" onClick={() => setShowNewGame(true)}>
            ➕ New Game
          </button>
        </div>
      </div>
      
      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <span className="stat-value">{games.length}</span>
          <span className="stat-label">Total Games</span>
        </div>
        <div className="stat-item">
          <span className="stat-value green">{games.filter((g) => g.status === 'IN_PROGRESS').length}</span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat-item">
          <span className="stat-value blue">{games.filter((g) => g.status === 'SETUP').length}</span>
          <span className="stat-label">Setup</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{games.filter((g) => g.status === 'ENDED').length}</span>
          <span className="stat-label">Completed</span>
        </div>
      </div>
      
      {/* Games Grid/List */}
      <div className={`games-container ${layout}`}>
        {filteredGames.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎮</div>
            <h3>No games found</h3>
            <p>Create a new game to get started</p>
            <button className="btn btn-primary" onClick={() => setShowNewGame(true)}>
              Create Game
            </button>
          </div>
        ) : (
          <div className={`games-grid ${layout}`}>
            {filteredGames.map((game) => (
              <div
                key={game.id}
                className="game-card"
                onClick={() => navigate(`/game/${game.id}`)}
              >
                <div className="game-card-header">
                  <span className={`status-badge ${getStatusColor(game.status)}`}>
                    {game.status.replace('_', ' ')}
                  </span>
                  <span className="game-id">{game.id.substring(0, 8)}...</span>
                </div>
                
                <div className="game-card-body">
                  <div className="player-count">
                    <span className="count">{game.players.length}</span>
                    <span className="label">Players</span>
                  </div>
                  
                  <div className="game-info">
                    <div className="info-row">
                      <span>Created:</span>
                      <span>{formatDistanceToNow(new Date(game.createdAt), { addSuffix: true })}</span>
                    </div>
                    <div className="info-row">
                      <span>Phase:</span>
                      <span>{game.currentState?.phase || 'N/A'}</span>
                    </div>
                  </div>
                </div>
                
                <div className="game-card-footer">
                  {game.status === 'IN_PROGRESS' ? (
                    <button
                      className="btn btn-small btn-green"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/watch/${game.id}`);
                      }}
                    >
                      👀 Watch
                    </button>
                  ) : game.status === 'SETUP' ? (
                    <button
                      className="btn btn-small btn-blue"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/game/${game.id}`);
                      }}
                    >
                      ➕ Join
                    </button>
                  ) : (
                    <button
                      className="btn btn-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/game/${game.id}`);
                      }}
                    >
                      📊 View
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* New Game Modal */}
      {showNewGame && (
        <div className="modal-overlay" onClick={() => setShowNewGame(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Game</h2>
              <button className="close-btn" onClick={() => setShowNewGame(false)}>
                ✕
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Number of Players</label>
                <input
                  type="number"
                  value={newGameConfig.numPlayers}
                  onChange={(e) =>
                    setNewGameConfig({ ...newGameConfig, numPlayers: parseInt(e.target.value) })
                  }
                  min={5}
                  max={20}
                />
              </div>
              
              <div className="form-group">
                <label>Night Duration (seconds)</label>
                <input
                  type="number"
                  value={newGameConfig.nightDuration}
                  onChange={(e) =>
                    setNewGameConfig({ ...newGameConfig, nightDuration: parseInt(e.target.value) })
                  }
                  min={30}
                  max={300}
                />
              </div>
              
              <div className="form-group">
                <label>Day Duration (seconds)</label>
                <input
                  type="number"
                  value={newGameConfig.dayDuration}
                  onChange={(e) =>
                    setNewGameConfig({ ...newGameConfig, dayDuration: parseInt(e.target.value) })
                  }
                  min={60}
                  max={600}
                />
              </div>
              
              <div className="form-group">
                <label>Voting Duration (seconds)</label>
                <input
                  type="number"
                  value={newGameConfig.votingDuration}
                  onChange={(e) =>
                    setNewGameConfig({ ...newGameConfig, votingDuration: parseInt(e.target.value) })
                  }
                  min={10}
                  max={120}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNewGame(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreateGame}>
                Create Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameList;
