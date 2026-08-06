# Admin Dashboard Specification

## Overview

The Admin Dashboard is the operator-facing control center for managing all Mafia AI Benchmark games, monitoring system health, tracking LLM costs, and debugging agent behavior. It builds on the existing web app architecture (`apps/web/`) and follows the dark cyberpunk design system defined in `ui-components.md`. Access is gated by the `ADMIN_TOKEN` authorization model defined in `permission-model.md`.

## Access Control

```
Endpoint: /admin (and /admin/*)
Authorization: Bearer <ADMIN_TOKEN> in HTTP header or ?authToken=<ADMIN_TOKEN> in WebSocket
View Mode: Always 'admin' — full visibility per permission-model.md Section 1

Redirect: Unauthenticated requests → /login or return 403
```

Admin users see:
- ✅ All games regardless of status
- ✅ True roles for all players (no redaction)
- ✅ Full THINK streams alongside SAYS streams
- ✅ Private investigation results and night action targets
- ✅ Mafia team coordination events
- ✅ Cost and system metrics (admin-only data)

---

## Layout

### Desktop Layout (>1024px)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Top Bar: System Health | Connection Status | Admin User            │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  Sidebar Nav │  Content Area                                        │
│              │                                                      │
│  ┌──────────┐│  ┌─────────────────────────────────────────────┐   │
│  │ Dashboard ││  │  Game List / Live Viewer / Config            │   │
│  │ Games     ││  │                                             │   │
│  │ Live View ││  │                                             │   │
│  │ Costs     ││  │                                             │   │
│  │ System    ││  │                                             │   │
│  │ Logs      ││  │                                             │   │
│  │ Config    ││  │                                             │   │
│  │──────────││  │                                             │   │
│  │ Active: N ││  │                                             │   │
│  │ CPU: 45%  ││  └─────────────────────────────────────────────┘   │
│  │ Mem: 62%  ││                                                      │
│  └──────────┘│                                                      │
│              │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

### Tablet Layout (768-1024px)

```
┌───────────────────────────────────────┐
│  Top Bar (condensed)                  │
├───────────────────────────────────────┤
│  Sidebar (collapsible, overlay)       │
├───────────────────────────────────────┤
│                                       │
│  Content Area (full width)            │
│                                       │
│  Game List → Live Viewer (stacked)    │
│                                       │
└───────────────────────────────────────┘
```

---

## Section 1: Sidebar Navigation

**Component:** `AdminSidebar`  
**File:** `web/src/components/admin/AdminSidebar.tsx`

### Structure

```typescript
interface AdminSidebarProps {
  activeSection: AdminSection;
  onNavigate: (section: AdminSection) => void;
  systemHealth: SystemHealth | null;
  collapsed: boolean;
  onToggle: () => void;
}

type AdminSection = 
  | 'dashboard'    // Overview / summary
  | 'games'        // All games list
  | 'live'         // Live game viewer (per-game)
  | 'costs'        // Cost tracking
  | 'system'       // System health detail
  | 'logs'         // Server logs viewer
  | 'config';      // Configuration management
```

### Nav Items

```typescript
const ADMIN_NAV_ITEMS = [
  { section: 'dashboard', label: '📊 Dashboard', icon: 'dashboard' },
  { section: 'games',     label: '🎮 Games',     icon: 'gamepad',    badge: 'count' },
  { section: 'live',      label: '📺 Live View', icon: 'eye',        badge: 'active' },
  { section: 'costs',     label: '💰 Cost Tracker', icon: 'dollar' },
  { section: 'system',    label: '🖥️ System',   icon: 'cpu' },
  { section: 'logs',      label: '📜 Logs',     icon: 'file-text' },
  { section: 'config',    label: '⚙️ Config',   icon: 'settings' },
];
```

### System Health Mini-Display

At the bottom of the sidebar, always visible:

```
┌──────────────────┐
│  SYSTEM           │
│  ──────────────── │
│  CPU    ████░░ 45%│
│  MEM    █████░ 62%│
│  Active ██░░░░  3 │
│  Uptime  4d 2h    │
│                   │
│  • Connected ●     │
└──────────────────┘
```

```typescript
interface SystemHealth {
  cpuPercent: number;        // 0-100
  memoryPercent: number;     // 0-100
  activeGames: number;
  totalGames: number;
  uptimeSeconds: number;
  connectionCount: number;
  errorRate: number;         // errors per minute
}
```

### Visual Design

