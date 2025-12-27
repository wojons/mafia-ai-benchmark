# Streaming Protocol Specification

## Overview
Real-time event streaming from server to clients using WebSocket protocol. Supports live games, replays, and reconnection scenarios with guaranteed delivery.

## Transport Layer

### WebSocket Connection
```
Endpoint: ws://localhost:3000/ws/:gameId
Protocol: ws (upgrade from HTTP)
Message Format: UTF-8 JSON
Ping/Pong: Every 30 seconds (heartbeat)
```

### Connection Flow
```
Client                                  Server
  │                                       │
  │  CONNECT ws://.../ws/game-123         │
  ├──────────────────────────────────────▶│
  │                                       │
  │  {                                    │
  │     "type": "SUBSCRIBE",              │
  │     "gameId": "game-123",             │
  │     "viewMode": "admin",              │
  │     "lastSeq": 15,    (optional)      │
  │     "authToken": "..."  (optional)    │
  │  }                                    │
  ├──────────────────────────────────────▶│
  │                                       │
  │  {                                    │
  │     "type": "SUBSCRIBED",             │
  │     "gameId": "game-123",             │
  │     "currentSeq": 18,                 │
  │     "status": "RUNNING",              │
  │     "phase": "DAY_DISCUSSION",       │
  │     "dayNumber": 2                    │
  │  }                                    │
  │◀──────────────────────────────────────┤
  │                                       │
  │  { "type": "EVENT", "event": {...} } │
  │◀──────────────────────────────────────┤
  │                                       │
  │  { "type": "EVENT", "event": {...} } │
  │◀──────────────────────────────────────┤
  │                                       │
  │  { "type": "HEARTBEAT" }              │
  │◀──────────────────────────────────────┤
  │                                       │
  │  { "type": "PING" }                   │
  ├──────────────────────────────────────▶│
  │                                       │
  │  { "type": "PONG" }                   │
  │◀──────────────────────────────────────┤
  │                                       │
```

---

## Message Types

### 1. SUBSCRIBE (Client → Server)
Initial subscription request.

**Schema:**
```typescript
interface SubscribeMessage {
  type: 'SUBSCRIBE';
  gameId: string;
  viewMode: 'admin' | 'town' | 'postmortem';
  lastSeq?: number;              // Start from this sequence
  authToken?: string;            // Optional admin token
}
```

**Example:**
```json
{
  "type": "SUBSCRIBE",
  "gameId": "game-abc123",
  "viewMode": "admin",
  "lastSeq": 45,
  "authToken": "admin-token-xyz"
}
```

**Validation:**
- `gameId` must exist and not be deleted
- `viewMode` must be valid enum
- If `lastSeq` provided, server checks if it's within buffering range
- If `authToken` invalid, server downgrades to `town` mode

---

### 2. SUBSCRIBED (Server → Client)
Subscription confirmation with initial state.

**Schema:**
```typescript
interface SubscribedMessage {
  type: 'SUBSCRIBED';
  gameId: string;
  currentSeq: number;            // Last event sequence number
  status: 'RUNNING' | 'PAUSED' | 'ENDED';
  phase: Phase;
  dayNumber: number;
  roundNumber: number;
  aliveCount: number;
  deadCount: number;
  winner: 'town' | 'mafia' | null;
  missedEvents?: Event[];        // Events since lastSeq
}
```

**Example:**
```json
{
  "type": "SUBSCRIBED",
  "gameId": "game-abc123",
  "currentSeq": 45,
  "status": "RUNNING",
  "phase": "DAY_DISCUSSION",
  "dayNumber": 2,
  "roundNumber": 5,
  "aliveCount": 6,
  "deadCount": 4,
  "winner": null,
  "missedEvents": [
    { "eventType": "VOTE_CAST", "sequence": 44, ... }
  ]
}
```

**If `lastSeq` was provided:** Server includes `missedEvents` array with all events from `lastSeq + 1` to `currentSeq`.

---

### 3. EVENT (Server → Client)
Game event (majority of traffic).

