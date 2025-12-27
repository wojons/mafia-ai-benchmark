# UI Components Specification

## Overview
React-based web interface with TypeScript, designed for high-performance streaming updates and real-time multi-agent monitoring. Components follow a split-pane "consciousness" design pattern to clearly separate THINK vs SAYS.

## Design System

### Colors & Theme
**Dark Theme (Cyber-noir Terminal)**
```typescript
const theme = {
  colors: {
    // Base
    background: '#0a0a0b',
    surface: '#111113',
    surfaceHover: '#1a1a1d',
    
    // Roles
    mafia: '#dc2626',      // Red
    town: '#2563eb',       // Blue
    doctor: '#059669',     // Green
    sheriff: '#d97706',    // Amber
    villager: '#64748b',   // Slate
    
    // States
    alive: '#ffffff',
    dead: '#64748b',
    eliminated: '#ef4444',
    protected: '#10b981',
    
    // UI
    think: '#8b5cf6',      // Purple (private)
    say: '#06b6d4',        // Cyan (public)
    suspicion: '#f59e0b',  // Amber
    
    // Text
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
  },
  
  // Typography
  fontFamily: {
    mono: 'JetBrains Mono, Fira Code, monospace',
    sans: 'Inter, system-ui, sans-serif',
  },
};
```

### Layout Grid
```
┌─────────────────────────────────────────────────────────────┐
│  Header: Game Status + Phase                                │
├──────────────┬────────────────────────────────────────────────┤
│              │                                                │
│  Agent Grid  │  Game Feed (scroll)                          │
│  (2/3 width) │  (1/3 width)                                 │
│              │                                                │
│  [Card][Card]│  [Timestamp] Event                           │
│  [Card][Card]│  [Timestamp] Event                           │
│  [Card][Card]│  [Timestamp] Event                           │
│              │                                                │
├──────────────┴────────────────────────────────────────────────┤
│  Controls: Pause/Resume/Step/Speed/Reveal Toggle              │
└─────────────────────────────────────────────────────────────┘

Responsive Breakpoints:
- Desktop (>1024px): Side-by-side grid + feed
- Tablet (768-1024px): Grid on top, feed below
- Mobile (<768px): One column, swipe between agents
```

---

## Component Architecture

### 1. AgentCard Component

**File:** `web/src/components/AgentCard.tsx`

**Props:**
```typescript
interface AgentCardProps {
  player: Player;
  gameState: GameState;
  thinkStream: string[];        // THINK chunks for this turn
  sayStream: string[];          // SAYS chunks for this turn
  suspectScore: number;         // 0-100
  viewMode: 'admin' | 'town' | 'postmortem';
  isActive: boolean;            // Currently speaking/acting
  isDead: boolean;
  roleRevealed: boolean;
}
```

**State:**
```typescript
interface AgentCardState {
  thinkText: string;            // Accumulated THINK text
  sayText: string;              // Accumulated SAYS text
  isStreamingThink: boolean;
  isStreamingSay: boolean;
  expanded: boolean;            // User can expand/collapse
}
```

**Layout:**
```
┌──────────────────────────────────┐
│  Header                          │
│  ─────────────────────────────── │
│  [Avatar] Name        [Role]     │
│         [Suspect Meter]          │
├──────────────────────────────────┤
│  THINK Pane (admin only)         │
│  ─────────────────────────────── │
│  💭 "Internal reasoning..."      │
│     (streaming, monospace)       │
├──────────────────────────────────┤
│  SAYS Pane                       │
│  ─────────────────────────────── │
│  💬 "Public statement..."        │
│     (streaming, sans-serif)      │
├──────────────────────────────────┤
│  Actions Log                     │
│  ─────────────────────────────── │
│  • Voted for Charlie (Round 3)   │
│  • Protected Alice (Night 2)     │
└──────────────────────────────────┘
```

**Visual States:**
- **Alive:** Full color, active borders
- **Dead:** Grayed out, faded opacity (0.5)
- **Speaking:** Pulsing border (`border-color: $say`) + subtle glow
- **Active Turn:** Scale transform (1.02) + shadow
- **High Suspicion:** Red tint overlay when score > 70

**Streaming Animation:**
```css
@keyframes streamingCursor {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.streaming-cursor::after {
  content: "▎";
  color: var(--color-think);
  animation: streamingCursor 1s infinite;
}
```

