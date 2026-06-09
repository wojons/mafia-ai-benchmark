import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameEvents, GameEvent } from '../hooks/useGameEvents';
import { formatDistanceToNow } from 'date-fns';
import Loading from './Loading';

// Color scheme
const THINK_COLOR = '#8B5CF6'; // Purple for THINK
const SAYS_COLOR = '#06B6D4';  // Cyan for SAYS

interface EventEntry {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  visibility: string;
  actorId?: string;
  color: string;
  rawEvent: GameEvent;
}

const SplitPaneView: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { events, connected } = useGameEvents(gameId || null);

  const [adminMode, setAdminMode] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const userScrolledLeft = useRef(false);
  const userScrolledRight = useRef(false);

  // Generate display entries from events
  const allEntries: EventEntry[] = events.map(event => {
    const message = generateEventMessage(event);
    const color = determineColor(event);
    return {
      id: event.id,
      type: event.type,
      message,
      timestamp: event.timestamp,
      visibility: event.visibility,
      actorId: event.actorId,
      color,
      rawEvent: event,
    };
  });

  // Split into LEFT (public SAYS + votes + phase changes) and RIGHT (THINK/reasoning)
  const leftEntries = allEntries.filter(e => {
    const t = e.type;
    return (
      t.includes('SAYS') ||
      t.includes('PHASE') ||
      t.includes('VOTE') ||
      t.includes('ACCUSATION') ||
      t.includes('PLAYER_KILLED') ||
      t.includes('PLAYER_LYNCHED') ||
      t.includes('WINNER') ||
      t.includes('GAME_STARTED') ||
      t.includes('GAME_ENDED') ||
      t.includes('ROLE_CLAIMED') ||
      t.includes('ROLE_REVEALED') ||
      t.includes('AGENT_ACTION') ||
      t.includes('MORNING_REVEAL') ||
      t.includes('NIGHT_STARTED') ||
      t.includes('NIGHT_ENDED') ||
      t.includes('PLAYER_JOINED') ||
      t.includes('PLAYER_LEFT') ||
      t.includes('PLAYER_ELIMINATED')
    );
  });

  const rightEntries = allEntries.filter(e => {
    const t = e.type;
    return (
      t.includes('THINK') ||
      t.includes('AGENT_THINK')
    );
  });

  // Auto-scroll as new events arrive
  useEffect(() => {
    if (autoScroll && leftPaneRef.current && !userScrolledLeft.current) {
      leftPaneRef.current.scrollTop = leftPaneRef.current.scrollHeight;
    }
  }, [leftEntries.length, autoScroll]);

  useEffect(() => {
    if (autoScroll && rightPaneRef.current && !userScrolledRight.current) {
      rightPaneRef.current.scrollTop = rightPaneRef.current.scrollHeight;
    }
  }, [rightEntries.length, autoScroll]);

  // Detect user scroll to pause auto-scroll
  const handleLeftScroll = useCallback(() => {
    if (!leftPaneRef.current) return;
    const el = leftPaneRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledLeft.current = !atBottom;
    if (atBottom) {
      setAutoScroll(true);
    }
  }, []);

  const handleRightScroll = useCallback(() => {
    if (!rightPaneRef.current) return;
    const el = rightPaneRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledRight.current = !atBottom;
    if (atBottom) {
      setAutoScroll(true);
    }
  }, []);

  if (!gameId) {
    return <Loading message="No game selected..." />;
  }

  return (
    <div className="split-pane-container">
      {/* Header */}
      <div className="split-pane-header">
        <div className="header-left">
          <button className="btn btn-sm" onClick={() => navigate('/')}>
            ← Back
          </button>
          <h1>Game Observer: {gameId.substring(0, 8)}...</h1>
          <span className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}>
            <span className="pulse-dot" />
            {connected ? 'LIVE' : 'DISCONNECTED'}
          </span>
        </div>
        <div className="header-right">
          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={adminMode}
              onChange={(e) => setAdminMode(e.target.checked)}
            />
            <span className="toggle-label">Inner Monologue</span>
            <span className="toggle-badge">ADMIN</span>
          </label>
          <label className="auto-scroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span className="toggle-label">Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* Split Panes */}
      <div className="split-panes">
        {/* LEFT PANE: Table Talk (Public) */}
        <div className="pane pane-left">
          <div className="pane-title-bar" style={{ borderBottomColor: SAYS_COLOR }}>
            <span className="pane-icon">🗣️</span>
            <span className="pane-title">Table Talk</span>
            <span className="pane-subtitle">Public Events</span>
            <span className="pane-count">{leftEntries.length}</span>
          </div>
          <div
            className="pane-content"
            ref={leftPaneRef}
            onScroll={handleLeftScroll}
          >
            {leftEntries.length === 0 ? (
              <div className="pane-empty">
                <span className="empty-icon">⏳</span>
                <p>Waiting for game events...</p>
                <p className="empty-hint">Public statements, votes, and phase changes will appear here.</p>
              </div>
            ) : (
              leftEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`event-entry event-${entry.visibility.toLowerCase()}`}
                  style={{ borderLeftColor: entry.color }}
                >
                  <div className="event-header">
                    <span className="event-type" style={{ color: entry.color }}>
                      {formatEventType(entry.type)}
                    </span>
                    <span className="event-time">
                      {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="event-message">{entry.message}</div>
                  {entry.actorId && (
                    <div className="event-actor">
                      by <strong>{entry.actorId}</strong>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT PANE: Inner Monologue (Private - Admin Gated) */}
        <div className="pane pane-right">
          <div className="pane-title-bar" style={{ borderBottomColor: THINK_COLOR }}>
            <span className="pane-icon">🧠</span>
            <span className="pane-title">Inner Monologue</span>
            <span className="pane-subtitle">Agent Reasoning</span>
            <span className="pane-count">{rightEntries.length}</span>
          </div>
          {!adminMode ? (
            <div className="pane-gated">
              <div className="gate-content">
                <span className="gate-icon">🔒</span>
                <h3>Admin Access Required</h3>
                <p>Agent internal reasoning is hidden by default.</p>
                <p className="gate-hint">
                  Toggle <strong>"Inner Monologue"</strong> above to reveal.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="pane-content"
              ref={rightPaneRef}
              onScroll={handleRightScroll}
            >
              {rightEntries.length === 0 ? (
                <div className="pane-empty">
                  <span className="empty-icon">💭</span>
                  <p>No THINK events yet...</p>
                  <p className="empty-hint">Agent internal reasoning will appear here once the game starts.</p>
                </div>
              ) : (
                rightEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="event-entry event-private"
                    style={{ borderLeftColor: entry.color }}
                  >
                    <div className="event-header">
                      <span className="event-type" style={{ color: entry.color }}>
                        {formatEventType(entry.type)}
                      </span>
                      <span className="event-time">
                        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="event-message">{entry.message}</div>
                    {entry.actorId && (
                      <div className="event-actor">
                        by <strong>{entry.actorId}</strong>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Determine the color for an event based on its visibility and type.
 */
function determineColor(event: GameEvent): string {
  if (event.type.includes('THINK')) return THINK_COLOR;
  if (event.type.includes('SAYS')) return SAYS_COLOR;
  if (event.type.includes('PHASE')) return SAYS_COLOR;
  if (event.type.includes('VOTE')) return SAYS_COLOR;
  if (event.type.includes('WINNER')) return '#22c55e'; // green for wins
  if (event.type.includes('KILLED') || event.type.includes('LYNCHED')) return '#ef4444'; // red
  return SAYS_COLOR;
}

/**
 * Generate a human-readable message from an event.
 */
function generateEventMessage(event: GameEvent): string {
  const { type: eventType, data } = event;

  switch (eventType) {
    case 'PHASE_CHANGED': {
      const d = data as { toPhase?: string; dayNumber?: number };
      return `Phase → ${(d.toPhase || 'UNKNOWN').replace(/_/g, ' ')} (Day ${d.dayNumber ?? '?'})`;
    }
    case 'AGENT_SAYS_BROADCASTED': {
      const d = data as { playerId?: string; statement?: string; playerName?: string };
      return `${d.playerName || d.playerId || 'Unknown'}: "${d.statement || ''}"`;
    }
    case 'AGENT_THINK_COMPLETED': {
      const d = data as { playerId?: string; think?: string; reasoning?: string; playerName?: string };
      const reasoning = d.think || d.reasoning || JSON.stringify(data);
      return `${d.playerName || d.playerId || 'Unknown'}: ${reasoning}`;
    }
    case 'AGENT_THINK_STARTED': {
      const d = data as { playerId?: string; playerName?: string };
      return `${d.playerName || d.playerId || 'Unknown'} is thinking...`;
    }
    case 'VOTE_CAST': {
      const d = data as { voterId?: string; targetId?: string; voterName?: string; targetName?: string };
      return `${d.voterName || d.voterId} → voted for ${d.targetName || d.targetId}`;
    }
    case 'PLAYER_KILLED': {
      const d = data as { playerId?: string; role?: string; playerName?: string };
      return `💀 ${d.playerName || d.playerId} was killed (${d.role || '?'})`;
    }
    case 'PLAYER_LYNCHED': {
      const d = data as { playerId?: string; role?: string; playerName?: string; votes?: number };
      return `🗳️ ${d.playerName || d.playerId} was lynched (${d.role || '?'}) - ${d.votes ?? '?'} votes`;
    }
    case 'WINNER_DETERMINED': {
      const d = data as { winner?: string };
      return `🏆 ${d.winner || 'Unknown'} WINS!`;
    }
    case 'MAFIA_WINS': return '🎭 Mafia wins!';
    case 'TOWN_WINS': return '🏘️ Town wins!';
    case 'ACCUSATION_MADE': {
      const d = data as { accuserId?: string; targetId?: string; accusation?: string };
      return `${d.accuserId} accuses ${d.targetId}: "${d.accusation || ''}"`;
    }
    case 'ROLE_CLAIMED': {
      const d = data as { playerId?: string; role?: string };
      return `${d.playerId} claims to be ${d.role}`;
    }
    case 'PLAYER_JOINED': {
      const d = data as { playerId?: string; name?: string };
      return `${d.name || d.playerId} joined the game`;
    }
    case 'PLAYER_ELIMINATED': {
      const d = data as { playerId?: string; role?: string; cause?: string; playerName?: string };
      return `❌ ${d.playerName || d.playerId} eliminated (${d.cause || 'unknown'})`;
    }
    case 'NIGHT_STARTED': {
      const d = data as { nightNumber?: number };
      return `🌙 Night ${d.nightNumber || '?'} begins`;
    }
    case 'MORNING_REVEAL': {
      const d = data as { deaths?: Array<{ playerId: string }> };
      const deaths = d.deaths || [];
      if (deaths.length === 0) return '☀️ Morning reveals — no deaths';
      return `☀️ Morning reveals — ${deaths.length} death(s)`;
    }
    case 'GAME_STARTED': return '🎮 Game started';
    case 'GAME_ENDED': {
      const d = data as { reason?: string };
      return `🏁 Game ended: ${d.reason || 'unknown'}`;
    }
    case 'AGENT_ACTION_TAKEN': {
      const d = data as { agentId?: string; action?: string; targetId?: string };
      return `${d.agentId}: ${d.action || 'acted'} → ${d.targetId || ''}`;
    }
    default: {
      // Try to extract a meaningful message from data
      const d = data as Record<string, unknown>;
      if (d.statement) return String(d.statement);
      if (d.think || d.reasoning) return String(d.think || d.reasoning);
      if (d.message) return String(d.message);
      return `Event: ${eventType.replace(/_/g, ' ')}`;
    }
  }
}

/**
 * Format event type for display.
 */
function formatEventType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Agent Think', 'THINK')
    .replace('Agent Says', 'SAYS');
}

export default SplitPaneView;