- Background: `#111113` (surface)
- Active item: `#1a1a1d` with left border accent `#06b6d4` (cyan)
- Hover: `#1a1a1d`
- Text: `#94a3b8` (textSecondary), active: `#f8fafc` (textPrimary)
- Badge: Small pill with background `#dc2626` (red for active count), `#64748b` for total count
- Collapse button: Chevron icon, toggles between icon-only and full-width
- Font: `JetBrains Mono` for system stats, `Inter` for nav labels

### Integration with Existing Layout

Reuses the existing `Sidebar` toggle pattern from `apps/web/src/components/Sidebar.tsx`. When admin is active, replaces the standard sidebar with `AdminSidebar` via the `useUIStore.sidebarOpen` mechanism.

---

## Section 2: Game List (All Games View)

**Component:** `AdminGameList`  
**File:** `web/src/components/admin/AdminGameList.tsx`

### Overview

Extends the existing `GameList` component with admin-only visibility and controls. Shows ALL games regardless of status — active, paused, completed, and failed.

### Props

```typescript
interface AdminGameListProps {
  games: AdminGameSummary[];
  onSelectGame: (gameId: string) => void;
  onStopGame: (gameId: string) => void;
  onPauseGame: (gameId: string) => void;
  onResumeGame: (gameId: string) => void;
  onCreateGame: () => void;
}

interface AdminGameSummary {
  id: string;
  status: 'SETUP' | 'IN_PROGRESS' | 'PAUSED' | 'ENDED' | 'ERROR';
  phase: Phase | null;
  dayNumber: number;
  playerCount: number;
  aliveCount: number;
  mafiaCount: number;
  winner: 'town' | 'mafia' | null;
  createdAt: string;
  duration: number;          // seconds elapsed
  eventCount: number;        // total events
  llmCost: number;          // estimated cost in USD
  viewMode: 'admin';        // always admin for this view
}
```

### Status Badges

Building on the existing `getStatusColor` pattern in `GameList.tsx`:

```typescript
const ADMIN_STATUS_BADGES = {
  'SETUP':        { color: 'blue',    bg: 'bg-blue-900/30',   label: 'SETUP' },
  'IN_PROGRESS':  { color: 'green',   bg: 'bg-green-900/30',  label: '● LIVE' },
  'PAUSED':       { color: 'amber',   bg: 'bg-amber-900/30',  label: '⏸ PAUSED' },
  'ENDED':        { color: 'gray',    bg: 'bg-gray-900/30',   label: 'ENDED' },
  'ERROR':        { color: 'red',     bg: 'bg-red-900/30',    label: '⚠ ERROR' },
};
```

### Game Card Layout (Admin View)

```
┌─────────────────────────────────────────────────────┐
│  ● LIVE                              game-a1b2c3d4  │
│                                                     │
│  DAY 3 · NIGHT_ACTIONS                              │
│                                                     │
│  Players: 6/10 alive  │  Mafia: 2/3 remaining       │
│  Events: 847          │  Cost: $0.042               │
│  Runtime: 12m 34s                                   │
│                                                     │
│  [⏸ Pause] [⏹ Stop] [👀 Watch Live] [📊 View]     │
└─────────────────────────────────────────────────────┘
```

### Filtering & Sorting

```typescript
interface GameFilters {
  status: ('SETUP' | 'IN_PROGRESS' | 'PAUSED' | 'ENDED' | 'ERROR')[];
  search: string;                  // Filter by game ID or player name
  sortBy: 'created' | 'duration' | 'events' | 'cost' | 'players';
  sortDirection: 'asc' | 'desc';
  dateRange?: { start: Date; end: Date };
}
```

### Bulk Actions

- **Stop All:** Stops all running games (with confirmation modal)
- **Purge Completed:** Deletes ENDED games older than N days
- **Export All:** Downloads JSONL for all selected games

---

## Section 3: Live Game Viewer (Split-Pane THINK/SAYS)

**Component:** `LiveGameViewer`  
**File:** `web/src/components/admin/LiveGameViewer.tsx`

### Overview

