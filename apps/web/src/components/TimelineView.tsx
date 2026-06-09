import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import Loading from './Loading';

// Event type from API response
interface TimelineEvent {
  id: string;
  gameId: string;
  type: string;
  timestamp: string;
  visibility: string;
  actorId?: string;
  targetId?: string;
  data: Record<string, unknown>;
  metadata: {
    turnNumber: number;
    dayNumber: number;
    phase: string;
    sequence: number;
  };
}

// Filter categories
type EventFilterType = 'kill' | 'investigation' | 'vote' | 'discussion' | 'think' | 'all';

const FILTER_OPTIONS: { value: EventFilterType; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: '#94a3b8' },
  { value: 'kill', label: 'Kill', color: '#ef4444' },
  { value: 'investigation', label: 'Investigate', color: '#3b82f6' },
  { value: 'vote', label: 'Vote', color: '#f59e0b' },
  { value: 'discussion', label: 'Discussion', color: '#22c55e' },
  { value: 'think', label: 'Think', color: '#8b5cf6' },
];

// Phase color mapping
const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  NIGHT_ACTIONS: { bg: '#1e3a5f', text: '#93c5fd' },
  MORNING_REVEAL: { bg: '#3b3b1a', text: '#fde68a' },
  DAY_DISCUSSION: { bg: '#5c3d0e', text: '#fcd34d' },
  DAY_VOTING: { bg: '#78350f', text: '#fbbf24' },
  RESOLUTION: { bg: '#4a1d1d', text: '#fca5a5' },
  GAME_OVER: { bg: '#1a1a2e', text: '#c4b5fd' },
  SETUP: { bg: '#1e293b', text: '#94a3b8' },
};

function isNightPhase(phase: string): boolean {
  return phase === 'NIGHT_ACTIONS';
}

function classifyEventType(type: string): EventFilterType {
  const t = type.toUpperCase();
  if (t.includes('KILL') || t.includes('LYNCHED') || t.includes('ELIMINATED')) return 'kill';
  if (t.includes('INVESTIGAT')) return 'investigation';
  if (t.includes('VOTE')) return 'vote';
  if (t.includes('SAYS') || t.includes('BROADCAST') || t.includes('ACCUSATION') || t.includes('CLAIM') || t.includes('DISCUSSION')) return 'discussion';
  if (t.includes('THINK')) return 'think';
  return 'all';
}

