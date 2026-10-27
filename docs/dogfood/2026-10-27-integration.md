# Mafia AI Benchmark — integration report, dogfood tick 2026-10-27

**Run:** `mafia-ai-benchmark-dogfood-2026-10-27-21-34-02` (read-only dogfood lane)
**Target:** `/home/kara/wojons/mafia-ai-benchmark` @ `1c3e8f7` (`origin/main` parity 0/0 at tick start)
**Deployment:** compose stack at HEAD — `.deploy-stamp == 1c3e8f7`, server container `StartedAt 2026-10-27T21:15:05Z`, web `21:15:11Z`
**Verdict:** 🟡 PROMISING-BUT-ROUGH — the benchmark machinery, the stats identity and the new seat/role breakdowns are honest and live; two served surfaces still sell dead games and a blended win rate as if they were real.

## The promise

> A user can benchmark AI models' Mafia ability head-to-head (`mafiactl` / API `:3004` / web `:5174`) and read trustworthy per-model win/cost statistics.

## What was driven (real use, not tests)

| Leg | What a visitor/user did | Result |
|---|---|---|
| API | `/health`, `/api/v1/{health,stats,games,models,benchmark/report,benchmark/compare}` | all 200; numbers reconciled below |
| Web | `/` (Games), `/stats`, `/benchmark`, `/watch/<id>` in a headless Chrome (CDP), text-extracted | renders; 4-5 API calls per cold page |
| CLI | the README's persistent-config block verbatim (`init --default`, `config show`, `config set numPlayers 8`, `config show`, `config reset`) via the documented `pnpm --filter @mafia/cli dev --` / `run config …` forms | `set` → `show` round-trip works (`Players: 8`); the file lands in `apps/cli/` |
| Store | read-only `better-sqlite3` census inside the running container | ground truth for the ghost and seat findings |
| Install | `bunker-qa.sh launch` on `bunker-mvp` (agent `cfa91552`, QA HEAD `1c3e8f7`, pull=ff-only ok) | see install leg below |

## Verified true at HEAD (fixes that hold)

