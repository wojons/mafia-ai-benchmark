# Permission & Visibility Model

## Overview
Three distinct view modes control what data clients can see. This enables both engaging gameplay (Town mode) and debugging/analysis (Admin mode).

## View Modes

### 1. Admin/Observer Mode
**Full visibility - for game developers, video creators, analysts**

**Access:**
- Server serves ADMIN-visibility events with no authentication by default (localhost dev). Optional opt-in auth (MAF-REV-004): set `ADMIN_AUTH_TOKEN` to require the token for (a) exposing ADMIN-visibility events and (b) game creation.
- Token transport on REST: `Authorization: Bearer <token>` or `X-Admin-Token: <token>` header. Failures answer `401 {"success": false, "error": "unauthorized"}`. When `ADMIN_AUTH_TOKEN` is unset the auth layer is DISABLED and every request passes through.

**Status note (2026-10-04, DOC-12):** the access-control surface below was rewritten to match the shipped implementation (`apps/server/src/middleware/auth.ts`, `apps/server/src/routes/games.ts`). Earlier revisions described a `?authToken=`/`viewMode=` WebSocket handshake, `pause`/`step` admin routes, and a `PROTECTED` visibility level — none of those exist in shipped code. The conceptual view-mode/event-matrix narrative that follows (Admin/Town/Replay modes, examples) is kept as DESIGN INTENT, clearly labeled; the "as shipped" sections (API Authorization, WebSocket Behavior, CLI Authorization) are the real surface.

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

**Example Admin Client (design intent — shipped WS has no auth params):**
```typescript
// REST reads with opt-in admin auth
const res = await fetch('http://localhost:3004/api/v1/games/123/events?visibility=all', {
  headers: { Authorization: `Bearer ${process.env.ADMIN_AUTH_TOKEN}` },
});

// Connection established with admin privileges
// ADMIN-visibility events (AGENT_THINK_STARTED / AGENT_THINK_COMPLETED,
// mapped from the legacy engine's ADMIN_ONLY events) are included when auth
// permits; PRIVATE events appear per the visibility filter.
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

**Access (design intent — see "as shipped" sections):**
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

**Example Town Client (design intent — shipped WS has no viewMode param):**
```typescript
const ws = new WebSocket('ws://localhost:3004/ws/game-123');

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

## API Authorization (as shipped)

**REST endpoints (`/api/v1`, see `apps/server/src/routes/games.ts`):**

- `GET /api/v1/games` — list games (no auth)
- `GET /api/v1/games/:id` — game detail (no auth)
- `GET /api/v1/games/:gameId/events?visibility=public|private|admin|all` — event read with server-side visibility filter (default `all`); `public` returns only PUBLIC events, `private` only PRIVATE ones.
- `POST /api/v1/games` — create a game (token-gated when `ADMIN_AUTH_TOKEN` is set)

There are no `pause` / `step` admin routes in shipped code; the engine does not expose manual stepping.

**Optional admin auth (`ADMIN_AUTH_TOKEN`, MAF-REV-004 — `apps/server/src/middleware/auth.ts`):**

```typescript
// Opt-in: env var unset (or empty) => layer DISABLED, every request passes.
// When set, requests must carry the token to:
//   (a) expose ADMIN-visibility events via GET .../events, and
//   (b) create games via POST /api/v1/games.
// Transport: `Authorization: Bearer <token>` or `X-Admin-Token: <token>` header.
// Failure: 401 JSON { success: false, error: 'unauthorized' }
// The token is re-read from env on every request; a test override exists
// (setAdminAuthOverride(token | null | undefined)) so tests avoid env races.
```

**Token Validation (shipped):** constant-time comparison (`timingSafeEqual`) against the effective `ADMIN_AUTH_TOKEN`, never a plain `===` on env.

## WebSocket Behavior (as shipped)

The server mounts a WebSocket endpoint at `/ws` (`apps/server/src/websocket/index.ts`, `ws` library). There is **no connection-level auth and no `?authToken=` / `viewMode=` query parameters** — the WS layer is a broadcast/event fan-out surface, not a per-connection view-mode filter. Visibility filtering happens on the REST events endpoint (server-side `?visibility=` filter above), not per-WebSocket-connection. Private/admin event content is not gated by a per-client view mode over WS; use the opt-in REST auth + visibility filter for controlled reads.

### Event Filtering per Connection (design intent — not implemented as shown; see WS note above)
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

The shipped CLI does not implement an `attach` admin-token mode (an `--admin-token` flag or an admin token env var is not a shipped option). Event visibility from the CLI is governed by the same REST `?visibility=` filter and optional `ADMIN_AUTH_TOKEN` described above (set `ADMIN_AUTH_TOKEN` in the environment and the CLI's API reads carry the token, or read public events unauthenticated).

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
  PUBLIC = 'PUBLIC',      // Everyone sees
  PRIVATE = 'PRIVATE',    // Admin/auth-gated reads only
  ADMIN = 'ADMIN'         // Admin-visibility (THINK streams, ADMIN_ONLY-mapped legacy events)
}

// Shipped shape (packages/shared/src/events/index.ts): EventVisibility =
// 'PUBLIC' | 'PRIVATE' | 'ADMIN'. There is no PROTECTED level in shipped code;
// the example below is design intent from the original draft.

interface EventEnvelope {
  eventType: string;
  gameId: string;
  sequence: number;
  timestamp: number;
  visibility: Visibility;
  payload: any;
}

// Example (illustrative): night outcome with public detail only
{
  eventType: 'NIGHT_ENDED',
  visibility: 'PUBLIC',
  payload: {
    prevented: true,         // Visible to all
    publicMessage: 'No one died'  // Visible to all
  }
}
```

### View Mode Filters (design intent — shipped filtering is the REST `?visibility=` switch)
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

### Unit Tests (design intent)

Shipped auth tests live in `apps/server/src/__tests__/middleware/auth.test.ts` (opt-in token enforcement, 401 shape, override toggling). The filter unit tests below are retained as design intent for the conceptual view-mode model.

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

### Integration Tests (design intent — shipped WS has no per-connection auth/view modes; see WS note above)

Not shown: shipped tests cover the opt-in REST auth directly (`apps/server/src/__tests__/middleware/auth.test.ts`); the WS per-connection handshake sketch from earlier drafts has no shipped equivalent (it would require the design-intent connection-level auth to exist) and has been removed.

---

## Security Considerations

### Token Management
- Store `ADMIN_AUTH_TOKEN` in environment variable (see `.env.sample`); it is optional — unset means auth disabled
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