**Schema:**
```typescript
interface EventMessage {
  type: 'EVENT';
  event: Event;                 // See event-schemas.md
  timestamp: number;            // Server timestamp
}
```

**Example:**
```jsonn
{
  "type": "EVENT",
  "timestamp": 1703774405000,
  "event": {
    "eventType": "AGENT_SAY_CHUNK",
    "gameId": "game-abc123",
    "sequence": 46,
    "private": false,
    "payload": {
      "agentId": "p1",
      "agentName": "Alice",
      "chunk": "I think Bob is acting suspiciously.",
      "turnId": "say-day-2-p1"
    }
  }
}
```

**Streaming Chunks:**
- THINK and SAY events stream in real-time
- Client accumulates chunks per turnId
- Empty chunk signals stream end

**Example streaming sequence:**
```json
{"type": "EVENT", "event": {"eventType": "AGENT_THINK_CHUNK", "payload": {"chunk": "I need to", ...}}}
{"type": "EVENT", "event": {"eventType": "AGENT_THINK_CHUNK", "payload": {"chunk": "protect the", ...}}}
{"type": "EVENT", "event": {"eventType": "AGENT_THINK_CHUNK", "payload": {"chunk": "sheriff.", ...}}}
{"type": "EVENT", "event": {"eventType": "AGENT_THINK_CHUNK", "payload": {"chunk": "", ...}}}  // End signal
{"type": "EVENT", "event": {"eventType": "AGENT_SAY_CHUNK", "payload": {"chunk": "I will", ...}}}
```

---

### 4. HEARTBEAT (Server → Client)
Keepalive + status update (sent every 30s if no events).

**Schema:**
```typescript
interface HeartbeatMessage {
  type: 'HEARTBEAT';
  timestamp: number;
  gameStatus: {
    phase: Phase;
    dayNumber: number;
    aliveCount: number;
    deadCount: number;
  };
}
```

**Example:**
```json
{
  "type": "HEARTBEAT",
  "timestamp": 1703774500000,
  "gameStatus": {
    "phase": "DAY_VOTING",
    "dayNumber": 2,
    "aliveCount": 6,
    "deadCount": 4
  }
}
```

**Client Behavior:**
- Reset connection timeout
- Update UI status bar
- Detect server-side disconnects

---

### 5. PING (Client → Server)
Client keepalive (optional, but recommended).

**Schema:**
```typescript
interface PingMessage {
  type: 'PING';
  timestamp: number;
  clientSeq?: number;           // Last event sequence received
}
```

**Example:**
```json
{
  "type": "PING",
  "timestamp": 1703774501000,
  "clientSeq": 47
}
```

**Frequency:** Every 15-30 seconds or when idle.

---

### 6. PONG (Server → Client)
Ping response.

**Schema:**
```typescript
interface PongMessage {
  type: 'PONG';
  timestamp: number;
  serverSeq: number;            // Current server sequence
  roundTripMs: number;
}
```

**Example:**
```json
{
  "type": "PONG",
  "timestamp": 1703774501005,
  "serverSeq": 48,
  "roundTripMs": 5
}
```

**Client Use:**
- Calculate latency
- Verify connection health
- Detect missing events (if serverSeq > clientSeq + buffer)

---

### 7. ERROR (Server → Client)
Streaming error or protocol violation.

**Schema:**
```typescript
interface ErrorMessage {
  type: 'ERROR';
  code: string;
  message: string;
  fatal: boolean;               // True = connection closing
}
```

**Error Codes:**
```typescript
const ERROR_CODES = {
  'INVALID_GAME_ID': 'Game ID does not exist',
  'GAME_ENDED': 'Game has finished',
  'GAME_DELETED': 'Game data has been purged',
  'VIEW_MODE_DENIED': 'Insufficient permissions for view mode',
  'RATE_LIMITED': 'Too many subscriptions',
  'PROTOCOL_ERROR': 'Invalid message format',
  'SEQUENCE_OUT_OF_RANGE': 'Requested sequence too old'
};
```

