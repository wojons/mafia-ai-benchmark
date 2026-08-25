# Mafia AI Benchmark — Integration Report (2026-08-24 dogfood run)

> Real-use session 2026-08-24 against the live compose stack (server `:3004`
> healthy, uptime 5d; web `:5174`). This SUPERSEDES the stale parts of
> `2026-08-15-integration.md`: per-model wins are real now, eliminations are
> visible, the CLI prints progress during benchmark runs. The remaining
> gaps are in the RESULT/READ layer (game detail hides the winner) and the
> USAGE layer (second-model usage mis-attributed). Read this one first.

## 1. TL;DR (what works today)

| Path | Status | Notes |
|------|--------|-------|
| `mafiactl run-game --players 5 --yes` | ✅ WORKS | Real game, auto-plays, ENDED |
| `mafiactl watch-game <id>` | ✅ WORKS | WS stream; **no more "Phase: undefined"** (MAF-GAP-046 fixed) |
| `mafiactl benchmark --games 1 --models A,B` | ✅ WORKS | POSTs run, **prints progress lines** ("⏳ [RUNNING] 0/1 games completed (elapsed 194s)"), exits 0; 10p game took 210 s |
| HTTP API `:3004` (games, events, SSE, stats, report, runs) | ✅ WORKS | See §3 |
| Web dashboard `:5174` (nginx proxy `/api` + `/ws`) | ✅ WORKS | Serves; API + WS proxied |
| Per-model wins in `/benchmark/report` | ✅ REAL | gpt-4o-mini 370/1025 (36.1%); incremented live during my run |
| Elimination events + `isAlive` | ✅ REAL | PLAYER_LYNCHED events, `isAlive:false` on dead, phase GAME_OVER |
| Game detail RESULT fields (`winner`/`won`/`eliminatedPlayers`) | 🔴 MISSING | Data in DB, never exposed — MAF-GAP-056 |
| Second-model usage attribution | 🔴 WRONG | gpt-4o usage recorded as phantom `openai` — MAF-GAP-057 |

Time-to-first-success: **~1 min** (CLI `list-games` → data). Full loop
(create game → watch → ENDED → report updated): **~6 min**. Friction: 8
(§4).

## 2. The working recipe (verified end-to-end)

```bash
cd /home/kara/mafia-ai-benchmark

# one-shot 5p game (no prompts; targets :3004 by default)
node apps/cli/dist/index.js run-game --players 5 --yes

# real benchmark run (pairwise, ≥2 models; progress lines now print)
node apps/cli/dist/index.js benchmark --games 1 \
  --models openai/gpt-4o-mini,openai/gpt-4o
# → ⏳ [RUNNING] 0/1 games completed (elapsed 194s)
# → 🎉 Benchmark run d7647a7c… completed — 1/1 games (1 valid, 0 failed)

# report + stats
node apps/cli/dist/index.js benchmark --quick
node apps/cli/dist/index.js stats
```

Notes:
- CLI defaults to `http://localhost:3004` (host `:3000` is a different fleet
  daemon — never point anything at it).
- `pnpm --filter @mafia/cli dev -- <cmd>` uses `tsx` (no watch now) and works,
  but `node apps/cli/dist/index.js <cmd>` is the battle-tested path.
- `--yes` skips the confirmation prompt (scripts/CI).

## 3. HTTP API — verified surface (2026-08-24)

Base: `http://localhost:3004`, uniform `{success, data}` envelope.

