# Dogfood Integration — 2026-10-12 (REV-001 / REV-004 verification + WS spectate re-proof)

**Tick:** mafia-ai-benchmark-dogfood-2026-10-12-22-22-14 · **HEAD:** 1ef0310 (origin/main parity) · **Verdict: SHIPPABLE on the default deployment; one P0 on the opt-in secure path (DF-34)**

## Promise under test

"Create/watch AI Mafia games via API :3004 / web :5174 with trustworthy per-model stats; opt-in `ADMIN_AUTH_TOKEN` hides private/role data."

This tick's angle: the 2026-09-26 dogfood predates two shipped features (MAF-REV-001 input validation, MAF-REV-004 admin auth) and the DF-16 WebSocket fix (landed after 09-26's live FAIL re-proof). All three surfaces got their first real-user drive here.

## What works (verified live, commands included)

### 1. WS live spectate — closed P0 DF-16 re-proven PASS

```bash
GID=$(curl -s -X POST http://127.0.0.1:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"numPlayers":10,"engineType":"legacy","roleModels":{}}' | jq -r .data.gameId)
# spectator joins ws://127.0.0.1:3004/ws and sends {"type":"JOIN_GAME","payload":{"gameId":GID}}
```

Joined at t+10ms → CONNECTED, GAME_JOINED, GAME_STATE, then 160 GAME_EVENTs
streaming over 217s through GAME_ENDED (winner=TOWN, day 2). Zero missed
events, no replay gap. The 09-26 zero-event P0 is genuinely fixed. Caveat for
tool authors: Node 22's native WebSocket uses `addEventListener` (not `.on()`),
and `ws` is NOT hoisted to the pnpm root — a standalone spectator must use the
native API or run from inside the repo's dependency tree.

### 2. MAF-REV-001 create validation — exact 400s on the top-level shape

| payload | result |
|---|---|
| `{"numPlayers":2}` | 400 `Invalid numPlayers 2. Must be an integer between 5 and 15` |
| `{"numPlayers":"abc"}` | 400 same shape, value quoted |
| `{"numPlayers":null}` | 400 (explicit null is a client error, not a default) |
| `{"engineType":"bogus"}` | 400 `Valid values: legacy, native` |
| `{"roleModels":{"MAFIA":123}}` | 400 naming the role and both accepted shapes |

### 3. MAF-REV-004 admin auth — contract verified on an isolated instance

Isolated boot (own port/DB, repo's own `.env` for the LLM key, token in env
only, instance killed after the test):

```bash
cd ~/wojons/mafia-ai-benchmark && set -a && . ./.env && set +a && \
PORT=3117 DB_PATH=/tmp/mafia-dogfood-test.db ADMIN_AUTH_TOKEN=<token> node apps/server/dist/index.js
```

- create without token → 401 `{"success":false,"error":"unauthorized"}`; with `Authorization: Bearer` or `X-Admin-Token` → 201; wrong token → 401.
- `GET /games/:id/events?visibility=admin` without token → 401 (the `publicOnlyFallbackVisibility` clamp, routes/games.ts:138-143); with token → 200.
- `visibility=all`/`admin` = unfiltered; `public`/`private` filter. With auth DISABLED (the default), ADMIN-visibility events are served to anonymous HTTP clients BY DESIGN (REV-004 is opt-in).

### 4. Fresh install (bunker-mvp, bare Debian user, throwaway agent)

git clone 1s (public repo) → pnpm install 12.4s → pnpm build 4/4 33s → server
boot → `GET /api/v1/games` 200. install_seconds≈49 excluding the node
bootstrap. Notes: fresh box has NO node/pnpm — QUICK_START's Prerequisites
names Node 20+ and gives a sudo-less pnpm installer, but no sudo-less node
install (minor docs gap, folded into DF-35's doc cluster). Agent destroyed,
nothing left behind.

## What does NOT work (new rows)

- **DF-34 (P0): WebSocket bypasses ADMIN_AUTH_TOKEN.** On the auth-ENABLED
  instance, an anonymous WS joiner received 10 GAME_EVENTs in 45s — 8 marked
  `visibility:ADMIN`, including `data.role:"MAFIA"` attribution and private
  think text ("My vote is for Santiago Karam"). The clamp exists only in
  routes/games.ts + middleware/auth.ts; apps/server/src/websocket/index.ts has
  no auth/visibility handling (join = raw EventBus feed, :224-240). Fix
  direction in the row.
- **DF-35 (P2): the spec teaches a create shape the server ignores.**
  `specs/api-specs.md:26-41` documents nested `config.numPlayers:10` → live
  201 with `"numPlayers":5`, silently. The route reads only top-level
  `numPlayers` (routes/games.ts:441); the dashboard posts top-level, so only
  doc-followers hit the trap. benchmark-runner already reads `config.numPlayers`
  (services/benchmark-runner.ts:979), so nested support is an established
  pattern — resolve or reject loudly.

## Stats truth spot-check

Both fresh games persisted `games.winner` (`TOWN`/`TOWN`) with consistent
`players.won` rows (8/10 town win) — the DF-26 empty-winner hole does not
reproduce on new games. `GET /api/v1/benchmark/report` still costs 1.2-1.7s
warm (PERF-MAFIA-2, filed by the concurrent lane on the same night — their
numbers match mine).

## Perf (nothing new fileable)

Reads `games?limit=50` 45-55ms · `stats` 0.40-0.43s ×5 stable at 4009
games/14257 players/129646 events · validation 400-path 1.3ms · events (161
rows) 4.7ms. Nothing a user would feel; no PERF row filed from this lane.

## Concurrent-lane note

A second dogfood lane ticked the same project tonight and filed DF-31 (blank
watch view), DF-32 (Games-tab page counts), DF-33 (ghost model rows), and
PERF-MAFIA-2 while this lane was mid-run; the id space collided and this
lane's rows were renumbered DF-34/DF-35 (theirs byte-untouched). Read both
lanes' entries in `.coding-hermes/dogfood-log.md` for the full picture.