**Performance Optimizations:**
- Memoize with `React.memo()` and custom comparison
- Only re-render when relevant props change
- Use CSS transforms instead of layout changes for animations
- Virtualize text content for long streams (show last 500 chars)

---

### 2. AgentGrid Component

**File:** `web/src/components/AgentGrid.tsx`

**Props:**
```typescript
interface AgentGridProps {
  players: Player[];
  thinkStreams: Map<string, string[]>;  // playerId -> think chunks
  sayStreams: Map<string, string[]>;    // playerId -> say chunks
  suspectScores: Map<string, number>;
  viewMode: 'admin' | 'town' | 'postmortem';
  activePlayerId: string | null;
  currentPhase: Phase;
}
```

**Layout:**
```css
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
  padding: 1rem;
}

@media (max-width: 768px) {
  .agent-grid {
    grid-template-columns: 1fr;  /* Single column on mobile */
    scroll-snap-type: x mandatory;
    overflow-x: scroll;
  }
}
```

**Features:**
- **Drag-to-reorder:** Players can rearrange cards (persists locally)
- **Filter:** Hide dead players (`showDead: boolean`)
- **Sort:** By suspicion, alphabetical, or custom order
- **Zoom:** Small / Medium / Large card sizes

**Virtualization:**
- Render only visible cards + 2 buffer rows
- Use `react-window` or similar for large player counts (>20)
- Maintain scroll position during updates

---

### 3. GameFeed Component

**File:** `web/src/components/GameFeed.tsx`

**Props:**
```typescript
interface GameFeedProps {
  events: Event[];
  viewMode: 'admin' | 'town' | 'postmortem';
  maxEvents?: number;  // Default: 1000
  autoScroll?: boolean; // Default: true
}
```

**Features:**
- **Real-time streaming:** New events append to bottom
- **Auto-scroll:** Sticks to bottom unless user scrolls up
- **Event filtering:** Hide private events in town mode
- **Event grouping:** Collapse similar consecutive events
- **Search:** Filter events by player or type
- **Timestamp:** Relative time ("2s ago", "1m ago")

**Event Types & Icons:**
```typescript
const EVENT_ICONS = {
  'GAME_CREATED': '🎮',
  'PHASE_CHANGED': '🔄',
  'NIGHT_ACTION_SUBMITTED': '🔵',
  'NIGHT_RESOLVED': '🌅',
  'AGENT_THINK_CHUNK': '💭',
  'AGENT_SAY_CHUNK': '💬',
  'VOTE_CAST': '🗳️',
  'VOTE_RESULT': '📊',
  'PLAYER_ELIMINATED': '⚰️',
  'GAME_ENDED': '🏁',
};
```

**Layout:**
```
┌─────────────────────────┐
│  Search: [_________] 🔍 │
├─────────────────────────┤
│  [02:15:30] 🎮 Game     │
│             Created     │
│                         │
│  [02:15:35] 🌅 Night 1  │
│             Resolved    │
│             No deaths   │
│                         │
│  [02:15:42] 💬 Alice:   │
│             "I think    │
│             Bob is..."  │
│                         │
│  [02:15:50] 💭 Bob:     │
│             "They're    │
│             onto me..." │
└─────────────────────────┘
```

**Performance:**
- Use `react-virtualized` for event list
- Maintain 1000 event buffer, prune older events
- Batch DOM updates with `requestAnimationFrame`

---

### 4. PhaseHeader Component

**File:** `web/src/components/PhaseHeader.tsx`

**Props:**
```typescript
interface PhaseHeaderProps {
  phase: Phase;
  dayNumber: number;
  roundNumber: number;
  aliveCount: number;
  deadCount: number;
  winner: 'town' | 'mafia' | null;
  isPaused: boolean;
}
```

**Layout:**
```
┌──────────────────────────────────────────┐
│  PhaseBanner (dynamic color by phase)    │
│  ──────────────────────────────────────  │
│  🔴 NIGHT 2  [PAUSED]                    │
│  6 alive • 4 dead                        │
│                                          │
│  [Night count: 15s]  [Round: 8/30]       │
└──────────────────────────────────────────┘
```

