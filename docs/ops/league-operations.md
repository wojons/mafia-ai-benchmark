# League operations

The league schedule (MAF-INIT-002A) turns the mixed-model league runner
(MAF-LAYER-3) from a manual POST into a scheduled, budget-gated routine: a
cron entry point starts one league run per tick, the server plays the games
sequentially to a terminal status, and every completed game lands in the
per-run JSONL corpus (`data/runs/`). This note is the operator contract for
that loop: what plays, what it costs, how it is gated, and how to verify it
after each tick.

Artifacts:

| Artifact | Purpose |
|---|---|
| `scripts/league-schedule.json` | the ratified schedule config (pool, players, games, caps, poll timings) |
| `scripts/league-cron.sh` | cron entry point: cap gate → POST → poll → export; `--dry-run` validates without any request |
| `docs/ops/league-operations.md` | this note |

Parent initiative: **MAF-INIT-002** (mixed-model league benchmarking). This
leg arms the schedule; what remains after it is listed in §6.

---

## 1. Ratified pool and cap

`scripts/league-schedule.json`:

| Field | Value | Meaning |
|---|---|---|
| `models` | `openai/qwen3.6-35b-fast`, `openai/gpt-4o-mini` | the two model specs shuffled across the game's role-group seats each round |
| `numPlayers` | 10 | seats per game (server bounds: 5..50; a 10-player game spawns 5 role groups: MAFIA, SHERIFF, DOCTOR, VIGILANTE, VILLAGER) |
| `gamesPerRun` | 2 | rounds played sequentially per league run |
| `budgetUsdPerRun` | 0.80 | hard spend cap in USD per league run (server-enforced) |
| `dailyCapUsd` | 5.00 | client-side daily spend ceiling across runs (cron-gated) |
| `pollIntervalS` | 30 | seconds between status polls |
| `pollTimeoutS` | 5400 | give up (log as FAILED, exit 1) after 90 minutes |

### Why these two models

The live server (docker container `mafia-ai-benchmark-server-1`) plays games
**only** through its configured OpenAI-compatible lane:
`OPENAI_BASE_URL=https://openrouter.ai/api/v1` with an OpenRouter
`OPENAI_API_KEY` and `MODEL=qwen3.6-35b-fast`. Both ratified models are
OpenRouter-callable from that env, which is the property that matters:

- `openai/qwen3.6-35b-fast` is the server's current `DEFAULT_MODEL` — it is
  the lane the engine already exercises end to end.
- `openai/gpt-4o-mini` is the most heavily represented model in the
  historical run corpus (`data/runs/index.jsonl`; as measured 2026-11-25 the
  index holds 4,889 rows and `openai/gpt-4o-mini` is the attributed seat
  model in the large majority of them). Note the corpus predates MAF-INIT-001
  seat attribution, so `provenance` labels there are `null` — proper
  attribution arrives with the league exports (§5).

The **xkiro generation pool** proposed in MAF-INIT-002 is **not** callable
from the server env (no xkiro credentials exist server-side). It stays
documented as the **target pool pending server credentials** — a future leg
arms it once the server's env can reach it. It is not part of the ratified,
executable pool and must never be described as live.

---

## 2. Cap math

Two independent gates bound the spend:

1. **Per run (server-side):** `budgetUsdPerRun = 0.80` is a hard cap the
   league runner enforces — it stops creating new games the moment the run's
   recorded `token_usage` spend reaches it (terminal status `BUDGET_CAPPED`).
   The client records 0.80 per run as an **upper bound**; actual spend is ≤
   that bound.
2. **Per day (client-side):** the script keeps
   `$LEAGUE_STATE_DIR/daily-spend.json` (`{"date": "...", "spendUsd": N}`,
   reset when the date rolls over) and skips the run — logging `SKIP daily
   cap`, exit 0 — when `spendUsd + budgetUsdPerRun > dailyCapUsd`.

At the recommended **4-hour cadence** a day holds at most 6 runs:

```
0.80 USD/run x 6 runs/day = 4.80 USD/day  <  5.00 USD/day (dailyCapUsd)
```

The 7th run of a day is refused by the gate (`4.80 + 0.80 = 5.60 > 5.00`), so
the worst client-approved day is 4.80 USD. On top of that, `gamesPerRun = 2`
with a 0.80 budget usually caps a run below the bound — `BUDGET_CAPPED` is a
normal, successful ending, not a failure.

---

## 3. Installing the cron line

The cron line below is the deployment the **foreman installs** — this leg
does NOT install it. When installing, point it at the main checkout:

```
7 */4 * * * /home/kara/wojons/mafia-ai-benchmark/scripts/league-cron.sh >> /home/kara/.local/state/mafia-league/cron.log 2>&1 # mafia league schedule (MAF-INIT-002A)
```

Operational notes:

- The script needs `jq`, `curl`, `node`, and (only if `apps/cli/dist` is
  missing) `pnpm` on the cron user's PATH. If the CLI dist is already built,
  `node` + `jq` + `curl` suffice.
