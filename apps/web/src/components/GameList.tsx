import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { useUIStore } from '../stores/uiStore';
import GameCard, { type GameListRow } from './GameCard';

const AVAILABLE_MODELS = [
  { label: 'DeepSeek V4 Flash (fast)', value: 'deepseek-v4-flash', provider: 'openrouter' },
  { label: 'Qwen 3 Coder Next (balanced)', value: 'qwen3-coder-next', provider: 'openrouter' },
  { label: 'Owl Alpha (free)', value: 'openrouter/owl-alpha', provider: 'openrouter' },
  { label: 'Qwen 3.6 35B (LM Studio)', value: 'qwen/qwen3.6-35b-a3b', provider: 'custom:lmstudio' },
  { label: 'Mistral Nemo (LM Studio)', value: 'mistral-nemo-instruct-2407', provider: 'custom:lmstudio' },
];

const MAFIA_ROLES: Array<{ role: string; label: string; icon: string }> = [
  { role: 'MAFIA', label: 'Mafia', icon: '🔪' },
  { role: 'SHERIFF', label: 'Sheriff', icon: '🔍' },
  { role: 'DOCTOR', label: 'Doctor', icon: '💉' },
  { role: 'VILLAGER', label: 'Villager', icon: '👤' },
];

const GameList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { games, fetchGames, createGame, connecting } = useGameStore();
  const { searchQuery, setSearchQuery, layout } = useUIStore();
  // '/?action=new' (sidebar Quick Action) opens the same create-game modal the
  // header button opens — no second modal. The initializer covers a fresh
  // mount (including SSR), the effect covers an in-place navigation from an
  // already-mounted GameList.
  const [showNewGame, setShowNewGame] = useState(() => searchParams.get('action') === 'new');
  const [createError, setCreateError] = useState<string | null>(null);
  const [newGameConfig, setNewGameConfig] = useState({
    numPlayers: 10,
    nightDuration: 60,
    dayDuration: 120,
    votingDuration: 30,
  });
  const [roleModels, setRoleModels] = useState<Record<string, { provider: string; model: string }>>({
    MAFIA: { provider: 'openrouter', model: 'deepseek-v4-flash' },
    SHERIFF: { provider: 'openrouter', model: 'deepseek-v4-flash' },
    DOCTOR: { provider: 'openrouter', model: 'deepseek-v4-flash' },
    VILLAGER: { provider: 'openrouter', model: 'deepseek-v4-flash' },
  });
  
  useEffect(() => {
    fetchGames({ limit: 50 });
  }, [fetchGames]);

  // Open the create-game modal when navigated to '/?action=new' while the
  // GameList is already mounted (a fresh mount is handled by the initializer).
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowNewGame(true);
    }
  }, [searchParams]);
  const filteredGames = games.filter((game) => {
    if (!searchQuery) return true;
    return game.id.toLowerCase().includes(searchQuery.toLowerCase());
  });
  
  const handleCreateGame = async () => {
    setCreateError(null);
    try {
      const game = await createGame({
        ...newGameConfig,
        roleModels,
      });
      closeNewGameModal();
      navigate(`/game/${game.id}`);
    } catch (error) {
      console.error('Failed to create game:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to create game. Please try again.';
      setCreateError(message);
    }
  };
  
  const closeNewGameModal = () => {
    setShowNewGame(false);
    // Drop ?action=new from the URL so a later re-mount / refresh does not
    // re-open the modal on its own.
    if (searchParams.get('action') === 'new') {
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
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
          
          <button className="btn btn-primary" onClick={() => { setCreateError(null); setShowNewGame(true); }}>
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
            <button className="btn btn-primary" onClick={() => { setCreateError(null); setShowNewGame(true); }}>
              Create Game
            </button>
          </div>
        ) : (
          <div className={`games-grid ${layout}`}>
            {filteredGames.map((game) => (
              <GameCard
                key={game.id}
                game={game as unknown as GameListRow}
                onOpen={(id) => navigate(`/game/${id}`)}
                onWatch={(id) => navigate(`/watch/${id}`)}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* New Game Modal */}
      {showNewGame && (
        <div className="modal-overlay" onClick={closeNewGameModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Game</h2>
              <button className="close-btn" onClick={closeNewGameModal}>
                ✕
              </button>
            </div>
            
            <div className="modal-body">
              {createError && (
                <div
                  role="alert"
                  style={{
                    color: 'var(--color-danger)',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid var(--color-danger)',
                    borderRadius: 'var(--radius-md, 8px)',
                    padding: '10px 14px',
                    marginBottom: '16px',
                    fontSize: '14px',
                  }}
                >
                  {createError}
                </div>
              )}
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

              {/* === Model Picker per Role === */}
              <div className="form-section">
                <h3>🧠 Role Models</h3>
                <p className="form-hint">Assign a different LLM to each role</p>
                {MAFIA_ROLES.map(({ role, label, icon }) => (
                  <div key={role} className="form-group role-model-row">
                    <label>
                      <span className="role-icon">{icon}</span> {label}
                    </label>
                    <select
                      value={
                        roleModels[role]
                          ? `${roleModels[role].provider}:${roleModels[role].model}`
                          : ''
                      }
                      onChange={(e) => {
                        const [provider, ...modelParts] = e.target.value.split(':');
                        const model = modelParts.join(':');
                        setRoleModels({
                          ...roleModels,
                          [role]: { provider, model },
                        });
                      }}
                      className="model-select"
                    >
                      {AVAILABLE_MODELS.map((m) => (
                        <option
                          key={`${m.provider}:${m.value}`}
                          value={`${m.provider}:${m.value}`}
                        >
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                {/* Quick-set: apply to all */}
                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      const first = AVAILABLE_MODELS[0];
                      const all = { ...roleModels };
                      MAFIA_ROLES.forEach(({ role }) => {
                        all[role] = { provider: first.provider, model: first.value };
                      });
                      setRoleModels(all);
                    }}
                  >
                    ⚡ Apply first to all roles
                  </button>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn" onClick={closeNewGameModal}>
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
