import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { websocket } from '../services/websocket';
import { api } from '../services/api';
import { formatDistanceToNow } from 'date-fns';
import Loading from './Loading';
import {
  normalizeWsEvent,
  mergeEventsById,
  deriveWatcherState,
  asGameEvents,
  type WatcherEvent,
} from '../utils/watcherEvents';

const GameWatcher: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { currentGame, gameState, players, selectGame } = useGameStore();
  // Spectator lists hydrated from recorded history (DF-MAFIA-AI-BENCHMARK-11).
  // `mergedEvents` is the single source of truth: hydrated history rows first,
  // live WS rows merged in by id, one shared derivation on top.
  const [mergedEvents, setMergedEvents] = useState<WatcherEvent[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

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
        const event = normalizeWsEvent(data, gameId ?? undefined);
        if (event) {
          setMergedEvents((prev) => mergeEventsById(prev, [event]));
        }
      });

      return () => {
        unsubscribe();
      };
    }
  }, [gameId, selectGame]);

  // Hydrate from recorded history on mount (DF-MAFIA-AI-BENCHMARK-11):
  // GET /api/v1/games/<id>/events via the existing api.games.getEvents
  // helper. Visibility follows the API convention already used elsewhere in
  // the web app (TimelineView): 'all' lets the server return the same event
  // set the live WS subscription delivers, so live and history agree.
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    async function hydrateHistory() {
      try {
        // services/api.ts unwraps the { success, data } envelope, so this
        // resolves to the raw events array (TimelineView's res.data read was
        // an annotation lie; do not copy it here).
        const events = await api.games.getEvents(gameId!, 'all');
        if (cancelled) return;
        const rows = Array.isArray(events)
          ? events
          : ((events as unknown as { data?: unknown[] })?.data ?? []);
        setMergedEvents((prev) =>
          mergeEventsById(
            rows
              .map((row) => normalizeWsEvent(row, gameId ?? undefined))
              .filter((e): e is WatcherEvent => e !== null),
            prev,
          ),
        );
      } catch (error) {
        console.error('Failed to hydrate game event history:', error);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    }

    hydrateHistory();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const { votes, statements, timeline } = deriveWatcherState(mergedEvents);

  // Discussion rendering reuses ChatPanel's derivation over the merged rows
  // (filter AGENT_SAYS_BROADCASTED, read playerName/statement) so spectator
  // and player boards cannot drift apart.
  const discussionEvents = asGameEvents(
    mergedEvents.filter((event) => event.type === 'AGENT_SAYS_BROADCASTED'),
  );

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

        {/* Votes (hydrated + live) */}
        <div className="watcher-section">
          <h2>🗳️ Votes</h2>
          <div className="live-feed">
            {historyLoaded && votes.length === 0 ? (
              <p className="no-updates">No votes cast yet</p>
            ) : (
              <div className="updates-list">
                {votes.map((vote, index) => (
                  <div key={`${vote.voterId}-${vote.targetId}-${index}`} className="update-item vote-line">
                    <span className="update-time">
                      {formatDistanceToNow(vote.timestamp, { addSuffix: true })}
                    </span>
                    <span className="update-message">
                      {vote.voterId} voted for {vote.targetId}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Discussion (hydrated + live) */}
        <div className="watcher-section">
          <h2>💬 Discussion</h2>
          <div className="live-feed">
            {historyLoaded && statements.length === 0 ? (
              <p className="no-updates">No statements yet</p>
            ) : (
              <div className="chat-messages">
                {discussionEvents.map((event, index) => {
                  const data = event.data as { playerName?: string; statement?: string };
                  return (
                    <div key={event.id || index} className="chat-message">
                      <div className="message-header">
                        <span className="player-name">{data.playerName || 'Unknown'}</span>
                        <span className="message-time">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="message-body">{data.statement}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Events (hydrated + live) */}
        <div className="watcher-section">
          <h2>📺 Recent Events</h2>
          <div className="live-feed">
            {historyLoaded && timeline.length === 0 ? (
              <p className="no-updates">Waiting for game events...</p>
            ) : (
              <div className="updates-list">
                {timeline
                  .slice()
                  .reverse()
                  .slice(0, 50)
                  .map((update) => (
                    <div key={update.id} className="update-item">
                      <span className="update-time">
                        {formatDistanceToNow(update.timestamp, { addSuffix: true })}
                      </span>
                      <span className="update-message">{update.message}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
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
  );
};

export default GameWatcher;