The centerpiece of the admin dashboard. Displays a live game with a split-pane layout showing THINK (private reasoning, purple) and SAYS (public statements, cyan) side by side, matching the "split-pane consciousness" pattern from `split-pane-consciousness.md` and the `AgentCard` design from `ui-components.md`.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Game: a1b2c3d4  │  ● LIVE  │  Day 3  │  NIGHT_ACTIONS       │
├─────────────────────────────┬────────────────────────────────┤
│  💭 THINK (Private)         │  💬 SAYS (Public)               │
│  ────────────────────────   │  ───────────────────────────── │
│                             │                                 │
│  [p1 Alice - Mafia]         │  [p1 Alice - Mafia]             │
│  "I need to deflect         │  "I think Bob has been acting   │
│   suspicion from Bob.       │   very suspiciously today."     │
│   If I accuse Charlie,      │                                 │
│   they'll split the vote."  │                                 │
│                             │                                 │
│  ────────────────────────   │  ───────────────────────────── │
│                             │                                 │
│  [p3 Charlie - Sheriff]     │  [p3 Charlie - Sheriff]         │
│  "I investigated Alice      │  "As sheriff, I can confirm     │
│   last night — she's MAFIA. │   Alice is NOT town."           │
│   Need to reveal carefully  │                                 │
│   so they don't kill me."   │                                 │
│                             │                                 │
└─────────────────────────────┴────────────────────────────────┘
```

### Props

```typescript
interface LiveGameViewerProps {
  gameId: string;
  viewMode: 'admin';          // Always admin in this component
  autoScrollThink: boolean;   // Default: true
  autoScrollSay: boolean;     // Default: true
  compactMode: boolean;       // For tablet layout
}
```

### Think Column

- **Title:** `💭 THINK (Private)` in `#8b5cf6` (purple, from theme.think)
- **Background:** `#0a0a0b` with subtle purple border-left
- **Font:** `JetBrains Mono` (monospace)
- **Streaming:** Chunks append with blinking cursor `▎` animation (from `ui-components.md` Section 1, streaming animation)
- **Player header:** `[playerId Name - Role]` with role color
- **Role colors:** mafia=#dc2626, town=#2563eb, doctor=#059669, sheriff=#d97706
- **Empty state:** "No THINK activity yet" in muted text

### Say Column

- **Title:** `💬 SAYS (Public)` in `#06b6d4` (cyan, from theme.say)
- **Background:** `#0a0a0b` with subtle cyan border-left
- **Font:** `Inter` (sans-serif)
- **Streaming:** Same cursor animation but cyan
- **Player header:** Same as THINK column

### Event Rendering

```typescript
// Both columns share a common streaming event handler
function handleThinkChunk(event: AgentThinkChunkEvent) {
  // Payload: { agentId, agentName, role, chunk, turnId }
  addToStreamColumn('think', event.payload);
}

function handleSayChunk(event: AgentSayChunkEvent) {
  // Payload: { agentId, agentName, role, chunk, turnId }
  addToStreamColumn('say', event.payload);
}
```

Events are grouped by `turnId`. An empty `chunk` signals end-of-turn. The stream column displays:
1. Name badge for each player utterance
2. Accumulated text for the current turn
3. Visual separation between turns

### Performance

- Virtualize stream content using `react-virtualized` for games with 1000+ events
- Maintain 500-event buffer per column, prune older
- Batch DOM updates with `requestAnimationFrame`
- Use `React.memo` on stream entries to prevent re-renders

---

## Section 4: WebSocket Connection & Status Indicator

### Connection Management

Building on the `useGameStream` hook pattern from `ui-components.md` Section "WebSocket Integration" and the streaming protocol from `streaming-protocol.md`.

**Component:** `AdminWebSocketProvider`  
**File:** `web/src/components/admin/AdminWebSocketProvider.tsx`

```typescript
interface AdminWebSocketState {
  status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  latency: number;              // ms (from PONG roundTripMs)
  lastSequence: number;
  reconnectAttempt: number;
  missedEvents: number;         // count since last connect
}
```

### Connection Status Indicator

Rendered in the top bar, always visible:

```
┌──────────────────┐
│ ● Connected  12ms │  // Green dot + latency
│ ◌ Connecting ...  │  // Yellow dot + text (during connect)
│ ◉ Reconnecting... │  // Amber dot + text + attempt count
│ ○ Disconnected    │  // Red dot + text (after max retries)
└──────────────────┘
```

### Implementation

