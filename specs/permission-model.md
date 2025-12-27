# Permission & Visibility Model

## Overview
Three distinct view modes control what data clients can see. This enables both engaging gameplay (Town mode) and debugging/analysis (Admin mode).

## View Modes

### 1. Admin/Observer Mode
**Full visibility - for game developers, video creators, analysts**

**Access:**
- Requires `ADMIN_TOKEN` environment variable
- Pass token in WebSocket header or query param

**Can See:**
- ✅ ALL events (public, private, admin)
- ✅ True roles for all players
- ✅ THINK streams (agent private reasoning)
- ✅ Investigation results (private)
- ✅ Night action targets (private)
- ✅ Mafia team coordination

**Use Cases:**
- Debugging agent behavior
- Creating video content
- Analyzing game strategies
- Testing new features

**Example Admin Client:**
```typescript
// WebSocket connection with admin token
const ws = new WebSocket(`ws://localhost:3000/ws/game-123?authToken=${ADMIN_TOKEN}`);

// Connection established with admin privileges
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.event.eventType === 'AGENT_THINK_CHUNK') {
    // I can see THINK even though it's private
    console.log(`THINK (${message.event.payload.agentName}):`, 
                message.event.payload.chunk);
  }
  
  if (message.event.eventType === 'INVESTIGATION_RESULT') {
    // I see private investigation results immediately
    console.log('Sheriff investigation:', message.event.payload);
  }
};
```

---

### 2. Town/Public Mode
**Limited visibility - what a regular player would see**

**Access:**
- Default mode, no authentication required
- WebSocket: `?viewMode=town` (or omit parameter)

**Can See:**
- ✅ Public events only
- ✅ Public statements (SAYS)
- ✅ Vote results
- ✅ Eliminations (with revealed roles)
- ⚠️ No THINK streams
- ⚠️ No private investigation results
- ⚠️ No night action details (just outcomes)

**Private Events Hidden:**
```typescript
const PRIVATE_EVENT_TYPES = new Set([
  'AGENT_THINK_CHUNK',      // Private reasoning
  'INVESTIGATION_RESULT',   // Sheriff's private info
  'NIGHT_ACTION_SUBMITTED', // Who targeted whom
  'MAFIA_COORDINATION',     // Mafia team chat
  'ROLE_ASSIGNED',          // Initial role assignments
]);

function filterEventForTownMode(event: Event): Event | null {
  if (PRIVATE_EVENT_TYPES.has(event.eventType)) {
    return null;  // Drop private events
  }
  
  // Also filter private fields from hybrid events
  if (event.eventType === 'PLAYER_ELIMINATED') {
    // Remove role from payload (revealed later)
    return {
      ...event,
      payload: {
        ...event.payload,
        role: undefined,  // Only revealed publicly when flipped
      }
    };
  }
  
  return event;
}
```

**Example Town Client:**
```typescript
const ws = new WebSocket('ws://localhost:3000/ws/game-123?viewMode=town');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.event.eventType === 'AGENT_SAY_CHUNK') {
    // I see public statements
    addToChat(message.event.payload);
  }
  
  if (message.event.eventType === 'INVESTIGATION_RESULT') {
    // This event is NOT sent to town mode
    // I only know if sheriff chooses to SAY it
  }
  
  if (message.event.eventType === 'NIGHT_RESOLVED') {
    // I see outcome, but not details
    const result = message.event.payload;
    if (result.prevented) {
      console.log('Someone was saved!');  // But I don't know who
    }
  }
};
```

---

### 3. Replay/Post-mortem Mode
**Retrospective visibility - analyze completed games**

**Access:**
- Available after game ends
- Can toggle reveal during replay
- Load exported JSONL file

**Can See:**
- ✅ All events (same as admin mode)
- ✅ Can toggle visibility during replay
- ✅ Works with exported logs

**Implementation:**
```typescript
// Client-side replay viewer
function ReplayViewer({ events }) {
  const [showPrivate, setShowPrivate] = useState(false);
  
  const visibleEvents = useMemo(() => {
    return showPrivate 
      ? events
      : events.filter(e => !e.private);
  }, [events, showPrivate]);
  
  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={showPrivate}
          onChange={(e) => setShowPrivate(e.target.checked)}
        />
        Reveal private events (THINK, investigations, etc.)
      </label>
      
      <GameFeed events={visibleEvents} />
    </div>
  );
}
```

---

## Event Visibility Matrix

| Event Type | Admin | Town | Replay (default) | Replay (reveal) |
|------------|-------|------|------------------|-----------------|
| `GAME_CREATED` | ✅ | ✅ | ✅ | ✅ |
| `PHASE_CHANGED` | ✅ | ✅ | ✅ | ✅ |
| `ROLES_ASSIGNED` (full) | ✅ | ❌ | ⚠️ (hashed) | ✅ |
| `AGENT_THINK_CHUNK` | ✅ | ❌ | ❌ | ✅ |
| `AGENT_SAY_CHUNK` | ✅ | ✅ | ✅ | ✅ |
| `NIGHT_ACTION_SUBMITTED` | ✅ | ❌ | ❌ | ✅ |
| `NIGHT_RESOLVED` | ✅ | ✅* | ✅* | ✅ |
| `INVESTIGATION_RESULT` | ✅ | ❌ | ❌ | ✅ |
| `VOTE_CAST` | ✅ | ✅ | ✅ | ✅ |
| `VOTE_RESULT` | ✅ | ✅ | ✅ | ✅ |
| `PLAYER_ELIMINATED` | ✅ | ✅* | ✅* | ✅ |
| `GAME_ENDED` | ✅ | ✅ | ✅ | ✅ |

*Town mode sees event but with redacted private fields

---

## API Authorization

### REST Endpoints

**Public Endpoints (no auth):**
- `GET /api/games` - List games
- `GET /api/games/:id` - Basic status (no private fields)
- `GET /api/games/:id/events?includePrivate=false` - Public events only

**Admin Endpoints (require token):**
- `POST /api/games/:id/pause` - Control game
- `GET /api/games/:id/events?includePrivate=true` - All events
- `POST /api/games/:id/step` - Manual step

**Token Validation:**
```typescript
function validateAdminToken(token: string): boolean {
  return token === process.env.ADMIN_TOKEN;
}
```

**Example middleware:**
```typescript
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  
  if (!validateAdminToken(token)) {
    return res.status(403).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin token required'
      }
    });
  }
  
  next();
}