**Phase Colors:**
```typescript
const PHASE_COLORS = {
  'NIGHT_ACTIONS': 'bg-red-900 text-red-100',
  'MORNING_REVEAL': 'bg-yellow-900 text-yellow-100',
  'DAY_DISCUSSION': 'bg-blue-900 text-blue-100',
  'DAY_VOTING': 'bg-purple-900 text-purple-100',
  'RESOLUTION': 'bg-gray-900 text-gray-100',
  'END': 'bg-green-900 text-green-100',
};
```

**Animations:**
- **Phase transitions:** 0.5s crossfade
- **Counter updates:** Number ticker animation
- **Paused state:** Pulse animation every 2s

---

### 5. Controls Component

**File:** `web/src/components/Controls.tsx`

**Props:**
```typescript
interface ControlsProps {
  gameStatus: 'running' | 'paused' | 'ended';
  onPause: () => void;
  onResume: () => void;
  onStep: () => void;
  onExport: () => void;
  speed: number;  // 0.5x, 1x, 2x, 5x
  onSpeedChange: (speed: number) => void;
  viewMode: 'admin' | 'town' | 'postmortem';
  onViewModeChange: (mode: 'admin' | 'town' | 'postmortem') => void;
}
```

**Layout:**
```
┌──────────────────────────────────────────┐
│  [⏸️ Pause] [▶️ Resume] [⏭️ Step]       │
│                                          │
│  Speed: [ 1x ▾]  [💾 Export]           │
│                                          │
│  View: [Admin ▾]  [Reveal Roles ☐]     │
└──────────────────────────────────────────┘
```

**Button States:**
- **Running:** Pause active, Resume disabled
- **Paused:** Resume active, Pause disabled
- **Ended:** All disabled, Export active

**Speed Control:**
```typescript
const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
  { label: 'Step', value: 0 },
];
```

**Effects:**
- Speed affects phase timeouts
- Step mode (0) requires manual Step clicks

---

### 6. SuspectMeter Component

**File:** `web/src/components/SuspectMeter.tsx`

**Props:**
```typescript
interface SuspectMeterProps {
  score: number;  // 0-100
  playerName: string;
  size?: 'small' | 'medium' | 'large';
  showLabels?: boolean;  // "Low/Moderate/High"
}
```

**Visual Design:**
```cssn
/* Horizontal bar */
.suspect-meter {
  width: 100%;
  height: 8px;
  background: linear-gradient(to right,
    #10b981 0%,    /* Green (0-25) */
    #f59e0b 50%,   /* Yellow (26-75) */
    #ef4444 100%    /* Red (76-100) */
  );
  border-radius: 4px;
  position: relative;
}

.suspect-meter::after {
  content: '';
  position: absolute;
  left: var(--score-percent);
  top: -2px;
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
}
```

**Labels:**
```typescript
const SUSPICION_LABELS = [
  { max: 25, label: 'Trustworthy', color: '#10b981' },
  { max: 50, label: 'Neutral', color: '#f59e0b' },
  { max: 75, label: 'Suspicious', color: '#f97316' },
  { max: 100, label: 'Very Suspicious', color: '#ef4444' },
];
```

**Animations:**
- Score changes trigger 0.3s smooth transition
- Pulse effect when score crosses 70 threshold

---

### 7. GameReplay Component

**File:** `web/src/components/GameReplay.tsx`

**Props:**
```typescript
interface GameReplayProps {
  events: Event[];
  initialState: GameState;
  onSeek: (sequence: number) => void;
}
```

**Features:**
- **Timeline scrubber:** Jump to any sequence
- **Event markers:** Key moments highlighted
- **Speed control:** Replay at different speeds
- **Step forward/back:** Navigate frame-by-frame

**Timeline Markers:**
```typescript
const TIMELINE_MARKERS = {
  'FIRST_KILL': { icon: '⚰️', color: '#ef4444' },
  'SHERIFF_CLAIM': { icon: '🛡️', color: '#d97706' },
  'MAFIA_ELIMINATED': { icon: '🔴', color: '#dc2626' },
  'GAME_END': { icon: '🏁', color: '#10b981' },
};
```

**Layout:**
```typescript
// Timeline component
const Timeline = ({ events, currentSeq, totalSeq }) => {
  const markers = getKeyMoments(events);
  
  return (
    <div className="timeline">
      <input
        type="range"
        min={0}
        max={totalSeq}
        value={currentSeq}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      {markers.map(marker => (
        <div
          key={marker.sequence}
          className="timeline-marker"
          style={{ left: `${(marker.sequence / totalSeq) * 100}%` }}
          title={marker.eventType}
        >
          {marker.icon}
        </div>
      ))}
    </div>
  );
};
```