```typescript
// Use existing useGameStream hook, extended for admin
function useAdminStream(gameId: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [latency, setLatency] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!gameId) return;

    const token = getAdminToken();
    const ws = new WebSocket(
      `ws://localhost:3004/ws/${gameId}?viewMode=admin&authToken=${token}`
    );

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({
        type: 'SUBSCRIBE',
        gameId,
        viewMode: 'admin',
        authToken: token,
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'PONG') {
        setLatency(msg.roundTripMs);
      }
      // ... handle EVENT, SUBSCRIBED, HEARTBEAT, ERROR
    };

    ws.onclose = () => {
      setStatus('disconnected');
      // Auto-reconnect with exponential backoff per streaming-protocol.md
    };

    // Send PING every 15s
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      }
    }, 15000);

    wsRef.current = ws;
    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, [gameId]);

  return { status, latency };
}
```

### Reconnection Strategy

Following the pattern from `streaming-protocol.md`:
1. On disconnect, show "Reconnecting (attempt 1/5)..."
2. Exponential backoff: 1s → 2s → 4s → 8s → 16s
3. Re-subscribe with `lastSeq` to catch missed events
4. After 5 failures, show "Disconnected" with manual "Reconnect" button
5. Buffer events during disconnect via `missedEvents` mechanism

---

## Section 5: Operator Controls

### 5.1 Create Game

**Component:** `CreateGameModal` (extends existing modal from `GameList.tsx`)

Additional admin-only fields:

```typescript
interface AdminGameConfig {
  numPlayers: number;           // 5-20
  numMafia: number;            // 1-5 (auto-calculated if not set)
  includeDoctor: boolean;      // default: true
  includeSheriff: boolean;     // default: true
  nightDuration: number;       // seconds, 30-300
  dayDuration: number;         // seconds, 60-600
  votingDuration: number;      // seconds, 10-120
  maxRounds: number;           // default: 30
  mode: 'llm';                 // LLM mode only for now
  personaMode: 'auto' | 'custom';
  playerSeeds?: string[];      // Custom personas
  // Advanced
  modelName?: string;          // Override default LLM model
  thinkingBudget?: number;     // Token budget for THINK
}
```

**Modal layout** matches the existing `GameList.tsx` create-game modal, extended with collapsible "Advanced Settings" section.

### 5.2 Stop / Pause / Resume Game

**Component:** `GameControls`  
**File:** `web/src/components/admin/GameControls.tsx`

```typescript
interface GameControlsProps {
  gameId: string;
  gameStatus: 'SETUP' | 'IN_PROGRESS' | 'PAUSED' | 'ENDED' | 'ERROR';
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  onStep: () => Promise<void>;
  isActionPending: boolean;
}

// REST calls (admin-authenticated):
// POST /api/games/:id/pause    → Pause game
// POST /api/games/:id/resume   → Resume game
// POST /api/games/:id/stop     → Force-stop game
// POST /api/games/:id/step     → Advance one step
```

**Button States:**

| Game Status | Pause | Resume | Step | Stop |
|-------------|-------|--------|------|------|
| SETUP       | ❌    | ❌     | ❌   | ✅   |
| IN_PROGRESS | ✅    | ❌     | ✅   | ✅   |
| PAUSED      | ❌    | ✅     | ✅   | ✅   |
| ENDED       | ❌    | ❌     | ❌   | ❌   |
| ERROR       | ❌    | ❌     | ❌   | ✅   |

**Confirmation:** Stop requires confirmation modal: "This will permanently end the game. Players will be disconnected. Continue?"

### 5.3 View Logs

**Component:** `LogViewer`  
**File:** `web/src/components/admin/LogViewer.tsx`

```
┌──────────────────────────────────────────────────────┐
│  📜 Server Logs                        [Auto-scroll]  │
│  ──────────────────────────────────────────────────── │
│  Filter: [ERROR ▾] [Game: a1b2 ▾] [Search...    🔍] │
│  ──────────────────────────────────────────────────── │
│  14:32:01 [INFO]  Game a1b2c3d4: DAY_DISCUSSION      │
│  14:32:05 [INFO]  Game a1b2c3d4: Agent p1 submitted   │
│  14:32:10 [WARN]  LLM timeout for p3, retrying...     │
│  14:32:15 [ERROR] Failed to get response from model   │
│  14:32:20 [INFO]  Game a1b2c3d4: VOTE_CAST p1→p4      │
│  ──────────────────────────────────────────────────── │
│  Level: [INFO] [WARN] [ERROR] [DEBUG]  Lines: 1,247   │
└──────────────────────────────────────────────────────┘
```

**Features:**
- Severity filter (INFO/WARN/ERROR/DEBUG)
- Game-scoped filtering
- Full-text search
- Auto-scroll toggle
- Line count display
- Export logs as .txt

**Data source:** Server exposes `GET /api/admin/logs?level=ERROR&gameId=a1b2&search=timeout&limit=500&offset=0`

### 5.4 Manage Configurations

**Component:** `ConfigManager`  
**File:** `web/src/components/admin/ConfigManager.tsx`

```typescript
interface AdminConfig {
  // LLM Configuration
  llmProvider: 'openai' | 'anthropic' | 'groq' | 'custom';
  llmModel: string;
  llmApiKey: string;           // Masked in UI
  llmBaseUrl?: string;         // For custom providers
  thinkingBudget: number;      // Default THINK token budget
  