// Use for admin routes
app.post('/api/games/:id/pause', requireAdmin, pauseHandler);
```

---

## WebSocket Authorization

### Connection-Level Auth
```typescript
// Server-side WebSocket auth
wsServer.on('connection', (ws, req) => {
  const url = new URL(req.url!, 'ws://localhost');
  const token = url.searchParams.get('authToken');
  const requestedMode = url.searchParams.get('viewMode') as ViewMode;
  
  // Determine effective view mode
  const effectiveMode = token === ADMIN_TOKEN 
    ? requestedMode  // Admin can choose any mode
    : 'town';         // Others get town mode
  
  // Store on connection
  ws.viewMode = effectiveMode;
  
  // Send subscription confirmation
  ws.send(JSON.stringify({
    type: 'SUBSCRIBED',
    viewMode: effectiveMode,
    // ... other fields
  }));
});
```

### Event Filtering per Connection
```typescript
function broadcastEvent(gameId: string, event: Event) {
  const connections = connectionsMap.get(gameId);
  
  for (const ws of connections) {
    // Filter based on connection's view mode
    const visibleEvent = filterEventForViewMode(event, ws.viewMode);
    
    if (visibleEvent) {
      ws.send(JSON.stringify({
        type: 'EVENT',
        event: visibleEvent
      }));
    }
  }
}

function filterEventForViewMode(event: Event, viewMode: ViewMode): Event | null {
  // Admin sees all
  if (viewMode === 'admin') return event;
  
  // Town mode filters private
  if (viewMode === 'town' && event.private) {
    return null;
  }
  
  // Replay mode is client-side filtering
  return event;
}
```

---

## CLI Authorization

### Admin Mode
```bash
# Provide admin token
mafiactl attach game-123 --admin-token my-secret-token --verbose

# Token can also be in environment
export MAFIA_ADMIN_TOKEN=my-secret-token
mafiactl attach game-123 --verbose
```

### Visibility Flags
```bash
# Town mode (default) - public only
mafiactl attach game-123

# Shows SAY only
# Alice: "I think Bob is suspicious"
# Bob: "That's not true!"

# Admin mode - everything
mafiactl attach game-123 --admin-token xyz --verbose

