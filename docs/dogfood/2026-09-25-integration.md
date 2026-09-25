# Dogfood integration report — 2026-09-25 — post-fix user journey + WebSocket live surface

Tick: mafia-ai-benchmark-dogfood-2026-09-25-07-33-32
Angle (4th run, so a new surface): the flows the tick-202 foreman just rewired
(DF-11/13/14/15) exercised as a real user, plus the never-before-tested WebSocket
live-spectate surface. All four prior runs touched CLI/API/install; none had ever
connected to `/ws` or driven the create→watch loop in a browser.

## What I did as a user

1. Opened the dashboard (:5174) in a real browser session.
2. Clicked sidebar "New Game" → navigated to `/?action=new`, no modal (dead link,
   DF-13 fix undeployed).
3. Clicked header "➕ New Game" → modal opened (this works even in the old bundle),
   set players=5, clicked "Create Game" → landed on `/game/undefined`
   (DF-10, still live). The game WAS created server-side (orphaned from the UI).
4. Game 2880c6ab: created via UI defaults (deepseek-v4-flash per role). Result:
   degenerate — every THINK `[Private] Thinking about the game.`, every SAYS `''`,
   85 parse-failure retries, ENDED winner=MAFIA in 81s. Ingested into real stats
   unmarked.
5. Game e398fa84 + 96f512bc: created via API with
   `qwen/qwen3-coder-next` for all roles. Real dialogue, real votes/lynch, ~2min
   each, TOWN won both. BUT every turn still hit a JSON parse retry (1/1) — the
   documented "✅ Reliable" model is no longer parse-clean.
6. Watched game 2880c6ab live from the spectate page for 75s: page froze at
   Turn 41 / 2-of-5 players while the game advanced and ENDED server-side; the
   page only noticed the end later, and a manual reload still showed empty
   votes/discussion/events (40 events in the API).
7. WS probe (node, `ws` module from apps/server/node_modules): connected,
   SUBSCRIBED with {gameId}, got SUBSCRIBED ack, received 0 game-event frames
   during a full live game. Server-side defect, see DF-16 for the file:line chain.
8. Timed the headline reads: `GET /api/v1/games?limit=50` 37.3ms ±3.7 (n=20);
   `GET /api/v1/stats` 66.3ms ±4.5 (n=20); events ~2ms; web TTFB 0.5ms; browser
   DCL 60ms, 0 longtasks. Nothing slow enough to file as PERF — the felt slowness
   is the frozen live view (DF-16) and stale data (DF-17), not latency.

## What works (engine + API layer is genuinely good)

- Creating games via `POST /api/v1/games` with per-role `roleModels`: clean,
  fast, documented.
- The legacy engine plays complete games with a good model: roles assigned,
  night actions, discussion, votes, lynch, winner persisted, events stored with
  correct visibility (night mafia chat PRIVATE, day chat PUBLIC — split-pane
  intact).
- REST event history is complete and the spectator-hydration data is all there —
  the fixes exist; they are just not deployed (DF-17) and the live channel is
  broken at the server (DF-16).

## The right way to use it TODAY (until DF-16/17 ship)

- Drive games through the API, not the web UI: create with explicit
  `roleModels`, avoid the create-modal default `deepseek-v4-flash` (degenerate
  games, wasted budget), watch via polling `GET /api/v1/games/<id>/events`
  (~2ms) — do NOT rely on `/ws` live updates or the spectate page.
- Read results through `/api/v1/games/<id>` (winner in config) and
  `/api/v1/benchmark/compare` — but remember DF-18: games played with
  parse-degraded models land in the same stats unmarked.

## Errors hit, with fixes

| Error | Cause | Fix/workaround |
|---|---|---|
| `/game/undefined` after Create | create payload `{gameId}` cast as Game with `id` (DF-10, undeployed fix) | read the real id from the POST response / games list |
| Spectate placeholders after reload | fix merged, container not rebuilt (DF-17) | poll the events API instead |
| 0 WS events despite SUBSCRIBED ack | SUBSCRIBE only registers eventTypes; JOIN_GAME subscribes a topic nothing publishes, minus the joiner (DF-16) | none — poll REST |
| `Cannot find module 'ws'` in /tmp probe | ws is a server dependency, not resolvable from /tmp | `NODE_PATH=apps/server/node_modules node probe.js` (proven) |
| bunker battery rc=127 `pnpm: not found` | bare agent, no pnpm, no sudo (DF-20) | none on-agent; host direct-run path verified instead |

## Deployment-drift verification recipe (reusable)

```bash
docker ps --format '{{.Names}} {{.CreatedAt}}' | grep mafia   # container age vs git log age
docker exec mafia-ai-benchmark-web-1 sh -c 'ls /usr/share/nginx/html/assets/'
docker exec mafia-ai-benchmark-web-1 grep -c "benchmark/compare" /usr/share/nginx/html/assets/index-*.js
# 0 hits = the running web bundle predates the stats/leaderboard fix
```