  // Game Defaults
  defaultPlayers: number;
  defaultMafia: number;
  defaultNightDuration: number;
  defaultDayDuration: number;
  defaultVotingDuration: number;
  
  // Rate Limits
  maxConcurrentGames: number;
  maxRequestsPerMinute: number;
  
  // Persistence
  autoSaveInterval: number;    // seconds
  maxReplayAge: number;        // days before cleanup
  
  // UI
  refreshInterval: number;     // ms for polling fallback
}
```

**Layout:** Tabbed or accordion sections:
1. LLM Configuration
2. Game Defaults
3. Rate Limits
4. Persistence Settings

**Save mechanism:** `PUT /api/admin/config` with admin token. Validate on server side.

---

## Section 6: Cost Tracking Dashboard

**Component:** `CostTracker`  
**File:** `web/src/components/admin/CostTracker.tsx`

### Overview

Tracks LLM API costs across all games. Displays cumulative and per-game cost breakdowns.

### Layout

```
┌──────────────────────────────────────────────────────┐
│  💰 Cost Tracking                                     │
│  ──────────────────────────────────────────────────── │
│                                                       │
│  ┌──────────────┬──────────────┬──────────────┐      │
│  │ Today        │ This Week    │ All Time      │      │
│  │ $0.87        │ $12.43       │ $89.21        │      │
│  │ 3 games      │ 17 games     │ 142 games     │      │
│  └──────────────┴──────────────┴──────────────┘      │
│                                                       │
│  Per-Game Breakdown:                                  │
│  ──────────────────────────────────────────────────── │
│  Game a1b2  │ $0.042 │ 847 tokens │ 12m │ Ended     │
│  Game c3d4  │ $0.018 │ 412 tokens │ 4m  │ Running   │
│  Game e5f6  │ $0.105 │ 2103 token │ 45m │ Paused    │
│  ...                                                  │
│                                                       │
│  Cost by Model:                                       │
│  ──────────────────────────────────────────────────── │
│  gpt-4o       ████████████░░░░░░  $56.32 (63%)       │
│  claude-3.5   ██████░░░░░░░░░░░░  $32.89 (37%)       │
└──────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface CostSummary {
  today: number;
  thisWeek: number;
  allTime: number;
  byModel: Record<string, { cost: number; tokenCount: number }>;
  byGame: GameCostBreakdown[];
}

interface GameCostBreakdown {
  gameId: string;
  totalCost: number;
  tokenCount: number;
  thinkTokens: number;
  sayTokens: number;
  requestCount: number;
  duration: number;       // seconds
  status: string;
}
```

### API

```
GET /api/admin/costs?period=today|week|all&gameId=<optional>
```

---

## Section 7: System Health Dashboard

**Component:** `SystemHealthPanel`  
**File:** `web/src/components/admin/SystemHealthPanel.tsx`

### Overview

Real-time system metrics for the server. Uses polling fallback when WebSocket is unavailable.

### Layout

```
┌──────────────────────────────────────────────────────┐
│  🖥️ System Health                                     │
│  ──────────────────────────────────────────────────── │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ CPU      │ │ Memory   │ │ Active   │ │ Uptime   │ │
│  │          │ │          │ │ Games    │ │          │ │
│  │  45%     │ │  62%     │ │   3      │ │ 4d 2h    │ │
│  │ ████░░   │ │ █████░   │ │ ●●●○○    │ │          │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ CPU History (last 5 min)                         │ │
│  │ ▁▂▃▅▆▇█▇▆▅▄▃▂▁▂▃▄▅▆▇█▇▆▅▄▃▂  [sparkline]    │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Memory Usage                                     │ │
│  │ ████████████████░░░░░░  2.1 GB / 4.0 GB (62%)   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ WS Conn  │ │ Errors   │ │ Avg Lat  │             │
│  │   12     │ │ 0.3/min  │ │  23ms    │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│                                                       │
│  Game Activity:                                       │
│  ──────────────────────────────────────────────────── │
│  a1b2 ● RUNNING  Day 3  Night   6/10 alive          │
│  c3d4 ⏸ PAUSED   Day 1  Setup  10/10 alive          │
│  e5f6 ● RUNNING  Day 5  Vote    3/10 alive           │
└──────────────────────────────────────────────────────┘
```

### Data Source

```
GET /api/admin/health
→ {
    cpuPercent: 45,
    memoryPercent: 62,
    memoryUsedMB: 2100,
    memoryTotalMB: 4096,
    activeGames: 3,
    totalGames: 142,
    uptimeSeconds: 345600,
    connectionCount: 12,
    errorRate: 0.3,
    avgLatencyMs: 23,
    cpuHistory: [10, 15, 20, 25, 30, 35, 40, 42, 45, ...],  // last 60 data points
    activeGameDetails: [
      { gameId: 'a1b2', status: 'RUNNING', phase: 'NIGHT_ACTIONS', dayNumber: 3, aliveCount: 6, totalPlayers: 10 },
      ...
    ]
  }
