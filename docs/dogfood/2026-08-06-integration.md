# Mafia AI Benchmark — Integration Report (2026-08-06 dogfood run)

> How to actually use this system today, what works, what is broken, and the
> errors you will hit. Written from a real user session on 2026-08-06 against
> the compose stack (server on host `:3004`, web on `:5174`).

## 1. TL;DR

| Path | Status | Verdict |
|------|--------|---------|
| HTTP API (`:3004`) — create & watch real AI games | ✅ WORKS | The only fully working surface |
| SSE / WS streaming | ✅ WORKS | `Accept: text/event-stream` on `/events`; WS at `/ws` |
| Web dashboard (`:5174`) | ✅ SERVES | SPA + nginx proxy to API works |
| CLI `mafiactl` (all documented commands) | 🔴 BROKEN | Silent no-op — see MAF-GAP-009 |
| CLI `benchmark` | 🔴 FAKE | `Math.random()` results — see MAF-GAP-010 |
| `POST /api/v1/benchmark` | 🔴 STUCK | Games never progress — see MAF-GAP-011 |
| Stats / report / cost tracking | 🟡 MISLEADING | Fabricated fallback, 0 usage rows — see MAF-GAP-012 |

## 2. The working path: HTTP API (what the docs should say)

The server runs in docker (`docker compose up -d`), API exposed on host
`:3004` (container `:3000` is NOT the mafia server — host `:3000` belongs to
another fleet daemon; this confusion is why docs were updated to `:3004`).

**Create + run a real game (auto-starts, real LLM calls):**

```bash
# 1. Create (players auto-join with generated personas, game auto-starts)
curl -X POST http://localhost:3004/api/v1/games \
  -H 'Content-Type: application/json' \
  -d '{"config":{"numPlayers":5}}'
# → {"success":true,"data":{"gameId":"<GID>","status":"starting",...}}

# 2. Watch it live (SSE)
curl -N -H 'Accept: text/event-stream' \
  http://localhost:3004/api/v1/games/<GID>/events

# 3. Poll until ENDED (~2 min for 5 players)
curl -s http://localhost:3004/api/v1/games/<GID> | python3 -m json.tool
```

A completed game emits the full lifecycle:
`GAME_STARTED → PHASE_CHANGED → NIGHT_ACTION_SUBMITTED → AGENT_SAYS_BROADCASTED`
(real THINK/SAYS split-pane content) `→ VOTE_CAST → MORNING_REVEAL → GAME_ENDED`
(with winner in `config.winner`).

**Stats:**
```bash
curl -s http://localhost:3004/api/v1/stats
curl -s "http://localhost:3004/api/v1/benchmark/report?format=json"
curl -s "http://localhost:3004/api/v1/benchmark/report?format=csv"
```

**Web:** `http://localhost:5174` (API proxied through nginx at `/api/v1`).

## 3. Errors hit and what they mean

| Error / symptom | Cause | Workaround |
|-----------------|-------|-----------|
| `mafiactl run-game ...` prints NOTHING, exit 0 | No `.action()` wiring in the command classes (MAF-GAP-009) | Use the HTTP API; `config` is the only working command |
| CLI hangs ~30s with no output (default server) | CLI defaults to `http://localhost:3000` (DuckBrain daemon), not the mafia API on `:3004` (MAF-GAP-008) | Always pass `--server http://localhost:3004` or `export MAFIA_SERVER_URL=http://localhost:3004` |
| `benchmark --quick` → `error: unknown command '--quick'` | Documented `exec tsx src/index.ts --` pattern mangles options; also benchmark has no `--server` flag at all | Don't use the CLI benchmark (fake anyway) |
| `POST /api/v1/games/:id/run` → 404 | QUICK_START documents `/run`; only `/start` exists (and games auto-start anyway) | Just POST `/api/v1/games` |
| `POST /api/v1/games/:id/players` → 404 | SYSTEM_STATUS documents it; players auto-join with personas | No action needed |
| Benchmark run never completes; no status endpoint | New GameEngine has no game loop (MAF-GAP-011) | Don't use `POST /api/v1/benchmark` yet |
| Report says qwen3.6-35b-fast 100% win rate, 0 cost | Empty stats tables trigger a hardcoded fallback (MAF-GAP-012) | Treat report numbers as untrustworthy until fixed |
| Server logs: `API 400 ... rejected response_format — retrying WITHOUT structured output` | OpenRouter rejects `response_format` for some models; the engine retries and still completes | Harmless but doubles latency; expect it in logs |

## 4. Verified facts about the environment

- `.env` needs `OPENAI_API_KEY` (OpenRouter key works), `OPENAI_BASE_URL`,
  `MODEL` (e.g. `qwen3.6-35b-fast` — cheap). Models like `openai/gpt-4o-mini`
  also work through the OpenRouter base URL.
- Games persist across container restarts: named volume
  `mafia-ai-benchmark_data` → `/app/data/mafia.db` inside the container.
- `pnpm test` at root is green (turbo, cached) — but green tests do NOT mean
  the CLI or benchmark work; see diagnostics.md.
- Default model for new games: `gpt-5.1` via `apps/cli` defaults, but the
  server's legacy engine uses its own provider config from `.env`.

## 5. One-hour maintainer priority list

1. **MAF-GAP-009 (P0):** wire `this.action(...)` in the 6 dead CLI commands —
   the flagship `run-game` is the project's front door and it is a no-op.
2. **MAF-GAP-011 (P1):** make `POST /api/v1/benchmark` actually play games
   (drive the legacy engine) or remove the endpoint.
3. **MAF-GAP-012 (P1):** stop the report from fabricating a 100%-win-rate
   model; record token/cost usage in the legacy path.
4. **MAF-GAP-010 (P1):** delete or implement the fake CLI benchmark.
5. **MAF-GAP-013 (P2):** doc/API alignment (`/run`, `/players`, `limit=`).
