import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { useUIStore } from '../stores/uiStore';
import { modelsAPI, type CatalogModelEntry } from '../services/api';
import GameCard, { type GameListRow } from './GameCard';

/**
 * DF-MAFIA-AI-BENCHMARK-42: model presets come from the SERVER's own catalog
 * (GET /api/v1/models), not from hand-written ids. The previous hardcoded
 * AVAILABLE_MODELS list invented an 'openrouter' provider the server does not
 * expose, and its raw values ('deepseek-v4-flash', 'qwen3-coder-next',
 * 'openrouter/owl-alpha') are not catalog modelIds — every such preset either
 * degraded silently to the deployment default (DEFAULT_MODEL, legacy game
 * adapter ~600-615) or ran unresolvable. Every preset now composes
 * 'provider/model' from a real { provider, modelId } pair the endpoint lists.
 */
const FALLBACK_PRESETS: Array<CatalogModelEntry & { label: string }> = [
  // Honest fallback ONLY: measured live catalog payloads at this base list
  // these exact { provider, modelId } pairs. No OpenRouter-invented entries.
  { provider: 'OPENAI', modelId: 'gpt-4o-mini', displayName: 'GPT-4o mini', label: 'GPT-4o mini (fast, cheap)' },
  { provider: 'OPENAI', modelId: 'gpt-4o', displayName: 'GPT-4o', label: 'GPT-4o (balanced)' },
  { provider: 'GOOGLE', modelId: 'gemini-flash-latest', displayName: 'Gemini Flash Latest', label: 'Gemini Flash (balanced)' },
];

/** Engine-playable roles (legacy-game-adapter.ts ENGINE_PLAYABLE_ROLES). */
const ENGINE_PLAYABLE_ROLES = ['MAFIA', 'SHERIFF', 'DOCTOR', 'VILLAGER', 'VIGILANTE'];

const MAFIA_ROLES: Array<{ role: string; label: string; icon: string }> = [
  { role: 'MAFIA', label: 'Mafia', icon: '🔪' },
  { role: 'SHERIFF', label: 'Sheriff', icon: '🔍' },
  { role: 'DOCTOR', label: 'Doctor', icon: '💉' },
  { role: 'VIGILANTE', label: 'Vigilante', icon: '🔫' },
  { role: 'VILLAGER', label: 'Villager', icon: '👤' },
];

/**
 * A role picker row is offered when the requested configuration actually
 * assigns that role: the engine's assignRoles gives every config >= 5 players
 * exactly 1 VIGILANTE (persona-generator.js assignRoles), VILLAGER whenever
 * numPlayers - mafiaCount - 3 >= 1, and the officer roles unconditionally.
 */
function roleActiveFor(role: string, numPlayers: number): boolean {
  const mafiaCount = Math.floor(numPlayers / 4);
  switch (role) {
    case 'MAFIA':
      return mafiaCount >= 1;
    case 'SHERIFF':
    case 'DOCTOR':
    case 'VIGILANTE':
      return true; // always exactly 1 for any playable config (5..20 players)
    case 'VILLAGER':
      return numPlayers - mafiaCount - 3 >= 1;
    default:
      return false;
  }
}