- **Population identity (DF-41/DF-41-R2).** `report.data.summary` = `{totalGames 5077, completedGames 4389, mockGames 483, inProgress 12, failedGames 0, cancelledGames 193}` plus a `population` object; `5077 = 4389 + 483 + 12 + 0 + 193` holds arithmetically. `/stats` agrees: `mafiaWins 88 + townWins 4301 = 4389`.
- **Ghost retirement mechanism exists (DF-23-R2's first half).** Boot log: `Game lifecycle reconciliation: 0 retired, 0 live, 12 recent, 12 inspected`; `stats.activeGames 12 == ` IN_PROGRESS list length `12` (the old 0-vs-166 split is gone).
- **Stale `:3004/report/summary` probe retracted.** My first probe 404'd on `/api/v1/benchmark/report/summary`; no such route exists in `apps/server/src/routes/benchmark.ts` (the population lives in `report.data.summary`). Not a finding — the path came from a row title, not from the product.
- **Deploy-refresh is current.** Both containers are younger than the HEAD commit; DF-38's drift is not reproducing.
- **~483 mock games stay excluded** from the model aggregates and are declared rather than hidden.

## Findings filed this tick

### 1. `DF-MAFIA-AI-BENCHMARK-23-R3` (P2) — 12 never-started games are still sold as live
- `curl '/api/v1/games?status=IN_PROGRESS&limit=1000'` → **12 rows**, all `startedAt null / endedAt null`.
- `/state` sampled 3x, twice, 20 s apart → identical `phase NIGHT_ACTIONS, turnNumber 8, day 1, timeRemaining 0, alive 1`. **No row advances.**
- Store: all 12 have **0 `players` rows, 0 `token_usage` rows ($0), 0 `benchmark_games` rows**, `started_at NULL`, 8-ish events whose last is 17-21 h old (created 2026-10-27 00:45–04:31Z).
- Browser: header `12 Active` over cards `IN PROGRESS … Phase: In Progress [Watch]`; `/watch/fc4c1509-…` renders **`LIVE`** with `Time 0s`, `Alive 1`, "Recent Events about 17 hours ago".
- DF-23-R2's own acceptance (0 ghost rows **or** every remaining row proves liveness within 60 s) is red at HEAD; the sweeper's age window classifies them as "recent" and never asks whether an engine owns them.

### 2. `DF-MAFIA-AI-BENCHMARK-39-R3` (P2) — the seat caveat is missing on the row it exists for
One `GET /benchmark/compare` payload, same minute as the browser read:

| model | gamesPlayed | byNumPlayers | Σ buckets | seat note rendered? |
|---|---|---|---|---|
| `openai/gpt-4o-mini` | 4382 | 5:3629, 6:3, 7:2, 8:2, 10:93 | **3729** (653 = 14.9% uncovered) | **no** |
| `openai/gpt-4o` | 95 | 5:2, 6:2, 7:1, 10:90 | 95 | yes — "94.7% of games used 10-player seats" |

- The note (DF-39-R2's fix) is gated at `share >= 0.9` (`apps/web/src/components/BenchmarkLeaderboard.tsx:98-116`, call `:188`, render `:243-247`); for the flagship row the share is `3629/4382 = 0.828` — below the gate, although that row's own panel shows 5-player seats winning `3628/3629 = 100.0%` and MAFIA seats `21/3723 = 0.6%`.
- A reader therefore sees exactly one page-level-looking note, attached to the 95-game model, while the 4382-game row at `85.0%` carries no caveat.
- Independent store census: 3779 ENDED games carry a players row naming that model (`openai/gpt-4o-mini` 3718 + `gpt-4o-mini` 61) — a **third** population for the same model on one endpoint. Corpus ground truth: ENDED 4872 = 5-player 4621 (94.9%), 10-player 245, 7-player 3, 8-player 2, 6-player 1.

### 3. `DF-MAFIA-AI-BENCHMARK-49` (P5) — the usage skill's coaching had no verifier
`skills/mafia-usage/SKILL.md` taught (lines 44-47, 193-195) that `/benchmark/report` "omits the mock-game count" — false since DF-41-R2 (2026-10-27T03:47Z). **Corrected in place this tick**; the row owns the missing guard so the next contract change reds a build instead of rotting the prose.

## Measured cost (Step 2b)

Warm, sequential, single client, host loadavg ≈ 23 (shared box — every number is an upper bound):

| route | server-side (own log) | curl-inclusive |
|---|---|---|
| `/health` | 0-2 ms | 0.010 s |
| `/api/v1/stats` | 784-849 ms ×5 | 0.79-0.86 s |
| `/api/v1/benchmark/compare` | 320-350 ms ×5 | 0.35 s (2.69 MB body) |
| `/api/v1/benchmark/report` | 295-324 ms ×5 | 0.31-0.35 s |
| `/api/v1/games?limit=50` | 3-9 ms | 0.02 s |
| `/api/v1/models` | 843 ms first call | 0.89 s |

First request after the 21:15:05Z container recreate (same routes, cold): `stats 2518 ms`, `report 3785 ms`, `compare 5786 ms`. So the steady state is comfortably sub-second but the **first hit per process pays 2.5-5.8 s**, and the product's own `deploy-refresh` recreates the container on every stamp drift — i.e. each deploy re-pays it once per endpoint (the browser's `/stats` load after warm-up still paid `compare 1189 ms`, consistent with the memo being keyed per query shape).

**No PERF row filed:** nothing here is slow in steady state (`compare` 0.35 s, `report` 0.32 s, `stats` 0.83 s warm) and the cold cost is one hit per process, not a recurring per-request cost. Numbers recorded here for the maintainer; `PERF-MAFIA-3`'s warm bound of 0.300 s is met only up to 0.35 s at this larger corpus (5077 vs 4284 games) — still not user-felt.

Browser-side (headless Chrome, cold `/stats`): **5 API calls** (`/games` ×2, `/stats`, `/stats/matchups`, `/benchmark/compare`) — `PERF-MAFIA-4`'s "5 requests, was 39-43" holds. DOM nav 75 ms.

## Friction log (this tick)

1. `pnpm --filter @mafia/cli dev -- init --default` is documented as "Create the nested default configuration **without prompts**" (README:194) but on a tree where `./mafia.config.json` already exists it prints `⚠️ Configuration already exists at: ./mafia.config.json … Use --force to overwrite` **and a `? Overwrite existing configuration? (y/N)` prompt**, then exits **0 having changed nothing**. `--force` appears nowhere in README (README-12 already owns that for `config reset`; corroboration event appended there rather than a duplicate row).
2. The documented commands operate on **`apps/cli/mafia.config.json`** (pnpm runs the script in the package directory), while README:187-190 says the file is "in the current directory". Evidence: `config show` reports `Night Duration: N/A` on this box even though a repo-root `mafia.config.json` (residue, 2026-10-06) sets `nightDuration: 60`; `config set numPlayers 8` updated `apps/cli/mafia.config.json` (mtime 2026-10-27 16:43). Self-consistent under the documented pnpm form, so **not filed** — recorded here for the record.
3. The Games page's card field `players` disagrees with the store: cards for the 12 ghosts print `1 Players` while the store has **0 `players` rows** for every one of them (config says `numPlayers: 5`). Folded into finding 1 as evidence.
4. Third-party noise: 3 unrelated bunker agents and many unrelated containers on the box; loadavg 23 during every measurement.

## Install leg (fresh machine, `bunker-qa.sh`) — PASS for install/build/suite, two cells UNVERIFIED

`bunker-qa.sh launch /home/kara/wojons/mafia-ai-benchmark` on `bunker-mvp` (bunkerd 0.2.1, ONLINE, disk 39%): fence-check `35 intended substitutions / 0 violations`, `agent=cfa91552`, `QA HEAD=1c3e8f7 (ff-only ok)`, `ttl 4h`, evidence `/tmp/bunker-qa-evidence-20261027T214911Z-2065047.jsonl`. Battery ran ~70 min detached; `collect` pulled **22 rows** and destroyed the agent.

| cell | grade | evidence |
|---|---|---|
| toolchain-bootstrap | OK | node v22.22.3, go 1.27.3, gcc/g++ wrappers, make 4.3, jq 1.8.2, compose+buildx |
| **fresh-install** | **OK** | `pnpm install --frozen-lockfile` rc=0, 579 packages in **14.2s**, supply-chain policy check on 649 lockfile entries passed, `better-sqlite3` prebuild OK |
| **ci-pass (native suite)** | **OK** | "native suite PASS" — the suite itself is green on the fresh user |
| **upgrade** | **OK** | previous release `v1.0.0` tree (via `git archive`) → HEAD reinstall clean |
| ci-act | **UNVERIFIED** | `act` rc=1. Failure A is plainly harness (`ENOENT` copying node headers in the act toolcache during Setup Node.js); failure B is `MODULE_NOT_FOUND './packages/shared/src/agents/response-parser'` from the root `game-engine.js:698` in two server suites |
| ui-probe | FAIL | `UI not serving (http=000, landed: http://127.0.0.1:3111/): For more information, try '--help'.` |
| docker-deploy, chaos-shutdown | SKIPPED | safety gate: controller is the live Hermes host |
| chaos-corruption | N/A | no db/state files in repo |
| chaos-disconnect | INFO | passes with network cut |
| chaos-resource | INFO | OOM under the 3 GiB cap (known Wasm/OOM shape, not a product signal) |
| chaos-errorpath | INFO | no start command detected — unverified |

**Failure B triaged, NOT filed as a product defect.** Control arm on a clone-equivalent tree (`git archive HEAD | tar -x` outside the repo, clean `pnpm install --frozen-lockfile` + `pnpm build`):
`require('<fresh>/packages/shared/src/agents/response-parser')` → **REQUIRE-OK**; `require('<fresh>/game-engine.js')` → **ENGINE-REQUIRE-OK**; the two red suites → **28/28 PASS** in 4.5 s. The same file is present in the agent's synced tree (`response-parser.js`, 9301 B, `git status` clean). Inference (labelled): the four `act` matrix shards run **concurrently against one mounted tree** on a shared host, so a shard test step can observe a half-written tree — the same class the skill warns about for shared bunker agents. Evidence: `/tmp/dogfood-mab-01/qa-pull/ci.log`, `/tmp/dogfood-mab-01/fresh-tree.log`.

**ui-probe FAIL left UNVERIFIED, not filed.** Two candidate causes this tick could not discriminate: (a) `bunker-mvp` shares the host loopback/port space with three other live agents, so `:3111` may have been bound elsewhere (the shared-net hazard), or (b) the documented dev-start defect already closed as `QA-MAFIA-AI-BENCHMARK-11-R2`, in which case this is a recurrence. The cell's detail is one line, no `ui*.log` was written, and the agent is destroyed — so the honest grade is UNVERIFIED, with the reproduce command for the QA lane: `bash ~/.hermes/scripts/bunker-qa.sh run <repo> --server bunker-mvp` with no other battery alive on that host.

## Install verdict

Installability is **proven** on a fresh Debian user at HEAD: install 14.2 s, build green, native suite green, upgrade-from-release green, teardown clean (agent `cfa91552` destroyed by `collect`; no agent of this run remains). The act-CI and UI-probe cells are explicitly **UNVERIFIED**, not converted to PASS.

## Not done on purpose

- **No benchmark campaign re-driven** (real LLM spend, ~4 min/run): the money-bearing path was verified on 2026-10-20/23 and its report/compare/summary surfaces were re-read live here instead.
- **No container restart for a cold-cache A/B**: 12 persisted IN_PROGRESS rows were present and a recreate is the known game-killer (DF-47) — the cold numbers were taken from the product's own recreate at 21:15:05Z instead.
- **No scheduler state touched** (read-only lane): the foreman was not woken.

---

## Resumed delivery, same tick (`mafia-ai-benchmark-dogfood-2026-10-27-21-34-02`) — addendum 22:25Z

**Split disclosure.** This tick fired twice. The earlier delivery of the SAME tick
label landed the three rows (`DF-MAFIA-AI-BENCHMARK-23-R3`, `-39-R3`, `-49`), this
report, the run-history entries, the `skills/mafia-usage/SKILL.md` correction and the
install-leg cell grades in commits `6871b1d`, `d7e9e67` and `b0d87b9`. Those legs are
**verified here, not repeated**: `origin/main` == `b0d87b9` at 22:20Z before this
append, each of the three row ids appears exactly once in the committed blob, and the
ghost population, the seat-caveat payload and the retired `report omits mockGames`
claim all reproduce as that delivery wrote them. This addendum carries **only the
delta** the earlier delivery's probe design could not see.

### Delta 1 — two new rows (both defects are on surfaces the first pass never drove)

| row | what a user hits | evidence class |
|---|---|---|
| `DF-MAFIA-AI-BENCHMARK-32-R2` (P3, recurrence of `-32`) | the persistent app header prints **0 / 0** ("0 active, 0 total") on every route while the body directly beneath it prints the real totals | live DOM read on `/games`, `/stats`, `/watch/<id>` + a dead-wire grep |
| `PERF-MAFIA-5` (P3) | `/api/v1/benchmark/compare` **0.28 s warm → ~4 s per call while a game is live**, and the synchronous rebuild stalls every concurrent request | same-host warm-vs-live A/B + server log + browser resource timings |

`DF-MAFIA-AI-BENCHMARK-32-R2` — `Header.tsx:51,54` renders `{stats.activeGames}` /
`{stats.totalGames}` from `useGameStore().stats`; the slice's only writer is
`updateStats` (`gameStore.ts:349`) and `grep -rn updateStats apps/web/src` finds no
production caller (type at `:119`, impl at `:349`, test at
`__tests__/gameStore.test.ts:184`). `-32`'s fix wired `headlineStats` for the Games
tab (`gameStore.ts:228-255`, rendered `GameList.tsx:253-269`) and left this second
counter orphaned. Measured on screen at `1c3e8f7`: `/stats` body
`5078 Total Games / 4389 Completed / 88 Mafia Wins / 4301 Town Wins` with the chrome
reading `0 / 0` in the same DOM; `/games` body `5077 Total / 12 Active / 0 Setup /
4389 Completed`, chrome `0 / 0`.

`PERF-MAFIA-5` — the earlier delivery's own Step 2b section measured the quiescent
corpus (compare 0.32-0.35 s warm) and the cold process (5.8 s once) and concluded
"one hit per process, not a recurring per-request cost", filing nothing. The arm it
never varied is the product's normal state, **a live game**, and that arm inverts the
conclusion. One host, one corpus, minutes apart:

- game live (a 10-player game I created from the dashboard; events 126 → 129 in 5 s):
  consecutive `compare` calls **4.056 s / 3.839 s / 3.748 s** — the memo never hits;
- same command quiescent (that game ENDED): **4.239 s** once, then **0.284 / 0.265 /
  0.276 s**; same shape on `/benchmark/report` (**4.593 s** then 0.234 s);
- four requests fired together, as the Stats tab does: `compare 4.186 s`,
  `stats 4.733 s`, `matchups 4.775 s`, `games?limit=50 4.196 s` — while that same
  `games?limit=50` alone is **0.006 s**;
- the server's own log agrees (`GET /api/v1/benchmark/compare - 200 (4769 ms)`,
  `... - 304 (4103 ms)`), and a cold browser `/stats` paid compare **4969 ms**.
