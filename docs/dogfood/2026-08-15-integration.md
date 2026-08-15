# Mafia AI Benchmark — Integration Report (2026-08-15 dogfood run)

> Real-use session on 2026-08-15 against the live compose stack (server
> `:3004`, web `:5174`, container up 26h). This SUPERSEDES the stale parts of
> `2026-08-06-integration.md` — the CLI is no longer a silent no-op, and the
> benchmark CLI no longer fabricates numbers. Read this one first.

## 1. TL;DR (what works today)

| Path | Status | Notes |
|------|--------|-------|
| `mafiactl run-game --players 5 --yes` | ✅ WORKS | Creates a game, server plays it with real LLM calls, ENDED in ~98 s |
| `mafiactl watch-game <id>` | ✅ WORKS | WS connect + event stream (shows "Phase: undefined" — cosmetic bug, MAF-GAP-046) |
| `mafiactl benchmark --games 1 --models A,B` | ✅ WORKS | POSTs a real run, server plays 10p games, polls to completion |
| HTTP API `:3004` (games, events, SSE, stats, report, runs) | ✅ WORKS | See §3 |
| Web dashboard `:5174` | ✅ WORKS | Serves; nginx proxies `/api` + `/ws` to the server |
| Per-model win rates in `/benchmark/report` | 🔴 HOLLOW | Every row `wins:0` after 1083 games — see MAF-GAP-043 |
| Eliminations in events/detail | 🔴 MISSING | Nobody ever "dies" in the API — see MAF-GAP-044 |

Time-to-first-success: **~1 min** (`mafiactl run-game` → game created; game
ended ~98 s later). 10 friction points logged (§4).

## 2. CLI — the documented primary path now works

```bash
# one-shot game (no prompts, targets the compose API)
node apps/cli/dist/index.js run-game --players 5 --yes
# → prints config, "✅ Game started successfully!  Game ID: <gid>"
# → game auto-plays on the server; ~98 s later status=ENDED

# watch it live
node apps/cli/dist/index.js watch-game <gid>

# real benchmark run (pairwise; ≥2 models required)
node apps/cli/dist/index.js benchmark --games 1 \
  --models openai/gpt-4o-mini,openai/gpt-4o --server http://localhost:3004
# → POSTs run, polls GET /api/v1/benchmark/runs; 1-game 10p run took ~9.5 min
#   with ZERO stdout while waiting (see MAF-GAP-047)
```

Notes:
- Default `--server` is `http://localhost:3004` (fixed; host `:3000` is
  another fleet daemon, NOT this API).
- `--yes` skips the confirmation prompt (needed for scripts/CI).
- `pnpm --filter @mafia/cli game:run` and `... benchmark` scripts exist and
  work (both were broken paths before).
- Verified ENDED game `e0de506f`: 5 players, roles MAFIA/DOCTOR/SHERIFF/
  VILLAGER/VILLAGER, real per-player `tokensUsed` 6.0–11.4k, winner TOWN
  (in `config.winner` — the detail body has no top-level winner field).
- Display warts: `Night: undefineds / Day: undefineds / Voting: undefineds`
  in run-game, `Phase: undefined` in watch-game (MAF-GAP-046).

## 3. HTTP API — what actually works

Base: `http://localhost:3004`, uniform `{success, data}` envelope.

| Endpoint | Verified |
|---|---|
| `GET /health`, `GET /api/v1/health` | healthy, same payload |
| `POST /api/v1/games` `{"config":{"numPlayers":5}}` | 201; auto-starts on legacy engine |
| `GET /api/v1/games?limit=2` | honors limit (count=2) |
| `GET /api/v1/games/:id` | ENDED games: status, endedAt, players with role/isMafia/provider/model/tokensUsed/apiCalls |
| `GET /api/v1/games/:id/events` | full event stream (26 events for a 5p game) |
| `GET /api/v1/games/:id/events` + `Accept: text/event-stream` | SSE live stream (connected + events) |
| `GET /api/v1/stats` | sane: 1163 total, 1083 completed, avgDuration 197 s, mafiaWins 153 |
| `GET /api/v1/benchmark/runs` | real runs, COMPLETED/RUNNING status, config |
| `POST /api/v1/benchmark` | creates real runs (via CLI) |
| `GET /api/v1/benchmark/report` | summary + modelPerformance + agentStats + recommendations; see caveats |

Caveats found today:
- **modelPerformance wins/winRate are all 0** (see MAF-GAP-043). Summary
  `mafiaWinRate` is real (0.141). `players.won` — the field the API docs say
  wins come from — is `null` on every player of every ENDED game.
- **No elimination events**: a lynched mafia (4/5 votes) has `isAlive:true`
  and `eliminatedPlayers:[]` after the game; GAME_ENDED carries only
  `mafiaAlive`/`townAlive` counters (MAF-GAP-044).
- **Model keys fragmented**: `gpt-4o-mini`, `openai`, `openai/gpt-4o-mini`,
  `openai/gpt-4o` all present; a new gpt-4o game was credited to the `openai`
  row (MAF-GAP-045).
- `agentStats` rows are per-model with `agentId:"ALL"` — not per agent.
- avgTokens/avgCost are real for the main rows (46.9k tokens / $0.0096 per
  game for gpt-4o-mini) — cost tracking works on the new path; 17 games in
  older rows still show 0 tokens.

## 4. Friction log (10 items, in order hit)

1. `run-game` prints `Night: undefineds` etc. (config fields the API never returns).
2. `watch-game` prints `Phase: undefined` on connect.
3. `benchmark --games 1 --models <one-model>` hard-fails: "Benchmark requires
   at least 2 models, got 1." — no hint that pairwise is by design.
4. `mafiactl benchmark` emits NOTHING for the entire ~9.5 min run (no
   progress, no spinner output captured); you cannot tell it's alive.
5. Benchmark game 50eed340 hit a degenerate-output episode at Day 6: empty
   SAYS (`""`), placeholder THINK (`[Private] Thinking about the game.`), 4
   canned duplicate SAYS, ~2 min with zero persisted events, server log spam
   (`JSON parse failed ... retrying (1..3/3)`, `Unknown message type:
   undefined`). Game did complete (MAFIA win) — see MAF-GAP-042.
6. Game detail has no top-level `winner` (it's inside `config.winner`), and
   `currentState` is stale on ENDED games (phase SETUP, empty activePlayers).
7. All players of an ENDED game report `isAlive:true` even when lynched/killed.
8. Report: every model row `wins:0` — cannot compare models on win rate.
9. Report: same model under 3 different keys; 0-token rows exist.
10. Games list `players` count can disagree with the detail (9 vs 10).

## 5. Recommended first fixes (if you had 1 hour)

1. Populate `players.won` at game end → per-model win rates become real
   (MAF-GAP-043). This is THE benchmark output.
2. Emit elimination events + honest `isAlive`/`eliminatedPlayers`
   (MAF-GAP-044).
3. Quality-gate the legacy-bridge discussion path so benchmark games never
   degenerate into empty-SAYS crawls (MAF-GAP-042).