- Every step is logged with timestamps to
  `$LEAGUE_STATE_DIR/league-$(date +%F).log` (override with `LEAGUE_LOG`),
  independent of where stdout goes.
- `--dry-run` validates the config and prints the resolved plan (including
  the exact POST body) with **no network request** — use it after any config
  edit and before installing the line.

What one real-mode invocation does, in order:

1. Daily-cap gate (§2) — skip is a clean exit 0.
2. `POST /api/v1/league` with `{"config": {"models": [...], "games":
   gamesPerRun, "budgetUsd": budgetUsdPerRun, "numPlayers": numPlayers}}`;
   captures `data.leagueId` from the 201 envelope. Non-2xx → log status +
   body, exit 1.
3. Records the 0.80 upper bound into the daily-spend state file.
4. Polls `GET /api/v1/league/<id>` every 30 s until the status is terminal —
   the server's terminal set is `COMPLETED`, `FAILED`, `CANCELLED`,
   `BUDGET_CAPPED` (`league-runner.ts` `TERMINAL_LEAGUE_STATUSES`). A poll
   timeout (90 min) is logged as FAILED, exit 1.
5. Exports each detail game that finished (non-null `completedAt`, null
   `error`) via `node apps/cli/dist/index.js runs export <gameId> --server
   <url>` from the repo root — this appends one line per game to
   `data/runs/index.jsonl` (the `data/runs` tree is gitignored). A per-game
   export failure is logged and does not stop the remaining exports.

---

## 4. Request/response shapes (source of truth)

Mirrored from the server source; if the routes change, update
`scripts/league-cron.sh` and this note together.

- `POST /api/v1/league` → `201 {"success": true, "data": {"leagueId", "games", "models", "seatGroups", "message"}}`; validation failures are `400 {"success": false, "error": "..."}`.
- `GET /api/v1/league` → `{"success": true, "data": [ <league status>... ]}`.
- `GET /api/v1/league/:id` → `{"success": true, "data": {"status": {"leagueId", "status", "config", ...}, "games": [{"gameId", "round", "seatMap", "winner", "completedAt", "error", "costUsd", "totalTokens"}...], "spend": {"spentUsd", "budgetUsd", "remainingUsd", "capped"}}}`.

---

## 5. Verification steps

After scheduled runs have fired, verify the loop end to end:

1. **League runs exist.** `curl -s http://localhost:3004/api/v1/league | jq`.
   The list envelope is `{"success": true, "data": [...]}`, most recent run
   first, capped at the 50 most recent server-side (`league-runner.ts`
   `listLeagues()` uses `LIMIT 50` and the route ignores query parameters —
   a `?limit=N` parameter is **not** implemented; `?limit=5` is harmless but
   does nothing). Check the newest rows: `status` should be
   `COMPLETED` (or `BUDGET_CAPPED`), and `config.models` should show both
   ratified specs.

2. **Fresh mixed rows in the corpus.** `tail data/runs/index.jsonl` (from the
   repo root). New league exports append one line per game:

   ```json
   {"game_id": "...", "path": "<game_id>.jsonl", "started_at": "...", "winner": "...", "provenance": "mixed", "seats": [{"seat": 1, "provider": "openai", "model": "gpt-4o-mini", "role": "MAFIA", ...}]}
   ```

   Per-seat provider+model provenance lives in `seats[]` (`provider`,
   `model`, `role`); `provenance` is the derived seat-attribution label —
   `mixed` means every seat is attributed across ≥ 2 distinct
   (provider, model) pairs, which is exactly what a scheduled league run
   should produce. The historical rows in the index carry `provenance: null`
   (the corpus predates attribution), so any fresh `"provenance": "mixed"`
   row is unambiguously a new league export.

3. **Site leaderboard — honest state.** The static benchmark site (run index,
   per-run replays, leaderboard) is published to the `gh-pages` branch
   (pushed at `bd97d5d`). **GitHub Pages is NOT enabled yet** — enabling it
   is an admin-gated repository setting. There is no live URL to check;
   treat the leaderboard as pending until Pages is switched on. Do not
   claim or advertise a URL before that.

4. **Spend sanity.** `cat ~/.local/state/mafia-league/daily-spend.json` —
   `spendUsd` grows by at most 0.80 per run and resets on date rollover;
   `league-runner`'s own rollup (`data.spend.spentUsd` in the league detail)
   is the authoritative actual spend per run.

---

## 6. What remains (MAF-INIT-002 acceptance context)

This leg arms the schedule with the executable OpenRouter pool. Remaining
toward the parent initiative's acceptance criteria:

- **20 fresh mixed games** accumulate via the installed schedule (at 2 games
  per run, that is ~10 runs ≈ 2 days at the 4-hour cadence — gated only by
  the daily cap, which this plan never touches).
- A **weekly operating note** follows once the corpus has accumulated
  (win rates, spend, provenance quality).
- The **xkiro generation pool** joins the rotation when server credentials
  for it exist (pending; see §1).

Verification plumbing note: `data/runs/` is gitignored — the corpus is a
host artifact, not a repo one; treat `data/runs/index.jsonl` as the append
ledger and the per-game `<game_id>.jsonl` files as the records.