function formatEventTitle(event: TimelineEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'PLAYER_KILLED':
      return `💀 ${d.playerName || d.playerId || 'Unknown'} killed`;
    case 'PLAYER_LYNCHED':
      return `🗳️ ${d.playerName || d.playerId || 'Unknown'} lynched`;
    case 'PLAYER_ELIMINATED':
      return `❌ ${d.playerName || d.playerId || 'Unknown'} eliminated`;
    case 'VOTE_CAST':
      return `🗳️ ${d.voterName || d.voterId} → ${d.targetName || d.targetId}`;
    case 'SHERIFF_INVESTIGATION_RESULT':
      return `🔍 Investigation: ${d.targetId}`;
    case 'AGENT_SAYS_BROADCASTED':
      return `💬 ${d.playerName || d.playerId}: "${String(d.statement || '').substring(0, 60)}"`;
    case 'AGENT_THINK_COMPLETED':
      return `🧠 ${d.playerName || d.playerId} thinks...`;
    case 'PHASE_CHANGED':
      return `⏭️ Phase: ${String(d.toPhase || '').replace(/_/g, ' ')}`;
    case 'ACCUSATION_MADE':
      return `⚠️ ${d.accuserId} accuses ${d.targetId}`;
    default:
      return event.type.replace(/_/g, ' ');
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const TimelineView: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<EventFilterType>('all');
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<1 | 2 | 5>(1);
  const [scrubPosition, setScrubPosition] = useState(0); // 0 to 100

  const timelineRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch events
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    async function fetchEvents() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.games.getEvents(gameId!, 'all');
        if (!cancelled) {
          // Sort by sequence
          const sorted = (res.data || []).sort(
            (a, b) => a.metadata.sequence - b.metadata.sequence
          );
          setEvents(sorted);
          if (sorted.length > 0) {
            setScrubPosition(100);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || 'Failed to load events');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvents();
    return () => { cancelled = true; };
  }, [gameId]);

  // Filter events
  const filteredEvents = useMemo(() => {
    if (activeFilter === 'all') return events;
    return events.filter(e => classifyEventType(e.type) === activeFilter);
  }, [events, activeFilter]);

  // Compute phase blocks
  const phaseBlocks = useMemo(() => {
    if (events.length === 0) return [];
    const blocks: { phase: string; startSeq: number; endSeq: number; dayNumber: number }[] = [];
    const minSeq = events[0].metadata.sequence;
    const maxSeq = events[events.length - 1].metadata.sequence;

    // Group consecutive events by phase
    let currentPhase = events[0].metadata.phase;
    let blockStart = events[0].metadata.sequence;
    let currentDay = events[0].metadata.dayNumber;

    for (let i = 1; i < events.length; i++) {
      const phase = events[i].metadata.phase;
      const day = events[i].metadata.dayNumber;
      if (phase !== currentPhase || day !== currentDay) {
        blocks.push({
          phase: currentPhase,
          startSeq: blockStart,
          endSeq: events[i - 1].metadata.sequence,
          dayNumber: currentDay,
        });
        currentPhase = phase;
        blockStart = events[i].metadata.sequence;
        currentDay = day;
      }
    }
    // Push final block
    blocks.push({
      phase: currentPhase,
      startSeq: blockStart,
      endSeq: maxSeq,
      dayNumber: currentDay,
    });

    return blocks;
  }, [events]);

  const totalEvents = events.length;
  const filteredCount = filteredEvents.length;
  const minSeq = events.length > 0 ? events[0].metadata.sequence : 0;
  const maxSeq = events.length > 0 ? events[events.length - 1].metadata.sequence : 0;

  // Current visible index based on scrub
  const currentEventIndex = Math.round((scrubPosition / 100) * (filteredEvents.length - 1));
  const currentEvent = filteredEvents[currentEventIndex] || null;

  // Auto-play logic
  useEffect(() => {
    if (isPlaying && filteredEvents.length > 0) {
      const intervalMs = 1000 / playSpeed;
      playIntervalRef.current = setInterval(() => {
        setScrubPosition(prev => {
          const step = 100 / filteredEvents.length;
          const next = prev + step;
          if (next >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return next;
        });
      }, intervalMs);
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, playSpeed, filteredEvents.length]);

  // Stop playing when manually scrubbing
  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setScrubPosition(Number(e.target.value));
  }, []);

  const handlePlayPause = useCallback(() => {
    if (scrubPosition >= 100) {
      setScrubPosition(0);
    }
    setIsPlaying(prev => !prev);
  }, [scrubPosition]);

  const handleSpeedChange = useCallback((speed: 1 | 2 | 5) => {
    setPlaySpeed(speed);
  }, []);

  const handleEventClick = useCallback((event: TimelineEvent) => {
    setSelectedEvent(event);
  }, []);

  const closePopup = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  // Map sequence to position percentage
  const seqToPercent = useCallback(
    (seq: number) => {
      if (maxSeq === minSeq) return 50;
      return ((seq - minSeq) / (maxSeq - minSeq)) * 100;
    },
    [minSeq, maxSeq]
  );

  if (!gameId) {
    return <Loading message="No game ID provided..." />;
  }

  if (loading) {
    return <Loading message="Loading timeline..." />;
  }

  if (error) {
    return (
      <div className="timeline-container">
        <div className="timeline-header">
          <button className="btn btn-sm" onClick={() => navigate('/')}>← Back</button>
          <h1>Timeline</h1>
        </div>
        <div className="empty-state">
          <span className="empty-icon">⚠️</span>
          <h3>Error Loading Timeline</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-container">
      {/* Header */}
      <div className="timeline-header">
        <div className="timeline-header-left">
          <button className="btn btn-sm" onClick={() => navigate('/')}>← Back</button>
          <h1>Game Timeline</h1>
          <span className="game-id-badge">{gameId.substring(0, 8)}...</span>
        </div>
        <div className="timeline-header-right">
          <span className="event-count">{filteredCount} / {totalEvents} events</span>
        </div>
      </div>

      {/* Filters */}
      <div className="timeline-filters">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`timeline-filter-btn ${activeFilter === opt.value ? 'active' : ''}`}
            style={{
              borderColor: activeFilter === opt.value ? opt.color : 'var(--color-border)',
              color: activeFilter === opt.value ? opt.color : undefined,
            }}
            onClick={() => setActiveFilter(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Phase legend */}
      <div className="timeline-phase-legend">
        <span className="legend-label">Phases:</span>
        <span className="legend-item" style={{ background: PHASE_COLORS.NIGHT_ACTIONS?.bg || '#1e3a5f' }}>🌙 Night</span>
        <span className="legend-item" style={{ background: PHASE_COLORS.DAY_DISCUSSION?.bg || '#5c3d0e' }}>☀️ Day Discussion</span>
        <span className="legend-item" style={{ background: PHASE_COLORS.DAY_VOTING?.bg || '#78350f' }}>🗳️ Day Voting</span>
      </div>

      {/* Timeline area */}
      <div className="timeline-scroll-container" ref={timelineRef}>
        <div className="timeline-track">
          {/* Phase blocks */}
          {phaseBlocks.map((block, i) => {
            const leftPct = seqToPercent(block.startSeq);
            const rightPct = seqToPercent(block.endSeq);
            const widthPct = Math.max(rightPct - leftPct, 1);
            const colors = PHASE_COLORS[block.phase] || { bg: '#1e293b', text: '#94a3b8' };
            const isNight = isNightPhase(block.phase);
            const dayLabel = isNight ? `Night ${block.dayNumber}` : `Day ${block.dayNumber}`;

            return (
              <div
                key={i}
                className={`timeline-phase-block ${isNight ? 'night' : 'day'}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  background: colors.bg,
                  color: colors.text,
                }}
                title={`${block.phase.replace(/_/g, ' ')} — ${dayLabel}`}
              >
                <span className="phase-block-label">
                  {isNight ? '🌙' : '☀️'} {dayLabel}
                </span>
              </div>
            );
          })}

          {/* Event markers */}
          {filteredEvents.map((event, idx) => {
            const pct = seqToPercent(event.metadata.sequence);
            const filterCat = classifyEventType(event.type);
            const filterInfo = FILTER_OPTIONS.find(f => f.value === filterCat);
            const markerColor = filterInfo?.color || '#94a3b8';
            const isCurrent = idx === currentEventIndex;

            return (
              <div
                key={event.id}
                className={`timeline-marker ${isCurrent ? 'current' : ''}`}
                style={{
                  left: `${pct}%`,
                  background: markerColor,
                  borderColor: isCurrent ? '#fff' : markerColor,
                }}
                onClick={() => handleEventClick(event)}
                title={formatEventTitle(event)}
              >
                <div className="marker-dot" style={{ background: markerColor }} />
              </div>
            );
          })}

          {/* Current position indicator */}
          {currentEvent && (
            <div
              className="timeline-current-indicator"
              style={{ left: `${seqToPercent(currentEvent.metadata.sequence)}%` }}
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="timeline-controls">
        <button
          className="btn btn-sm"
          onClick={handlePlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸️ Pause' : '▶️ Play'}
        </button>

        <div className="timeline-slider">
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={scrubPosition}
            onChange={handleScrub}
            className="scrub-slider"
          />
        </div>

        <div className="timeline-speed-controls">
          {([1, 2, 5] as const).map(speed => (
            <button
              key={speed}
              className={`btn btn-sm ${playSpeed === speed ? 'btn-primary' : ''}`}
              onClick={() => handleSpeedChange(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* Current event preview */}
        {currentEvent && (
          <div className="timeline-current-preview">
            <span className="preview-time">{formatTimestamp(currentEvent.timestamp)}</span>
            <span className="preview-title">{formatEventTitle(currentEvent)}</span>
          </div>
        )}
      </div>

      {/* Event detail popup */}
      {selectedEvent && (
        <div className="timeline-popup-overlay" onClick={closePopup}>
          <div className="timeline-popup" onClick={e => e.stopPropagation()}>
            <div className="popup-header">
              <h3>{formatEventTitle(selectedEvent)}</h3>
              <button className="popup-close" onClick={closePopup}>✕</button>
            </div>
            <div className="popup-body">
              <div className="popup-fields">
                <div className="popup-field">
                  <span className="field-label">Type</span>
                  <span className="field-value event-type-badge" style={{
                    background: FILTER_OPTIONS.find(f => f.value === classifyEventType(selectedEvent.type))?.color + '20',
                    color: FILTER_OPTIONS.find(f => f.value === classifyEventType(selectedEvent.type))?.color,
                  }}>
                    {selectedEvent.type.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="popup-field">
                  <span className="field-label">Time</span>
                  <span className="field-value">{new Date(selectedEvent.timestamp).toLocaleString()}</span>
                </div>
                <div className="popup-field">
                  <span className="field-label">Phase</span>
                  <span className="field-value">{selectedEvent.metadata.phase.replace(/_/g, ' ')}</span>
                </div>
                <div className="popup-field">
                  <span className="field-label">Day/Turn</span>
                  <span className="field-value">Day {selectedEvent.metadata.dayNumber}, Turn {selectedEvent.metadata.turnNumber}</span>
                </div>
                <div className="popup-field">
                  <span className="field-label">Visibility</span>
                  <span className="field-value">{selectedEvent.visibility}</span>
                </div>
                <div className="popup-field">
                  <span className="field-label">Sequence</span>
                  <span className="field-value">#{selectedEvent.metadata.sequence}</span>
                </div>
                {selectedEvent.actorId && (
                  <div className="popup-field">
                    <span className="field-label">Actor</span>
                    <span className="field-value">{selectedEvent.actorId}</span>
                  </div>
                )}
                {selectedEvent.targetId && (
                  <div className="popup-field">
                    <span className="field-label">Target</span>
                    <span className="field-value">{selectedEvent.targetId}</span>
                  </div>
                )}
              </div>
              <div className="popup-content">
                <h4>Event Data</h4>
                <pre className="popup-json">{JSON.stringify(selectedEvent.data, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimelineView;