---

## Mobile Layout (<768px)

**Agent Carousel:**
```css
.mobile-agent-view {
  display: flex;
  overflow-x: scroll;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}

.mobile-agent-card {
  min-width: 100vw;
  scroll-snap-align: start;
  padding: 1rem;
}
```

**Swipe Gestures:**
- Swipe left/right: Navigate agents
- Swipe up: Expand current agent to full screen
- Pinch: Zoom into specific stream (THINK or SAYS)

**Bottom Navigation:**
```
┌─────────────────┐
│                 │
│   Agent View    │
│                 │
├─────────────────┤
│ ◀️ Alice | Bob ▶️ │
├─────────────────┤
│ Feed | Controls │
└─────────────────┘
```

---

## WebSocket Integration

### Custom Hook: `useGameStream`
```typescript
// web/src/hooks/useGameStream.ts

export function useGameStream(gameId: string, viewMode: 'admin' | 'town' | 'postmortem') {
  const [events, setEvents] = useState<Event[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3000/ws/${gameId}?viewMode=${viewMode}`);
    
    ws.onopen = () => setConnectionStatus('connected');
    ws.onclose = () => setConnectionStatus('disconnected');
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'EVENT') {
        setEvents(prev => [...prev, message.event]);
        
        // Update game state
        if (message.event.eventType === 'PHASE_CHANGED' || 
            message.event.eventType === 'PLAYER_ELIMINATED') {
          setGameState(prev => applyEventToState(prev, message.event));
        }
      }
    };
    
    return () => ws.close();
  }, [gameId, viewMode]);
  
  return { events, gameState, connectionStatus };
}
```

### Event Buffering
```typescript
const MAX_EVENTS = 1000;
const EVENT_BUFFER_SIZE = 100;

function setEvents(prev => {
  const updated = [...prev, newEvent];
  
  // Keep last MAX_EVENTS
  if (updated.length > MAX_EVENTS + EVENT_BUFFER_SIZE) {
    return updated.slice(-MAX_EVENTS);
  }
  
  return updated;
});
```

---

## Performance Optimizations

### 1. Memoization Strategy
```typescript
// Component memoization
const AgentCard = React.memo(AgentCardComponent, (prev, next) => {
  return (
    prev.player.id === next.player.id &&
    prev.player.alive === next.player.alive &&
    prev.suspectScore === next.suspectScore &&
    prev.viewMode === next.viewMode &&
    prev.isActive === next.isActive
  );
});

// Custom hook with useMemo
function useAgentState(playerId: string) {
  const gameState = useContext(GameStateContext);
  
  return useMemo(() => {
    return gameState.players.find(p => p.id === playerId);
  }, [gameState, playerId]);
}
```

### 2. Text Streaming Virtualization
```typescript
const MAX_TEXT_LENGTH = 500;

function truncateStream(text: string) {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  
  // Show last MAX_TEXT_LENGTH characters
  return "..." + text.slice(-MAX_TEXT_LENGTH);
}
```

### 3. Render Batching
```typescript
import { unstable_batchedUpdates } from 'react-dom';

function handleBatchUpdate(events: Event[]) {
  unstable_batchedUpdates(() => {
    for (const event of events) {
      addEvent(event);
    }
  });
}
```

### 4. Web Worker for Heavy Calculations
```typescript
// suspect-meter.worker.ts
self.onmessage = (e) => {
  const { gameState, history, weights } = e.data;
  const scores = calculateSuspectMeter(gameState, history, weights);
  self.postMessage(scores);
};
```

---

## Accessibility

### ARIA Labels
```typescript
const AgentCard = ({ player, ...props }) => (
  <div
    role="article"
    aria-label={`${player.name}, ${player.role}, ${player.alive ? 'alive' : 'dead'}`}
  >
    {/* ... */}
  </div>
);
```

### Keyboard Navigation
- `Tab`: Navigate between agent cards
- `Enter`: Expand/collapse card
- `Space`: If speaking, focus on SAY stream
- `Arrow keys`: Navigate feed (up/down)

### Screen Reader Support
- Role announcements: "Bob, Mafia, dead, eliminated round 3"
- Suspicion level: "Suspicion 78 percent"
- Event descriptions: "Alice says, quote, I think Bob is suspicious, end quote"