# Shows SAY and THINK
# Alice (THINK): "Bob defended Charlie, likely mafia teammate"
# Alice (SAYS): "I think Bob is suspicious"
# Bob (THINK): "They're onto me, need to deflect"
# Bob (SAYS): "That's not true!"
```

---

## Data Privacy Levels

### Level 1: Public (Always Visible)
- Phase changes
- Public statements (SAYS)
- Vote results (who got eliminated)
- Game end/winner

### Level 2: Protected (Partial Visibility)
- Player elimination: See player died, but role hidden until flip
- Night results: See "no kill" but not who was targeted/protected

### Level 3: Private (Admin/Replay Only)
- THINK streams (agent reasoning)
- Investigation results (sheriff's info)
- Night action targets (who targeted whom)
- Initial role assignments
- Mafia team coordination

### Level 4: Metadata (System)
- Server timestamps
- Event sequences
- Session tokens
- IP addresses (logging)

---

## Implementation Details

### Event Envelope with Visibility
```typescript
enum Visibility {
  PUBLIC = 'public',      // Everyone sees
  PROTECTED = 'protected', // Partially redacted
  PRIVATE = 'private',    // Admin only
  ADMIN = 'admin'         // System/admin metadata
}

interface EventEnvelope {
  eventType: string;
  gameId: string;
  sequence: number;
  timestamp: number;
  visibility: Visibility;
  payload: any;
}

// Example: Night resolved (PROTECTED - public sees outcome but not details)
{
  eventType: 'NIGHT_RESOLVED',
  visibility: Visibility.PROTECTED,
  payload: {
    killedId: "p5",          // Hidden in town mode
    killedName: "Charlie",   // Hidden in town mode
    protectedId: "p5",       // Hidden in town mode
    protectedName: "Charlie", // Hidden in town mode
    prevented: true,         // Visible to all
    publicMessage: "No one died"  // Visible to all
  }
}
```

### View Mode Filters
```typescript
const VIEW_MODE_FILTERS = {
  'town': (event: EventEnvelope) => {
    if (event.visibility === Visibility.PRIVATE) return false;
    if (event.visibility === Visibility.ADMIN) return false;
    return true;
  },
  
  'admin': (event: EventEnvelope) => {
    return true;  // Admin sees all
  },
  
  'replay': (event: EventEnvelope, showPrivate: boolean) => {
    if (showPrivate) return true;
    return VIEW_MODE_FILTERS['town'](event);
  }
};
```

---

## Testing Authorization

### Unit Tests
```typescript
describe('View Mode Filters', () => {
  const thinkEvent = {
    eventType: 'AGENT_THINK_CHUNK',
    visibility: Visibility.PRIVATE,
    payload: { chunk: 'secret reasoning' }
  };
  
  const sayEvent = {
    eventType: 'AGENT_SAY_CHUNK',
    visibility: Visibility.PUBLIC,
    payload: { chunk: 'public statement' }
  };
  
  test('town mode hides private events', () => {
    const filter = VIEW_MODE_FILTERS['town'];
    expect(filter(thinkEvent)).toBe(false);
    expect(filter(sayEvent)).toBe(true);
  });
  
  test('admin mode shows all events', () => {
    const filter = VIEW_MODE_FILTERS['admin'];
    expect(filter(thinkEvent)).toBe(true);
    expect(filter(sayEvent)).toBe(true);
  });
});
```

### Integration Tests
```typescript
// Test WebSocket connection with different view modes
test('WebSocket respects view mode', async () => {
  // Admin connection
  const adminWs = new WebSocket(`ws://localhost:3000/ws/game-123?authToken=${ADMIN_TOKEN}`);
  await waitForOpen(adminWs);
  
  const adminSubscribed = await waitForMessage(adminWs);
  expect(adminSubscribed.viewMode).toBe('admin');
  
  // Town connection (no token)
  const townWs = new WebSocket('ws://localhost:3000/ws/game-123');
  await waitForOpen(townWs);
  
  const townSubscribed = await waitForMessage(townWs);
  expect(townSubscribed.viewMode).toBe('town');
  
  // Send a private event
  server.broadcastEvent('game-123', privateThinkEvent);
  
  // Admin should receive
  const adminEvent = await waitForMessage(adminWs);
  expect(adminEvent.event.eventType).toBe('AGENT_THINK_CHUNK');
  
  // Town should NOT receive
  const townTimeout = waitForMessage(townWs, 1000);
  await expect(townTimeout).rejects.toThrow('Timeout');
});
```

---

## Security Considerations

### Token Management
- Store `ADMIN_TOKEN` in environment variable
- Never log token values
- Rotate tokens periodically
- Use secure token generation: `crypto.randomBytes(32).toString('hex')`

### Replay Files
- JSONL exports contain private data (if admin exports)
- Store replay files with appropriate permissions
- Consider encrypting sensitive replays

### Network Security
- Use WSS (WebSocket Secure) in production
- Validate origin headers
- Implement rate limiting
- Log authentication failures