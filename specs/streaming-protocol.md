# Streaming Protocol Specification

> **Status: reflects the LIVE implementation.** Source of truth:
> `apps/server/src/websocket/index.ts` (WebSocketHandler) and
> `apps/server/src/services/event-bus.ts` (EventBus).
> Everything in [§ Planned / NOT IMPLEMENTED](#planned-not-implemented) is design-stage
> material from earlier drafts of this document — it has **no implementation**. Do not
> build clients against it.

## Overview

Real-time event streaming over WebSocket. There is **one global WebSocket endpoint**
(`/ws`); games are selected per-connection with a `JOIN_GAME` message, not by the URL.
Events are delivered **live only** — there is no server-side replay buffer, no sequence
resume, and no snapshot mechanism (see [Planned](#planned-not-implemented)).

## Transport Layer

### WebSocket Connection

```
Endpoint:      ws://<host>:<port>/ws        (single global path — NOT /ws/:gameId)
Protocol:      ws (upgrade from HTTP, same server as the REST API)
Message format: UTF-8 JSON, one object per message
Deployment:    container-internal :3000; docker-compose maps host :3004 → :3000;
               the web container's nginx proxies /ws to server:3000
```

- The endpoint is mounted once at server startup:
  `new WebSocketServer({ server: httpServer, path: '/ws' })`
  (`apps/server/src/index.ts`, alongside the Express REST routes — same port).
- There is no per-game URL. Subscribing to a game is a **message**, not a path
  (see `JOIN_GAME` below).
- There is no server-initiated heartbeat. The only keepalive is a client-initiated
  `PING` (the ws library's protocol-level ping/pong frames aside, the app layer
  implements nothing periodic).

### Message Envelope

Every message in both directions follows this shape
(`sendToClient()` stamps `timestamp` and echoes `requestId` on everything it sends):

```typescript
interface WSMessage {
  type: string;                      // message type discriminator
  payload: Record<string, unknown>;  // type-specific data
  requestId?: string;                // optional client correlation id (echoed back)
  timestamp?: string;                // ISO 8601, stamped by the server on send
}
```

### Connection Flow (live)

```
Client                                          Server
  │                                               │
  │  CONNECT ws://<host>:<port>/ws                │
  ├──────────────────────────────────────────────▶│
  │                                               │
  │  { "type": "CONNECTED",                       │
  │    "payload": { "clientId": "<uuid>" } }      │
  │◀──────────────────────────────────────────────┤
  │                                               │
  │  { "type": "JOIN_GAME",                       │
  │    "payload": { "gameId": "game-123" },       │
  │    "requestId": "r1"            (optional)    │
  │  }                                            │
  ├──────────────────────────────────────────────▶│
  │                                               │
  │  { "type": "GAME_JOINED",                     │
  │    "payload": { "gameId": "game-123" } }      │
  │◀──────────────────────────────────────────────┤
  │                                               │
  │  { "type": "GAME_STATE",                      │
  │    "payload": { "state": {...} } }   (only if the game exists)
  │◀──────────────────────────────────────────────┤
  │                                               │
  │  { "type": "GAME_EVENT",                      │  ← every event the game
  │    "payload": { ...GameEvent... },            │    publishes, live
  │    "timestamp": "2026-09-29T..." }            │
  │◀──────────────────────────────────────────────┤
  │                                               │
  │  { "type": "PING", "payload": {} }            │
  ├──────────────────────────────────────────────▶│
  │                                               │
  │  { "type": "PONG", "payload": {} }            │
  │◀──────────────────────────────────────────────┤
```

---

## Message Types (live)

### Server → Client

| Type | Payload | When |
|---|---|---|
| `CONNECTED` | `{ clientId }` | Immediately after the socket opens |
| `GAME_JOINED` | `{ gameId }` | Ack for `JOIN_GAME` |
| `GAME_STATE` | `{ state }` | After `JOIN_GAME` (if the game exists) and in reply to `REQUEST_STATE` |
| `GAME_EVENT` | the `GameEvent` as published | Live game event, delivered to every client joined to that game |
| `BROADCAST` | event object | Server-wide fan-out via `broadcastToAll()` (handler surface; no current in-repo caller) |
| `SUBSCRIBED` | `{ eventTypes }` or `{ eventTypes: ['GAME_EVENT'], gameId }` | Ack for `SUBSCRIBE` (see below) |
| `UNSUBSCRIBED` | `{ eventTypes }` | Ack for `UNSUBSCRIBE` |
| `GAME_LEFT` | `{}` | Ack for `LEAVE_GAME` |
| `ACTION_SENT` | `{ actionType, targetId }` | Ack for `SEND_ACTION` |
| `PONG` | `{}` | Reply to `PING` |
| `ERROR` | `{ message }` | Invalid JSON, unknown type, protocol misuse, engine failure |

### Client → Server

| Type | Payload | Effect |
|---|---|---|
| `PING` | `{}` | Server replies `PONG` (empty payload; no latency/seq fields) |
| `JOIN_GAME` | `{ gameId }` | Register this connection for the game's live events |
| `LEAVE_GAME` | `{}` | Drop the per-game subscription; server replies `GAME_LEFT` |
| `SUBSCRIBE` | `{ eventTypes: string[] }` or `{ gameId }` | See below |
| `UNSUBSCRIBE` | `{ eventTypes: string[] }` | Removes types from the (informational) subscription set |
| `SEND_ACTION` | `{ actionType, targetId, ... }` | Submit a game action; requires an active `JOIN_GAME` |
| `REQUEST_STATE` | `{ gameId }` | Replies `GAME_STATE`, or `ERROR` "Game not found" |

---

### 1. CONNECTED (Server → Client)

Sent on every new connection. `clientId` is a UUID generated per connection.

```json
{ "type": "CONNECTED", "payload": { "clientId": "0b8f..." }, "timestamp": "..." }
```

### 2. JOIN_GAME (Client → Server) — the per-game subscription

```json
{ "type": "JOIN_GAME", "payload": { "gameId": "game-abc123" }, "requestId": "r1" }
```

Effects (all in `registerGameSubscription()`):

1. Sets the client's `gameId` and adds `game:<id>` to its subscription set.
2. Subscribes the client to the **EventBus wildcard** (`subscribeAll`) and filters by
   `event.gameId === gameId` — the EventBus is event-type-keyed, so topic keys like
   `game:<id>` never fire by themselves. Spectator semantics: the joiner receives the
   game's events (no self-exclusion).
3. Tears down any **previous** per-game subscription first — one game per connection;
   a second `JOIN_GAME` replaces the first.

Replies: `GAME_JOINED { gameId }`, then `GAME_STATE { state }` **only if** the game
engine has state for that id. Note: joining an unknown gameId still acks `GAME_JOINED`
— there is no existence validation and no error frame for it.

### 3. GAME_EVENT (Server → Client) — live game events

The majority of traffic. One frame per event the game publishes:

```json
{
  "type": "GAME_EVENT",
  "payload": {
    "id": "<uuid>",
    "gameId": "game-abc123",
    "type": "AGENT_SAYS_BROADCASTED",
    "timestamp": "2026-09-29T12:00:00.000Z",
    "visibility": "PUBLIC",
    "actorId": "p1",
    "data": { "...": "..." },
    "metadata": { "turnNumber": 5, "dayNumber": 2, "phase": "DAY_DISCUSSION", "sequence": 44 }
  },
  "timestamp": "2026-09-29T12:00:00.001Z"
}
```

- `payload` is the `GameEvent` **exactly as published** to the EventBus
  (`packages/shared` `GameEvent`: `id`, `gameId`, `type`, `timestamp`, `visibility`
  (`'PUBLIC' | 'PRIVATE' | 'ADMIN'`), optional `actorId`/`targetId`, `data`,
  `metadata { turnNumber, dayNumber, phase, sequence }`).
- **No visibility filtering happens on the WebSocket path.** `PRIVATE`/`ADMIN` events
  reach any client joined to the game. (The REST events endpoint
  `GET /api/v1/games/:gameId/events` does filter by visibility; the WS does not.)
  Treat admin-view gating as a client/UI concern until a filter lands.
- `metadata.sequence` is the only sequence number in the system, and **nothing in the
  WS layer consumes it** — there is no gap detection, no replay, no resume.

### 4. SUBSCRIBE (Client → Server) — two forms

**Event-type form** (adds types to the client's subscription set):

```json
{ "type": "SUBSCRIBE", "payload": { "eventTypes": ["PHASE_CHANGED", "VOTE_CAST"] } }
```

Ack: `SUBSCRIBED { eventTypes: [...] }`. **Caveat:** that subscription set is
bookkeeping only — event delivery keys exclusively off the client's `gameId`
(see `JOIN_GAME`). Subscribing to event types does not cause any frames to be sent.

**gameId form** (legacy alias, kept for compatibility — DF-MAFIA-AI-BENCHMARK-19):

```json
{ "type": "SUBSCRIBE", "payload": { "gameId": "game-abc123" } }
```

`gameId` (or `game_id`) is aliased to the `JOIN_GAME` path so it can never silently
no-op. Ack: `SUBSCRIBED { eventTypes: ['GAME_EVENT'], gameId }` — followed by the same
EventBus registration as `JOIN_GAME` (but without the `GAME_JOINED`/`GAME_STATE`
replies). Prefer `JOIN_GAME` in new clients.

### 5. SEND_ACTION (Client → Server)

Requires an active `JOIN_GAME`; otherwise `ERROR { message: 'Not in a game' }`.

```json
{ "type": "SEND_ACTION", "payload": { "actionType": "VOTE", "targetId": "p3", "voterId": "p1" } }
```

| `actionType` | Extra payload fields | Engine call |
|---|---|---|
| `VOTE` | `voterId`, `targetId` | `submitVote(gameId, voterId, targetId)` |
| `NIGHT_ACTION` | `playerId`, `action`, `targetId` | `submitNightAction(gameId, playerId, action, targetId)` |
| `ACCUSATION` | `accuserId`, `targetId`, `accusation`, `evidence` | `makeAccusation(...)` |
| `ROLE_CLAIM` | `playerId`, `role` (`MAFIA`\|`DOCTOR`\|`SHERIFF`\|`VIGILANTE`\|`VILLAGER`) | `claimRole(...)` |

Success ack: `ACTION_SENT { actionType, targetId }`. Engine throw:
`ERROR { message: 'Failed to send action' }`.

### 6. PING / PONG (Client → Server / Server → Client)

```json
→ { "type": "PING", "payload": {} }
← { "type": "PONG", "payload": {} }
```

The client may send `PING` at any time; the server replies `PONG` with an **empty
payload** — no `roundTripMs`, no `serverSeq`. There is no server-initiated heartbeat
and no idle timeout tied to it. The REST SSE stream (below) uses 30 s keepalive
comments instead.

### 7. ERROR (Server → Client)

```json
{ "type": "ERROR", "payload": { "message": "Unknown message type: FOO" }, "timestamp": "..." }
```

Emitted for: unparseable JSON (`Invalid message format`), unknown `type`,
`SEND_ACTION` without a game (`Not in a game`), engine failures
(`Failed to send action`), `REQUEST_STATE` for an unknown game
(`Game not found`). The payload is a plain `message` string — there are **no error
codes and no `fatal` flag**; the server never closes the socket on an `ERROR`.

### 8. BROADCAST (Server → Client)

`broadcastToAll()` fans an event out to **every** connected client wrapped as
`{ type: 'BROADCAST', payload: <event> }`. It is part of the handler surface but has
no in-repo caller today; do not rely on receiving it.

---

## Delivery Semantics

- **One game per connection.** A `JOIN_GAME` (or gameId-`SUBSCRIBE`) replaces the
  previous per-game subscription.
- **Spectator semantics.** The joiner receives the game's events, including its own
  submissions (no self-exclusion).
- **Live only.** A client that connects mid-game receives `GAME_STATE` once (if the
  game exists) and then only *future* events. Past events are not replayed over the
  WS — fetch them via REST: `GET /api/v1/games/:gameId/events` (JSON, visibility
  filtered) or `GET /api/v1/games/:gameId/replay`.
- **Disconnect cleanup.** On socket close the EventBus subscription is torn down and
  the client record dropped. No server-side state survives the connection.

## Related Live Surfaces

- **SSE:** `GET /api/v1/games/:gameId/events` with `Accept: text/event-stream`
  streams the same EventBus events as raw `data:` JSON frames (plus an initial
  `{type:'connected'}` frame and 30 s `: keepalive` comments). Also unfiltered by
  visibility.
- **REST:** the same route without the SSE header returns the full event list as JSON
  (visibility filtered); `/replay` returns chronologically sorted events.

---

<a name="planned-not-implemented"></a>
## PLANNED / NOT IMPLEMENTED

**None of the following exists in the code.** Earlier drafts of this document
described them as if shipped; they are design targets only. There is no `TODO` branch
carrying them — treat every item as unbuilt until a commit says otherwise.

| Planned feature | Status |
|---|---|
| Per-game URL `ws://…/ws/:gameId` | **NOT IMPLEMENTED.** The server mounts exactly one path, `/ws`; a per-game request path 404s at the HTTP upgrade. Game selection is the `JOIN_GAME` message. |
| `SUBSCRIBE` with `viewMode` / `authToken` | **NOT IMPLEMENTED.** No view modes, no auth, no token downgrade on the WS path. |
| `SUBSCRIBED` carrying `currentSeq`, `status`, `phase`, `dayNumber`, `aliveCount`, `winner`, `missedEvents` | **NOT IMPLEMENTED.** Live ack payload is `{ eventTypes }` or `{ eventTypes, gameId }` only. |
| `lastSeq` resume + server-side event ring buffer | **NOT IMPLEMENTED.** No `EventBuffer` class exists; the EventBus keeps an in-memory history for its own API, but the WS layer never reads it. Drafts disagreed on capacity (100 vs 1000) — moot until built. |
| `HEARTBEAT` frame with `gameStatus` | **NOT IMPLEMENTED.** No server-initiated keepalive of any kind. |
| `PONG` with `serverSeq` / `roundTripMs`, `PING` with `clientSeq` | **NOT IMPLEMENTED.** Both payloads are empty. |
| `ERROR` code taxonomy (`INVALID_GAME_ID`, `SEQUENCE_OUT_OF_RANGE`, …) and `fatal` flag | **NOT IMPLEMENTED.** `ERROR` carries a human-readable `message` only. |
| Sequence-gap detection / client replay via `?fromSeq=` | **NOT IMPLEMENTED.** Events carry `metadata.sequence`, but nothing consumes it. |
| `SNAPSHOT` message (snapshot + delta catch-up) | **NOT IMPLEMENTED.** |
| Bulk stream fetch `GET /api/games/:gameId/stream` | **NOT IMPLEMENTED.** The live catch-up equivalents are the REST `/events` and `/replay` endpoints listed above. |
| Visibility filtering on WS delivery (`PRIVATE`/`ADMIN` withheld from non-admins) | **NOT IMPLEMENTED** on the WS/SSE paths (REST `/events` filters). |
| Performance targets (<10 ms broadcast, 1000 eps burst, 100 conns/game) | **ASPIRATIONAL.** No measurements back these numbers. |

If you need any of the above, file a board row (MAF-GAP-*) rather than assuming it
exists — and when it lands, move it out of this section with grep-verified message
types from `apps/server/src/websocket/index.ts`.