Mechanism: `computeReportWatermark` (`stats-collector/index.ts:93-145`) fingerprints
`(SELECT COUNT(*) FROM events)`, so every in-game event insert busts the cache; the
rebuild is synchronous and starves the event loop. Host loadavg 5.3-17 throughout, so
every number above is an upper bound.

### Delta 2 — the `ui-probe` FAIL is HARNESS command shape, and its log DOES exist

The install-leg entry (`b0d87b9`) left the `ui-probe` FAIL UNVERIFIED and unfiled
because "no `ui*.log` was written and the agent is destroyed". That premise is
incorrect: the cell's log **was** written and was still on the agent when this
delivery polled it (agent `cfa91552`, `~/qa-logs-2224830/ui.log`, 168 B, mtime 22:00Z),
and it was harvested before teardown. Its content:

```
> mafia-ai-benchmark@1.1.0 dev
> turbo run dev --port 3111

 ERROR  unexpected argument '--port' found

Usage: turbo run [FLAGS]

For more information, try '--help'.
```

So the probe is neither a shared-host port collision nor a recurrence of
`QA-MAFIA-AI-BENCHMARK-11-R2`: the harness launches the UI as
`turbo run dev --port 3111` against a repo whose `dev` script **is** `turbo run dev`,
and turbo rejects `--port` as its own unknown flag, so no dev server is ever started
and the cell observes `http=000`. **HARNESS-blocked, not a product defect** — no
product row filed. (Correct harness shape for a turbo monorepo would be
`pnpm --filter @mafia/web dev -- --port 3111` or `turbo run dev -- --port 3111`.)

### Teardown census (re-verified, not asserted)

`bunker info cfa91552` → `not_found: agent "cfa91552" not found`; `bunker list` contains
**0** matches for `cfa91552`. The re-collect was idempotent: `bunker-qa.sh collect`
reported `COLLECTED agent=cfa91552 rows=22` and its destroy leg reported a late failure
because the agent was already gone, which its own output confirms
("teardown recovered (destroy landed late)"). No residue from this run.

### Not done on purpose (resumed delivery)

- The three legs already verified above were **not** re-driven (no second ghost probe
  battery, no second compare/report identity check, no second act/CI attempt).
- No new install battery was spawned: at the same HEAD with unchanged install docs a
  re-spawn measures the host, not the product.
- No scheduler state touched; the foreman was not woken (read-only lane).
