# Dogfood Integration Report — 2026-09-24 (web dashboard + live spectate surface)

Run: mafia-ai-benchmark-dogfood tick 2026-09-24T13:19:34Z. This run deliberately took the
surface the previous runs (08-06, 08-15, 08-24, 08-28, 09-09) never touched: **the web
dashboard (:5174) as a spectator/user**, plus re-verification of the two P0s the foreman
closed at tick 199 and a fresh ephemeral-bunker install of the documented Docker path.

## Promise under test

README: "Manage and watch games from the browser — live game states, stats, and benchmarks."
Dashboard at :5174 (compose web), API :3004, per-model win/cost stats via /benchmark/compare.

## What works (verified live, host stack @ commit 37ff2b9)

- API fast and healthy: /health OK; games list 40ms; game detail 3ms; events 3ms;
  /benchmark/compare 130ms (all measured 3x, host stack, warm).
- DF-MAFIA-AI-BENCHMARK-2 (P0, winRate doubling) is REALLY fixed in the running container
  rebuilt 12:51Z: gpt-4o-mini winRate 0.998 (1327/1330), gpt-4o 0.75, no model has wins >
  gamesPlayed. The 09-09 382% number is gone.
- Server-side game creation + full game loop: POST /api/v1/games → roles, night actions,
  votes, lynch, GAME_OVER all recorded (27 events on a 5-player game).
- Startup reconciliation exists and runs ("Benchmark run reconciliation: 0 recovered,
  18 left active, 18 inspected" in boot log, benchmark-runner.ts reconcileStrandedRuns,
  wired at apps/server/src/index.ts:84) — see DF-MAFIA-AI-BENCHMARK-10 for its honest limit.
- POST /api/v1/benchmark/<runId>/cancel works and cleaned the two 32/35-day-old RUNNING
  zombies (now CANCELLED). Undocumented anywhere (grep README/QUICK_START/GAME_MANAGEMENT: 0).

## What is broken in the web UI (a real user hits all of these)

1. **Create Game → /game/undefined, stuck on "Loading game..." forever** (P0).
   The modal submits, the server creates the game (62f235cd IN_PROGRESS), but
   `gameStore.createGame` (apps/web/src/stores/gameStore.ts:178) returns what
   `api.games.create` gives it — `{ gameId, status, config }` (the envelope is unwrapped in
   apps/web/src/services/api.ts:38-52) — while GameList.tsx:49-56 navigates to
   `/game/${game.id}`. `id` does not exist on the payload → literal "undefined" in the URL.
   The created game is orphaned from the user's view.
2. **Finished-game spectator view is empty** (P1). /game/<id> of an ENDED game renders
   "No votes cast yet", "No statements yet", empty Recent Events — while
   GET /api/v1/games/<id>/events returns 27 events (12 statements, 5 votes, 1 lynch).
   Cause: GameWatcher.tsx:14-33 only subscribes to the WebSocket for LIVE events; it never
   calls the existing history API (api.games.getEvents, apps/web/src/services/api.ts:153).
   Watching a finished game — the README's hero use case — shows nothing.
3. **Sidebar "New Game" quick-action is dead** (P2). Sidebar.tsx:11 links `/?action=new`
   and no component consumes `action=new` (repo grep: 0 hits). Clicking it does nothing.
   Only the header button opens the create modal.
4. **Every game card shows no player count and "Phase: N/A"** (P2). GameList.tsx:151 renders
   `game.players.length` but GET /games returns `players: 5` (a number) → blank; it reads
   `game.currentState?.phase`, which the list payload does not carry → "N/A" on all 50 cards.
5. **Stats page: Model Leaderboard renders empty despite 2457 completed games** (P2).
   Totals are internally consistent (2457 = 229 mafia + 2228 town wins) but the leaderboard
   section and per-game Duration ("—" on every row) are blank.

## Benchmark integrity

A fresh install with the **placeholder API key** (`sk-or-...HERE`) plays complete games in
seconds: the bunker box produced a full lifecycle (5 votes, 5 night actions, 1 lynch) in ~8s.
This is the engine's documented canned-mock fallback (game-engine.js:714). Nothing marks
those games as mock; they flow into the same games/stats tables as real-model games. For a
**benchmark** product this silently corrupts the headline stats. Also observed: every model's
avgTokensPerGame=0 in /benchmark/compare (README advertises cost tracking) — token
accounting is not populated for these runs.

## Fresh-install verification (ephemeral bunker, las-bunker-03)

Documented Docker path (README "Docker Quick Path"), exactly as written, on a bare Debian
agent (git 2.47.3, Node 22, Docker 29.8.1 server / compose v5.5.0, no pnpm):

1. `git clone https://github.com/wojons/mafia-ai-benchmark.git ~/app` → HEAD 37ff2b9. OK.
2. `cp .env.sample .env` (placeholder key kept — testing the worst-case fresh user). OK.
3. `docker compose up -d --build` → **EXIT=0 in 167s**, server container healthy.
4. Smoke: /health OK; dashboard HTTP 200; POST /games created a real game; events flowed.

Bunker-agent gotchas that cost time (recorded in docs/dogfood/diagnostics.md):
- The agent's default docker context points at the HOST daemon (`/var/run/docker.sock`,
  permission denied). The per-agent rootless socket is
  `/run/bunker/<agent-id>/docker.sock` — `export DOCKER_HOST=unix:///run/bunker/<id>/docker.sock`
  before any compose command.
- `/tmp` on the agent is not writable by the agent user; keep scratch files in $HOME.

The 09-09 finding "Docker path untestable from docs on a bare agent (no compose plugin)"
is now FIXED on this host generation: compose v5.5.0 is present, and the documented path
succeeds end-to-end unmodified.

## Performance (Step 2b)

Headline user-visible operations, host stack, warm (3 runs each):
- Dashboard data load (GET /games?limit=50): 40ms
- Game detail (GET /games/<id>): 3ms
- Game events (GET /games/<id>/events): 3ms
- Stats data (GET /benchmark/compare): 130ms
- Browser: TTFB 3ms, DOMContentLoaded 15ms, 0 longtasks, 0 blocking ms (fresh load, :5174)
- Fresh install: 167s (compose build, cold)

Nothing here is slow enough for a user to notice; no PERF row filed. The web dashboard's
problem is correctness, not speed.

## Verdict

PROMISING-BUT-ROUGH — backend/API/benchmark core is fast, healthy, and now (post-tick-199)
statistically correct, the fresh-install path works unmodified for the first time in four
runs, but the web dashboard — the README's flagship surface — fails both of its headline
flows (create → undefined; spectate → empty) plus three lesser defects.