| Endpoint | Verified |
|---|---|
| `GET /health`, `GET /api/v1/health` | healthy, identical payload |
| `GET /api/v1/games?limit=N` | honors limit (`count=N`) |
| `GET /api/v1/games?status=X` | validates: `status=bogus` → 400 with valid vocab (SETUP, IN_PROGRESS, PAUSED, ENDED, CANCELLED) |
| `GET /api/v1/games/:id` | ENDED games: status, endedAt, currentState.phase=GAME_OVER, players with role/isMafia/isAlive/provider/model/tokensUsed/apiCalls — **but no winner/won/eliminatedPlayers** (MAF-GAP-056) |
| `GET /api/v1/games/:id/events` | full stream incl. ROLES_ASSIGNED, PHASE_CHANGED, AGENT_SAYS_BROADCASTED, NIGHT_ACTION_SUBMITTED, MORNING_REVEAL, VOTE_CAST, PLAYER_LYNCHED (with full death payload), GAME_ENDED (data.winner, mafiaAlive/townAlive) |
| `GET /api/v1/games/:id/events` + SSE | `data: {"type":"connected",…}` then events |
| `GET /api/v1/stats` | 1610 total / 97 active / 1495 completed / 18 failed; avgDuration 174 s; mafiaWins 55, townWins 856 |
| `GET /api/v1/benchmark/runs` + `/runs/:id` | real runs (runId, status RUNNING→COMPLETED, config, totalGames) |
| `GET /api/v1/benchmark/report` | summary buckets reconcile (1610 = 97+1495+18), modelPerformance with REAL wins, agentStats populated |
| `POST /api/v1/benchmark` | via CLI; run created, games played, run COMPLETED |

WS protocol: connect to `ws://localhost:3004/ws` → `{"type":"JOIN_GAME",
"payload":{"gameId":"…"}}` → `GAME_JOINED` → `GAME_STATE` + live events.
(There is no `subscribe` message type.)

## 4. Friction log (2026-08-24)

1. **Game detail hides the result** — `winner`, `won`, `eliminatedPlayers`
   absent from GET /games/:id even though the DB, config JSON, and GAME_ENDED
   event all carry them. Had to read events to learn who won. → MAF-GAP-056
2. **`games.winner` column NULL for ALL 1610 games** — summary derives
   mafiaWins/townWins from a column the legacy path never writes (it writes
   `config.winner` via `json_set`). 584/1495 completed games winnerless;
   mafiaWinRate 0.0368 deflated. Same fix as #1. → MAF-GAP-056
3. **gpt-4o usage lands on a phantom `openai` row** — token_usage rows for
   gpt-4o players carry `model='openai'`; report shows gpt-4o with 0 tokens
   and a fake 810K-token `openai` model. → MAF-GAP-057
4. **Spec drift** — api-specs.md documents `winner/aliveCount/deadCount/
   startedAt/finishedAt` on game objects; live returns none of them. → MAF-GAP-058
5. **CLI report presents unattributable as losses** — `CUSTOM/openai 0 wins
   206 LOSSES`; and "🏆 Winner" banner ignores games-played sample size. → MAF-GAP-059
6. **Minor**: `events?limit=5` ignored (returns all); run `createdAt` in
   epoch-ms; list `players` field is config.numPlayers (not live roster);
   WS `GAME_STATE.phase` lags actual play (shows SETUP during night actions).
7. **Minor**: benchmark run config says `numPlayers:10` — the game is
   created with 5 players and grows to 10 as the bridge upserts players
   progressively (detail `players` array 0→5→10 over the game).
8. **Doc whiplash**: the in-repo usage skill (`.opencode/skills/mafia-usage`)
   still said wins are "structurally 0" and eliminations "invisible" — both
   fixed. Refreshed this run.

## 5. What a new user needs to know

- **The benchmark pipeline is real end-to-end**: CLI → POST run → legacy
  engine plays real LLM games → events + usage + per-player won persisted →
  report reflects the new game within seconds (verified: gpt-4o-mini wins
  369→370, games 1024→1025 after my 10p run).
- **To get a game's winner from the API today**: parse the `GAME_ENDED`
  event (`data.winner`) or read `config.winner` — the detail body won't tell
  you (MAF-GAP-056 will fix).
- **Model rows to distrust**: rows with `wins:0` may be "unattributable"
  (legacy usage-only, no side data), not "lost every game" — the CLI shows
  them as losses (MAF-GAP-059). The bare `openai` row is gpt-4o's mislabeled
  usage (MAF-GAP-057).
- **Costs**: a 5p gpt-4o-mini game ~$0.01; a 10p benchmark game ~$0.07.
  Cheap models only for probing.

## 6. Verdict

**PROMISING-BUT-ROUGH, trending SHIPPABLE** — the game loop, CLI, API, web,
wins attribution, eliminations, and cost recording all work for real. The
remaining blockers are read-layer (winner/won not exposed) and one
attribution bug (second-model usage) — both have board tasks (MAF-GAP-056/057).