```

### Update Frequency
- WebSocket: Receive `HEARTBEAT` messages every 30s with system metrics embedded
- REST polling fallback: Every 5 seconds when WebSocket disconnected
- Sparkline: Latest 60 data points (5 minutes at 5s granularity)

---

## Section 8: Dark Cyberpunk Theme

All components follow the existing design system from `ui-components.md` Section "Design System".

### Color Tokens

```css
:root {
  /* Base — from existing theme */
  --bg-primary: #0a0a0b;
  --bg-surface: #111113;
  --bg-surface-hover: #1a1a1d;
  --bg-surface-active: #1e1e22;
  
  /* Admin-specific surfaces */
  --bg-admin-panel: #0d0d10;         /* Slightly differentiated from general surface */
  --bg-admin-header: #08080a;        /* Top bar */
  --bg-admin-sidebar: #0c0c0f;       /* Sidebar */
  
  /* Accents */
  --accent-think: #8b5cf6;           /* Purple — THINK */
  --accent-say: #06b6d4;             /* Cyan — SAYS */
  --accent-system: #10b981;          /* Green — healthy */
  --accent-warning: #f59e0b;         /* Amber — caution */
  --accent-danger: #ef4444;          /* Red — error */
  --accent-info: #3b82f6;            /* Blue — info */
  
  /* Text */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  
  /* Borders */
  --border-default: #1e1e24;
  --border-think: #8b5cf644;         /* Purple with alpha */
  --border-say: #06b6d444;           /* Cyan with alpha */
  
  /* Status dots */
  --status-connected: #10b981;
  --status-connecting: #f59e0b;
  --status-disconnected: #ef4444;
  
  /* Typography */
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

### Component-Level Styling

Each admin component uses CSS modules or Tailwind classes:

```typescript
// Admin sidebar
className="bg-[#0c0c0f] border-r border-[#1e1e24]"

// Status badge
className="px-2 py-0.5 rounded text-xs font-mono"
// LIVE: bg-green-900/30 text-green-400 border border-green-800/50
// ENDED: bg-gray-900/30 text-gray-400 border border-gray-800/50

// THINK column
className="border-l-2 border-[#8b5cf644] bg-[#0a0a0b]"

// SAYS column
className="border-l-2 border-[#06b6d444] bg-[#0a0a0b]"

// Connection dot
className="w-2 h-2 rounded-full"
// connected: bg-[#10b981]
// connecting: bg-[#f59e0b] animate-pulse
// disconnected: bg-[#ef4444]
```

### Font Usage

- **Headings:** `Inter`, weight 600, `#f8fafc`
- **Body text:** `Inter`, weight 400, `#f8fafc`
- **Code/streams:** `JetBrains Mono`, weight 400, line-height 1.6
- **System stats:** `JetBrains Mono`, weight 500, `#06b6d4` (accent)
- **Labels/badges:** `Inter`, weight 500, uppercase tracking-wide

---

## Section 9: Responsive Design

### Desktop (>1024px)

- Full sidebar navigation visible
- Game list: 2-3 column grid
- Live viewer: side-by-side THINK/SAYS columns
- System health: 4-column stat grid
- Cost tracker: 3-column summary + table

### Tablet (768-1024px)

- Sidebar: collapsible overlay (hamburger toggle)
- Game list: 1-2 column grid
- Live viewer: Stacked THINK/SAYS (toggle between views)
  - Tab strip: `[💭 THINK] [💬 SAYS] [Both]`
  - "Both" mode: vertical split, adjustable divider
- System health: 2-column stat grid
- Modals: Full-screen on tablet

### CSS Breakpoints

```css
/* Tablet sidebar collapse */
@media (max-width: 1024px) {
  .admin-sidebar {
    position: fixed;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }
  
  .admin-sidebar.open {
    transform: translateX(0);
  }
  
  .admin-sidebar-overlay {
    display: block;  /* Dim background when sidebar is open */
  }
}

/* Tablet live viewer */
@media (max-width: 1024px) {
  .live-viewer-columns {
    flex-direction: column;
  }
  
  .live-viewer-tabs {
    display: flex;
  }
}

/* Mobile (<768px) uses existing mobile patterns from ui-components.md */
```

### Touch Targets

All interactive elements meet minimum 44×44px touch targets on tablet:
- Sidebar nav items: min-height 48px
- Buttons: min-height 44px, min-width 44px
- Game cards: full-width tap targets

---

## Section 10: Component Tree & File Structure

```
apps/web/src/
├── components/
│   ├── admin/
│   │   ├── AdminSidebar.tsx           # Sidebar navigation
│   │   ├── AdminTopBar.tsx            # Top bar with health + connection
│   │   ├── AdminGameList.tsx          # All games list view
│   │   ├── AdminGameCard.tsx          # Individual game card (admin)
│   │   ├── LiveGameViewer.tsx         # Split-pane THINK/SAYS viewer
│   │   ├── ThinkColumn.tsx            # THINK stream column
│   │   ├── SayColumn.tsx              # SAYS stream column
│   │   ├── GameControls.tsx           # Pause/Resume/Stop/Step buttons
│   │   ├── CreateGameModal.tsx        # Extended create-game modal
│   │   ├── CostTracker.tsx            # Cost dashboard
│   │   ├── SystemHealthPanel.tsx      # System health metrics
│   │   ├── LogViewer.tsx              # Server log viewer
│   │   ├── ConfigManager.tsx          # Configuration management
│   │   ├── ConnectionIndicator.tsx    # WebSocket status dot + latency
│   │   └── StatusBadge.tsx            # Reusable status badge
│   ├── AdminDashboard.tsx             # Root admin layout + routing
│   ├── GameBoard.tsx                  # (Existing) Game board
│   ├── GameWatcher.tsx                # (Existing) Game watcher
│   └── ...                            # Existing components
├── hooks/
│   ├── useAdminStream.ts              # Admin WebSocket hook
│   ├── useSystemHealth.ts             # System metrics hook
│   ├── useCostTracking.ts             # Cost data hook
│   └── useGameStream.ts               # (Existing) Game stream hook
├── stores/
│   ├── adminStore.ts                  # Admin-specific state
│   ├── gameStore.ts                   # (Existing) Game state
│   └── uiStore.ts                     # (Existing) UI state
└── App.tsx                            # Root app (add /admin/* routes)
```

### Routing

```typescript
// In App.tsx, add admin routes protected by AuthGuard:

<Route path="/admin" element={<AuthGuard requireAdmin={true} />}>
  <Route index element={<AdminDashboard section="dashboard" />} />
  <Route path="games" element={<AdminDashboard section="games" />} />
  <Route path="live/:gameId" element={<AdminDashboard section="live" />} />
  <Route path="costs" element={<AdminDashboard section="costs" />} />
  <Route path="system" element={<AdminDashboard section="system" />} />
  <Route path="logs" element={<AdminDashboard section="logs" />} />
  <Route path="config" element={<AdminDashboard section="config" />} />
</Route>
```

### AuthGuard

```typescript
// web/src/components/admin/AuthGuard.tsx
function AuthGuard({ requireAdmin, children }: AuthGuardProps) {
  const location = useLocation();
  const hasAdminToken = Boolean(localStorage.getItem('ADMIN_TOKEN') || sessionStorage.getItem('ADMIN_TOKEN'));
  
  if (requireAdmin && !hasAdminToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  return <>{children}</>;
}
```

---

## Section 11: Data Flow

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  Server     │◄──────────────────►│  AdminDashboard   │
│  ┌────────┐ │                    │  ┌──────────────┐ │
│  │ Game   │ │   EVENTS           │  │ LiveViewer   │ │
│  │ Engine │ ├───────────────────►│  │ (THINK/SAYS) │ │
│  └────────┘ │                    │  └──────────────┘ │
│  ┌────────┐ │   HEARTBEAT        │  ┌──────────────┐ │
│  │ Health │ ├───────────────────►│  │ HealthPanel  │ │
│  │ Monitor│ │                    │  └──────────────┘ │
│  └────────┘ │                    │  ┌──────────────┐ │
│             │                    │  │ CostTracker  │ │
│             │                    │  └──────────────┘ │
│             │     REST API       │  ┌──────────────┐ │
│             │◄──────────────────┤  │ GameControls │ │
│             │  POST pause/stop   │  └──────────────┘ │
│             │                    │  ┌──────────────┐ │
│             │  GET logs/config   │  │ LogViewer /  │ │
│             │◄──────────────────┤  │ ConfigManager│ │
└─────────────┘                    └──┴──────────────┴─┘
```

- **Real-time data:** WebSocket (EVENT, HEARTBEAT, PONG messages)
- **Control operations:** REST (POST /api/games/:id/stop, etc.)
- **Static data:** REST on mount (GET /api/admin/games, GET /api/admin/costs, GET /api/admin/health, GET /api/admin/logs, GET /api/admin/config)
- **Admin store:** Zustand store (`adminStore.ts`) caches system health, cost data, and admin game list, updated via WebSocket + periodic REST refetch

---

## Section 12: State Management (adminStore)

```typescript
// web/src/stores/adminStore.ts
import { create } from 'zustand';

interface AdminStore {
  // Connection
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  connectionLatency: number;
  setConnectionStatus: (status: AdminStore['connectionStatus']) => void;
  setConnectionLatency: (ms: number) => void;
  
  // Games
  allGames: AdminGameSummary[];
  setAllGames: (games: AdminGameSummary[]) => void;
  updateGame: (gameId: string, update: Partial<AdminGameSummary>) => void;
  
  // System health
  systemHealth: SystemHealth | null;
  setSystemHealth: (health: SystemHealth) => void;
  
  // Cost tracking
  costSummary: CostSummary | null;
  setCostSummary: (summary: CostSummary) => void;
  
  // Live game state
  activeViewerGameId: string | null;
  thinkStreams: Map<string, ThinkEntry[]>;    // playerId → entries
  sayStreams: Map<string, SayEntry[]>;         // playerId → entries
  addThinkChunk: (playerId: string, chunk: ThinkEntry) => void;
  addSayChunk: (playerId: string, chunk: SayEntry) => void;
  clearStreams: (playerId: string) => void;
  
  // Logs
  logEntries: LogEntry[];
  appendLogs: (logs: LogEntry[]) => void;
  clearLogs: () => void;
  
  // Config
  adminConfig: AdminConfig | null;
  setAdminConfig: (config: AdminConfig) => void;
  
  // Actions
  fetchAllGames: () => Promise<void>;
  fetchSystemHealth: () => Promise<void>;
  fetchCostSummary: () => Promise<void>;
  fetchLogs: (filters: LogFilters) => Promise<void>;
  fetchConfig: () => Promise<void>;
  saveConfig: (config: Partial<AdminConfig>) => Promise<void>;
  stopGame: (gameId: string) => Promise<void>;
  pauseGame: (gameId: string) => Promise<void>;
  resumeGame: (gameId: string) => Promise<void>;
  stepGame: (gameId: string) => Promise<void>;
}
```

---

## Section 13: Testing Considerations

### Unit Tests

- `AdminSidebar`: Renders all nav items, active state, collapse toggle
- `StatusBadge`: Renders correct colors and labels for each status
- `ConnectionIndicator`: Shows correct dot color and text for each state
- `ThinkColumn`/`SayColumn`: Properly accumulates streaming chunks, handles empty chunk as end-of-turn

### Integration Tests

- `AdminDashboard`: Renders with admin token, redirects without
- `LiveGameViewer`: Receives WebSocket events and updates THINK/SAYS columns
- `GameControls`: Pause/Resume/Stop/Step buttons call correct API endpoints
- `CostTracker`: Renders cost data from API, updates on refresh
- `SystemHealthPanel`: Displays health metrics, updates on heartbeat

### E2E Tests

- Full admin flow: Login → View game list → Watch live game → Pause → Resume → Stop
- Cost tracking: Run several games, verify cost accumulation
- Reconnection: Kill WebSocket, verify reconnection with missed events

---

## Section 14: Integration Points

### Existing Components Reused
- `Sidebar` toggle/collapse mechanism → `AdminSidebar`
- `GameList` create modal → `CreateGameModal` (extended)
- `GameFeed` event list → `ThinkColumn` / `SayColumn` (adapted)
- `PhaseDisplay` → Used in live viewer header
- `Loading` spinner → Used during initial load
- `useGameStream` hook → Extended into `useAdminStream`
- `useUIStore.sidebarOpen` → Extended for admin sidebar state

### Existing Specs Referenced
- Colors/typography/layout → `ui-components.md` Section "Design System"
- Authorization/token model → `permission-model.md` Section 1 (Admin mode)
- WebSocket protocol → `streaming-protocol.md` (all message types)
- THINK/SAYS streaming → `split-pane-consciousness.md` (dual-stream concept)
- REST endpoints → `api-specs.md` (game management endpoints)
- Event schemas → `event-schemas.md` (event type definitions)
