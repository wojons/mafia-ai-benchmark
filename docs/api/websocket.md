# WebSocket Protocol (`/ws`)

The real-time game event stream. Extracted from the live implementation in
`apps/server/src/websocket/index.ts` (this file documents what the code
actually accepts — see that file as the source of truth).

## Connection

```
ws://HOST:3004/ws
```

The server mounts a `WebSocketServer` on the shared HTTP server with
`path: '/ws'` (see `apps/server/src/index.ts`). No authentication is
required. On connect the server immediately sends:

```json
{
  "type": "CONNECTED",
  "payload": { "clientId": "<uuid>" },
  "timestamp": "2026-09-24T09:00:00.000Z"
}
```

## Message envelope

Every message (both directions) is a JSON object of the shape:

| Field       | Type                    | Required | Notes                                    |
| ----------- | ----------------------- | -------- | ---------------------------------------- |
| `type`      | string                  | yes      | One of the message types below           |
| `payload`   | object                  | yes      | Type-specific payload (may be `{}`)      |
| `requestId` | string                  | no       | Echoed back on every server response     |

Every server response carries a `timestamp` (ISO string) and echoes the
`requestId` from the triggering client message when one was supplied.

> Note: a message that is not valid JSON, or a message with an unknown
> `type`, is answered with an `ERROR` message — it never closes the socket.

## Client → Server message types

### `PING`

Heartbeat probe. Payload is ignored; send `{}`.

```json
{ "type": "PING", "payload": {} }
```

Response:

```json
{ "type": "PONG", "payload": {}, "timestamp": "..." }
```

### `SUBSCRIBE`

Add one or more event types to this client's subscription set. Non-array
`eventTypes` payloads are ignored silently (no error, no subscription).

```json
{ "type": "SUBSCRIBE", "payload": { "eventTypes": ["PHASE_CHANGED", "VOTE_CAST"] } }
```

Response:

```json
{ "type": "SUBSCRIBED", "payload": { "eventTypes": ["PHASE_CHANGED", "VOTE_CAST"] }, "timestamp": "..." }
```

### `UNSUBSCRIBE`

Remove event types from the subscription set. Same payload/response shape
as `SUBSCRIBE`, with the confirmation type `UNSUBSCRIBED`.

### `JOIN_GAME`

Join a game room: sets the client's `gameId`, subscribes the client to the
`game:<gameId>` event channel, and replies with the current state.

```json
{ "type": "JOIN_GAME", "payload": { "gameId": "8e6e0ac0-..." } }
```

Responses (two messages, in order):

```json
{ "type": "GAME_JOINED", "payload": { "gameId": "8e6e0ac0-..." }, "timestamp": "..." }
{ "type": "GAME_STATE", "payload": { "state": { /* GameState */ } }, "timestamp": "..." }
```

`GAME_STATE` is only sent when the engine reports a state for the id.

### `LEAVE_GAME`

Leave the current game room. Payload is ignored.

```json
{ "type": "LEAVE_GAME", "payload": {} }
```

Response:

```json
{ "type": "GAME_LEFT", "payload": {}, "timestamp": "..." }
```

### `SEND_ACTION`

Submit a game action for the joined game. Requires a prior `JOIN_GAME`;
otherwise the server answers `ERROR` with `"Not in a game"`.

```json
{
  "type": "SEND_ACTION",
  "payload": {
    "actionType": "VOTE",
    "targetId": "p2",
    "voterId": "p1"
  },
  "requestId": "req-1"
}
```

Supported `actionType` values and the extra payload fields each one reads:

| `actionType`    | Extra payload fields                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| `VOTE`          | `voterId`, `targetId`                                                            |
| `NIGHT_ACTION`  | `playerId`, `action`, `targetId`                                                 |
| `ACCUSATION`    | `accuserId`, `targetId`, `accusation`, `evidence`                                |
| `ROLE_CLAIM`    | `playerId`, `role` (`MAFIA` \| `DOCTOR` \| `SHERIFF` \| `VIGILANTE` \| `VILLAGER`) |

Success response:

```json
{ "type": "ACTION_SENT", "payload": { "actionType": "VOTE", "targetId": "p2" }, "timestamp": "...", "requestId": "req-1" }
```

When the engine throws on the action the server answers `ERROR` with
`"Failed to send action"`.

### `REQUEST_STATE`

Fetch the current state of a game without joining it.

```json
{ "type": "REQUEST_STATE", "payload": { "gameId": "8e6e0ac0-..." } }
```

Responses: `GAME_STATE` (payload `{ state }`) when found, otherwise `ERROR`
with `"Game not found"`.

## Unknown / malformed messages

```json
{ "type": "SOMETHING_ELSE", "payload": {} }
```

→

```json
{ "type": "ERROR", "payload": { "message": "Unknown message type: SOMETHING_ELSE" }, "timestamp": "..." }
```

A message that fails `JSON.parse` (or omits `type` entirely — `type` is then
`undefined`) answers:

```json
{ "type": "ERROR", "payload": { "message": "Invalid message format" }, "timestamp": "..." }
```

## Server-pushed messages

| Type         | When                                            | Payload                       |
| ------------ | ----------------------------------------------- | ----------------------------- |
| `CONNECTED`  | immediately after the socket opens              | `{ clientId }`                |
| `GAME_STATE` | on `JOIN_GAME` / `REQUEST_STATE`                | `{ state }`                   |
| `GAME_EVENT` | any event published to a joined game's channel  | the raw event object          |
| `BROADCAST`  | server-wide fan-out (`broadcastToAll`)          | the raw event object          |
| `ERROR`      | unknown type, invalid JSON, or action failure   | `{ message }`                 |

`GAME_EVENT` frames are only delivered to clients whose `gameId` matches the
event's game, and the client that triggered the event is excluded from its
own fan-out.

## Quick probe

```bash
node -e "
const ws = new (require('ws'))('ws://localhost:3004/ws');
ws.on('message', (m) => console.log('<<', m.toString()));
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'PING', payload: {} }));
  ws.send(JSON.stringify({ type: 'BOGUS', payload: {} }));
});
"
```

Expected output: the `CONNECTED` greeting, a `PONG`, and an
`Unknown message type: BOGUS` error.