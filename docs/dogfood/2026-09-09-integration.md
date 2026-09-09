# Dogfood Integration Report — 2026-09-09 (fresh-install run)

**Verdict: 🟡 PROMISING-BUT-ROUGH** — the product works when it is already
running; getting it running from a fresh clone does not follow the docs.

This run's focus was different from the previous four (08-06, 08-15, 08-24,
09-01/09-04): instead of re-probing the happy path on the fleet stack, we
tested **installability** — can a fresh user on a clean machine go from
`git clone` to a finished game using only the project's own docs? Answer:
not without three undocumented repairs.

## Environment (the "fresh user")

- Ephemeral bunker agent `df91d464` on **bunker-las-04** (Debian 13 trixie,
  Docker 26.1.5 present, **no** node/pnpm preinstalled, non-root, no sudo).
- Node v20.19.4 + pnpm 9.15.9 installed locally (docs say "Node ≥ 20, pnpm"
  — this part of the prerequisites is accurate).
- `git clone https://github.com/wojons/mafia-ai-benchmark.git` → **public
  clone works**, HEAD `b6f97bd` (matches the fleet checkout exactly).

> Site note: the standard bunker host las-bunker-03 was unreachable (ssh
> connect timeout ×2) and las-02's port pool was exhausted (pool of 1 range,
> zero agents listed — the same chronic failure already tracked on the
> board). Ran on las-04 per the Bane-approved fallback; agent destroyed
> cleanly after the run.

## What the docs say vs what happens

| Step (QUICK_START.md "5 minute setup") | Result on fresh clone |
|---|---|
| `pnpm install` | ✅ 17 s, clean |
| `echo 'OPENAI_API_KEY=…' >> .env` | ✅ works |
| `pnpm run server` | ❌ **crash 1**: `Cannot find module '@mafia/shared/dist/fsm/index.js'` — `@mafia/shared` resolves to `dist/` built output; **QUICK_START never says `pnpm build`** (only the README TL;DR does) |
| `pnpm build` (from README, 15 s) then `pnpm run server` | ❌ **crash 2**: `Failed to start server: TypeError: Cannot open database because the directory does not exist` — `apps/server/src/index.ts:41` opens `./data/mafia.db`, nothing mkdirs it on a fresh clone (the Docker path masks this with a volume) |
| `mkdir data` (the obvious guess) | ❌ **crash 2 again** — the root `server` script runs with cwd `apps/server`, so the dir that must exist is `apps/server/data` |
| `mkdir -p apps/server/data` + `pnpm run server` | ✅ healthy on `:3004` |

**Time-to-first-success from clone: ~6 min of which ~5 min was diagnosing
three undocumented failure modes.** Pure install time is 17 s install +
15 s build + 2 s server start — the product is fast; the docs are the bug.

## The real-use smoke (all documented commands, no source reading)

```bash
pnpm --filter @mafia/cli dev -- run-game --players 5 --yes
# → Game ID: 27ed9f46-c90b-44aa-b17f-f8b934bdd82f  (exit 0, 1 s)
```

Game auto-played on the server with real LLM calls and finished ENDED in
~99 s. Verified via the API on the fresh install:

- `GET /api/v1/games/27ed9f46…` → `status=ENDED`, `winner=TOWN`, and
  per-player `role` / `won` / `isAlive` all correct
  (MAFIA/L/alive=false, DOCTOR/W, SHERIFF/W, VILLAGER/W ×2).
- `GET /api/v1/games/…/events` → 27 events, full lifecycle
  `GAME_STARTED → PHASE_CHANGED → AGENT_SAYS×12 → NIGHT_ACTION×3 →
  MORNING_REVEAL → VOTE_CAST×5 → PLAYER_LYNCHED → GAME_ENDED`.
  **12/12 AGENT_SAYS events carry non-empty `data.says`** with real persona
  dialogue; `data.think` non-empty in 2/12 (split-pane present, THINK still
  sparse — matches the 08-15 degenerate-output concern at small scale).
- `GET /api/v1/stats` → `{totalGames:1, completedGames:1, avgDuration:99,
  townWins:1}` — **no fabricated fallback** on a near-empty DB (the old
  MAF-GAP-012 trap stays closed).

Event payload note for API consumers: dialogue text lives in
`event.data.{think,says}` — there is no `payload` key. (Our first probe
looked for `payload` and read 12 "empty" events; the data was there.)

## Verifications against the fleet stack (:3004, image built 08-25)

- **DF-MAFIA-AI-BENCHMARK-1 (CLI flags/timeout) — fix VERIFIED.** Through
  the exact documented invocation (`pnpm --filter @mafia/cli dev --`):
  `--server http://localhost:1` is honored (connection refused — no silent
  fallback to :3004), `--timeout -5` rejected before any server call. The
  pnpm `--` separator strip in `apps/cli/src/index.ts:83` works.
- **DF-MAFIA-AI-BENCHMARK-2 (compare doubles wins) — RECONFIRMED LIVE and
  worse than reported.** `GET /api/v1/benchmark/compare`:
  `openai/gpt-4o-mini gamesPlayed=981 wins=3745 winRate=3.82`; gpt-4o
  winRate=4.45. DB ground truth: 4114 winning player-rows vs 978 distinct
  won games. `gamesPlayed` uses `COUNT(DISTINCT game_id)`; `wins` still
  uses `SUM(CASE WHEN p.won=1 …)` in
  `apps/server/src/services/stats-collector/models.ts` (modelQuery AND
  roleQuery). Row reopened with acceptance criteria.
- **DF-MAFIA-AI-BENCHMARK-3 (durable runs) — closure was FALSE; REOPENED.**
  `benchmark_runs`: 235 COMPLETED / 2 CANCELLED / **18 RUNNING, all stale
  (>30 min untouched, most weeks old)** — across one server restart 2 days
  ago. No startup sweep/rehydration exists in `benchmark-runner.ts`;
  completion rides in-process event subscriptions only. The 09-07 closure
  cited dd63a31, which touched only `apps/cli` files — the QA row's
  challenge was correct.
- **MAF-GAP-056 fix is deployed**: live game detail now returns `winner`
  and per-player `won`/`role` (the 08-24-era skill note about hidden
  results is stale — refreshed in this run).

## What we'd tell the maintainer (1 hour of their time)

1. Fix `wins` in `models.ts` to `COUNT(DISTINCT CASE WHEN p.won=1 THEN
   p.game_id END)` — the headline metric of a benchmark project reporting
   382% win rates is the single worst defect (30 min incl. test).
2. Startup sweep for stale RUNNING benchmark runs (20 min).
3. `mkdirSync(dirname(dbPath), {recursive:true})` before opening the DB +
   add `pnpm build` to QUICK_START (10 min, makes the docs true).

## Run provenance

- Control host: local checkout `/home/kara/mafia-ai-benchmark` @ `b6f97bd`.
- Bunker: agent `df91d464` @ bunker-las-04 (100.95.199.98), ttl 2h,
  **destroyed** after the smoke (`bunker destroy` → "No agents found").
- Live stack probes: `http://localhost:3004` (compose, image 2026-08-25).
- Board rows written: DF-MAFIA-AI-BENCHMARK-2 (reopened P0, reconfirmed),
  -3 (reopened P0, false closure), -6 (new P1, fresh-install path),
  -7 (new P2, Docker path undocumented).