const GameList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { games, fetchGames, createGame, connecting, headlineStats, fetchHeadlineStats } = useGameStore();
  const { searchQuery, setSearchQuery, layout } = useUIStore();
  // '/?action=new' (sidebar Quick Action) opens the same create-game modal the
  // header button opens — no second modal. The initializer covers a fresh
  // mount (including SSR), the effect covers an in-place navigation from an
  // already-mounted GameList.
  const [showNewGame, setShowNewGame] = useState(() => searchParams.get('action') === 'new');
  const [createError, setCreateError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{
    presets: Array<CatalogModelEntry & { label: string }>;
    providers: string[];
    loaded: boolean;
    failed: boolean;
  }>({
    presets: [],
    providers: [],
    loaded: false,
    failed: false,
  });
  const [newGameConfig, setNewGameConfig] = useState({
    numPlayers: 10,
    nightDuration: 60,
    dayDuration: 120,
    votingDuration: 30,
  });

  // Default roleModels (DF-MAFIA-AI-BENCHMARK-42): providers the endpoint
  // actually lists, 'provider/model' spec form (FLEXIBLE_PLAYER_MODELS.md),
  // covering every engine-playable role INCLUDING VIGILANTE.
  const defaultRoleModels = (): Record<string, { provider: string; model: string }> => {
    const first = FALLBACK_PRESETS[0];
    const spec: Record<string, { provider: string; model: string }> = {};
    for (const role of ENGINE_PLAYABLE_ROLES) {
      spec[role] = { provider: first.provider, model: first.modelId };
    }
    return spec;
  };
  const [roleModels, setRoleModels] = useState<Record<string, { provider: string; model: string }>>(defaultRoleModels);

  // Fetch the live server catalog on mount, replacing the honest fallback
  // presets with the full cached list. On failure the fallback stays visible
  // and a notice tells the user the list is the (real, verified) fallback —
  // never invented models.
  useEffect(() => {
    let cancelled = false;
    // Fail-soft: a missing/broken modelsAPI (or a rejected fetch) must land
    // on the honest fallback notice, never an uncaught effect error.
    try {
      modelsAPI
        .get()
        .then((data) => {
          if (cancelled || !Array.isArray(data.providers) || !Array.isArray(data.models)) return;
          const presets = data.models
            .filter((m) => m.provider && m.modelId)
            .map((m) => ({ ...m, label: `${m.displayName || m.modelId} (${m.provider.toLowerCase()})` }));
          if (presets.length === 0) return;
          setCatalog({
            presets,
            providers: data.providers,
            loaded: true,
            failed: false,
          });
          // DF-MAFIA-AI-BENCHMARK-42: re-anchor any role default whose spec
          // does not resolve against the LOADED catalog (provider listed AND
          // exact {provider, modelId} pair present), so the create payload
          // can never carry a spec the server does not resolve.
          setRoleModels((prev) => {
            const providerListed = (p: string) => presets.some((x) => x.provider === p);
            const pairPresent = (p: string, m: string) =>
              presets.some((x) => x.provider === p && x.modelId === m);
            const next = { ...prev };
            let changed = false;
            for (const role of ENGINE_PLAYABLE_ROLES) {
              const rm = next[role];
              if (!rm || !providerListed(rm.provider) || !pairPresent(rm.provider, rm.model)) {
                next[role] = { provider: presets[0].provider, model: presets[0].modelId };
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        })
        .catch(() => {
          if (!cancelled) setCatalog((prev) => ({ ...prev, loaded: true, failed: true }));
        });
    } catch {
      if (!cancelled) setCatalog((prev) => ({ ...prev, loaded: true, failed: true }));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchGames({ limit: 50 });
    // DF-MAFIA-AI-BENCHMARK-32: the headline bar's Total/Active/Completed
    // values come from GET /api/v1/stats — the same source the Stats tab
    // uses. The games list above is a page window (limit=50) and must never
    // be presented as totals.
    fetchHeadlineStats();
  }, [fetchGames, fetchHeadlineStats]);

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

  const presets = catalog.loaded && catalog.presets.length > 0 ? catalog.presets : FALLBACK_PRESETS;
  const specOf = (p: CatalogModelEntry): string => `${p.provider}/${p.modelId}`;
  const selectedSpec = (role: string): string => {
    const rm = roleModels[role];
    return rm ? `${rm.provider}/${rm.model}` : '';
  };

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

      {/* Stats Bar (DF-MAFIA-AI-BENCHMARK-32: totals from /stats, same
          source as the Stats tab; the games page is only a page window).
          Setup stays page-derived — /stats exposes no setupGames field —
          and is not a headline. */}
      <div className="stats-bar">
        <div className="stat-item">
          <span className="stat-value">
            {headlineStats ? headlineStats.totalGames : '—'}
          </span>
          <span className="stat-label">Total Games</span>
        </div>
        <div className="stat-item">
          <span className="stat-value green">
            {headlineStats ? headlineStats.activeGames : '—'}
          </span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat-item">
          <span className="stat-value blue">{games.filter((g) => g.status === 'SETUP').length}</span>
          <span className="stat-label">Setup</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">
            {headlineStats ? headlineStats.completedGames : '—'}
          </span>
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
                {/* DF-MAFIA-AI-BENCHMARK-42: the fetch-failure path tells the
                    user the preset list is the verified in-app fallback —
                    it never silently pretends the catalog was loaded. */}
                {catalog.failed && (
                  <p className="form-hint" style={{ color: 'var(--color-warning, #d97706)' }}>
                    Could not reach the model catalog — showing the built-in preset list (real, verified ids only).
                  </p>
                )}
                {MAFIA_ROLES.filter(({ role }) => roleActiveFor(role, newGameConfig.numPlayers)).map(({ role, label, icon }) => (
                  <div key={role} className="form-group role-model-row">
                    <label>
                      <span className="role-icon">{icon}</span> {label}
                    </label>
                    <select
                      value={selectedSpec(role)}
                      onChange={(e) => {
                        const slashIdx = e.target.value.indexOf('/');
                        const provider = e.target.value.slice(0, slashIdx);
                        const model = e.target.value.slice(slashIdx + 1);
                        setRoleModels({
                          ...roleModels,
                          [role]: { provider, model },
                        });
                      }}
                      className="model-select"
                    >
                      {presets.map((m) => (
                        <option key={specOf(m)} value={specOf(m)}>
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
                      const first = presets[0];
                      const all: Record<string, { provider: string; model: string }> = {};
                      ENGINE_PLAYABLE_ROLES.forEach((role) => {
                        all[role] = { provider: first.provider, model: first.modelId };
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