**Examples:**
```json
{
  "type": "ERROR",
  "code": "INVALID_GAME_ID",
  "message": "Game 'game-999' not found",
  "fatal": true
}
```

---

## Event Buffering & Replay

### Server-Side Buffer
Server maintains in-memory ring buffer of recent events:

```typescript
class EventBuffer {
  private buffer: Event[] = [];
  private readonly capacity = 1000;  // Last 1000 events
  private startSeq = 0;
  
  append(event: Event): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();  // Remove oldest
      this.startSeq++;
    }
    this.buffer.push(event);
  }
  
  getFrom(sequence: number): Event[] | null {
    if (sequence < this.startSeq) {
      return null;  // Too old, not in buffer
    }
    
    const startIdx = sequence - this.startSeq;
    return this.buffer.slice(startIdx);
  }
}
```

**Missed Event Recovery:**
1. Client reconnects with `lastSeq: 45`
2. Server checks if sequence 46+ is in buffer
3. If yes: Send `missedEvents` array in SUBSCRIBED message
4. If no: Return error `SEQUENCE_OUT_OF_RANGE`

### Client Handling
```typescript
class StreamingClient {
  private lastSeq: number = -1;
  private eventBuffer: Event[] = [];
  private isReplaying: boolean = false;
  
  async connect(gameId: string, lastSeq?: number) {
    this.ws = new WebSocket(`ws://.../${gameId}`);
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'EVENT') {
        const event = message.event;
        
        // Check for sequence gaps
        if (this.lastSeq >= 0 && event.sequence !== this.lastSeq + 1) {
          console.warn(`Sequence gap: ${this.lastSeq} -> ${event.sequence}`);
          if (!this.isReplaying) {
            this.handleGap(event.sequence);
          }
        }
        
        this.lastSeq = event.sequence;
        this.eventBuffer.push(event);
        
        // Limit buffer size
        if (this.eventBuffer.length > 5000) {
          this.eventBuffer = this.eventBuffer.slice(-5000);
        }
        
        this.onEvent(event);
      }
    };
  }
  
  private handleGap(expectedSeq: number) {
    // 1. Pause live updates
    this.isReplaying = true;
    
    // 2. Request missing events via REST API
    fetch(`/api/games/${this.gameId}/events?fromSeq=${this.lastSeq + 1}`)
      .then(res => res.json())
      .then(data => {
        // 3. Insert missed events
        for (const event of data.events) {
          this.onEvent(event);
        }
        
        // 4. Resume live updates
        this.isReplaying = false;
      });
  }
}
```

---

## Reconnection Strategy

### Client-Side Logic
```typescript
class AutoReconnectingClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;  // Start with 1s
  
  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => this.reconnect(), this.reconnectDelay);
        this.reconnectDelay *= 2;  // Exponential backoff
        this.reconnectAttempts++;
      }
    };
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
    };
  }
  
  reconnect() {
    // Re-subscribe with last known sequence
    const lastSeq = this.getLastSequence();
    this.connectWithSequence(lastSeq);
  }
}
```

### Reconnection States
```
Disconnected
    │
    ├───► Reconnecting (1s delay)
    │       │
    │       ├───► Success → Resume streaming
    │       │
    │       └───► Failed ───────┐
    │                           │
    └───► Reconnecting (2s)     │
            │                   │
            ├───► Success       │
            │                   │
            └───► Failed ───────┤
                                │
                ... (up to 5 attempts)
                                │
    ┌───────────────────────────┘
    │
    ▼
Failed to reconnect
    │
    ▼
Show "Connection Lost" UI
```

---

## Protocol Extensions

### Bulk Event Fetch
For replays or catch-up, server supports bulk fetch:

**Request:**
```http
GET /api/games/:gameId/stream?fromSeq=0&toSeq=1000&format=ws
```

**Response:** WebSocket upgrade with immediate event burst.

### Snapshot + Events
For very large gaps, server can send snapshot + delta:

```typescript
interface SnapshotMessage {
  type: 'SNAPSHOT';
  sequence: number;
  gameState: GameState;
}

// Followed by events: sequence+1, sequence+2, ...
```

---

## Implementation Example: Server

```typescript
// server/src/transport/WebSocketStream.ts

export class WebSocketStream {
  private wss: WebSocketServer;
  private connections = new Map<string, Set<WebSocket>>;
  private buffers = new Map<string, EventBuffer>;
  
  constructor(server: HTTPServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url!, `ws://localhost`);
      const gameId = url.pathname.split('/')[2];
      
      const subscription = this.handleSubscription(ws, gameId, url);
      
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message, subscription);
      });
      
      ws.on('close', () => {
        this.connections.get(gameId)?.delete(ws);
      });
    });
  }
  
  handleSubscription(ws: WebSocket, gameId: string, url: URL) {
    const viewMode = url.searchParams.get('viewMode') as ViewMode || 'town';
    const lastSeq = parseInt(url.searchParams.get('lastSeq') || '-1');
    
    // Validate game exists
    const game = this.getGame(gameId);
    if (!game) {
      this.sendError(ws, 'INVALID_GAME_ID', 'Game not found', true);
      ws.close();
      return;
    }
    
    // Check authorization
    const authToken = url.searchParams.get('authToken');
    const effectiveViewMode = this.authorizeViewMode(viewMode, authToken);
    
    // Send subscription confirmation
    const missedEvents = lastSeq >= 0 
      ? this.buffers.get(gameId)?.getFrom(lastSeq + 1)
      : null;
    
    this.send(ws, {
      type: 'SUBSCRIBED',
      gameId,
      currentSeq: game.lastSeq,
      status: game.status,
      phase: game.phase,
      missedEvents: effectiveViewMode === 'admin' ? missedEvents : this.filterPrivate(missedEvents)
    });
    
    // Store connection
    if (!this.connections.has(gameId)) {
      this.connections.set(gameId, new Set());
    }
    this.connections.get(gameId)!.add(ws);
    
    return { gameId, viewMode: effectiveViewMode };
  }
  
  broadcastEvent(gameId: string, event: Event) {
    const connections = this.connections.get(gameId);
    if (!connections) return;
    
    // Store in buffer
    this.buffers.get(gameId)?.append(event);
    
    // Broadcast to all connections
    for (const ws of connections) {
      const isAdmin = ws.subscription.viewMode === 'admin';
      const visibleEvent = isAdmin ? event : this.filterPrivateEvents([event])[0];
      
      if (visibleEvent) {
        this.send(ws, {
          type: 'EVENT',
          timestamp: Date.now(),
          event: visibleEvent
        });
      }
    }
  }
  
  private filterPrivateEvents(events: Event[]): Event[] {
    return events.filter(event => !event.private);
  }
}
```

---

## Testing the Protocol

### Mock WebSocket Server
```typescript
// Test helper
class MockWebSocketServer {
  createConnection(): { client: MockWebSocket; server: MockWebSocket } {
    // Create mock WebSocket pair
  }
}

// Protocol test
test('WebSocket streaming', async () => {
  const { client, server } = mockWebSocketServer.createConnection();
  const stream = new WebSocketStream(mockServer);
  
  // Subscribe
  client.send(JSON.stringify({
    type: 'SUBSCRIBE',
    gameId: 'test-game'
  }));
  
  // Wait for subscription
  await waitForMessage(client, (msg) => msg.type === 'SUBSCRIBED');
  
  // Send event
  stream.broadcastEvent('test-game', testEvent);
  
  // Verify client receives
  const eventMsg = await waitForMessage(client, (msg) => msg.type === 'EVENT');
  expect(eventMsg.event).toEqual(testEvent);
});
```

---

## Performance Metrics

### Target Latency
- **Event generation to broadcast:** <10ms
- **Client receive to render:** <30ms
- **Total end-to-end latency:** <50ms

### Throughput
- **Max events per second:** 1000 (burst)
- **Sustained events per second:** 100
- **Concurrent connections:** 100 per game

### Bandwidth
- **Average event size:** 500 bytes
- **Streaming overhead:** 50 bytes per message
- **Recommended minimum bandwidth:** 1 Mbps