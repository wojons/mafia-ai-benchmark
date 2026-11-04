# Observability Spec — mafia-ai-benchmark

Status: **proposal** (audit 2026-11-03). Nothing in this document is implemented
yet; every "current state" claim below was verified against the running stack or
the source tree on that date.

Audience: the worker implementing the `OBS-*` board rows, and the reviewer who
has to prove the work landed.

---

## 1. What this service is, and what "healthy" means

### 1.1 Role

`mafia-ai-benchmark` is a **multi-agent LLM benchmark harness**. It plays Mafia
games where every seat is an LLM, then reports which model won.

Topology (verified):

| Component | Path | Role |
|---|---|---|
| `@mafia/server` | `apps/server/src/index.ts:43` | Express REST + `/ws` WebSocket on port 3004 (`apps/server/src/config.ts:11`). Long-running. Owns the SQLite DB and spawns game children. |
| Legacy adapter | `apps/server/src/services/legacy-game-adapter.ts:127` | Spawns one **child process per game** (`legacy-bridge.js`). This is the path that actually plays games. |
| Bridge | `apps/server/src/services/legacy-bridge.js:59` | Wraps `game-engine.js`, emits JSON events on stdout. |
| Engine | `game-engine.js` (repo root, gitignored) | Calls the LLM API per agent turn; own token/cost/latency trackers. |
| `@mafia/cli` | `apps/cli/src/index.ts` | Short-lived CLI (`mafiactl`). Talks to the server over HTTP. |
| `@mafia/web` | `apps/web/` | Vite SPA behind nginx (`docker-compose.yml:37`). |

Deployment (verified live): Docker Compose services `mafia-ai-benchmark-server-1`
and `mafia-ai-benchmark-web-1`, both up 39h at audit time, server reported
`(healthy)` by its own Docker healthcheck. DB volume
`mafia-ai-benchmark_data` → `/app/data/mafia.db` (currently 204 MB).
`docker-compose.yml:12` publishes `3004:3000`; `PORT=3000` is forced inside the
container (`docker-compose.yml:23`).

**Fan-out shape matters for metrics:** each game is a separate OS process. Any
in-process Prometheus registry dies with the child, so per-game outcome metrics
can only be emitted either (a) by the parent adapter after it observes the child
exit, or (b) as a textfile completion record from the child.

### 1.2 Healthy means

All of the following hold:

1. `GET /health` returns 200 with `status: "healthy"` (`apps/server/src/index.ts:146`).
2. The server can persist: DB reachable and writable (`apps/server/src/index.ts:45`).
3. Games attempted are completing at a plausible rate — i.e. the
   `COMPLETED`-vs-`FAILED` ratio is steady, not a stampede of bridge spawn failures.
4. The upstream LLM credential pool is live — no sustained 401/402/429 from provider calls.
5. Benchmark runs reach a terminal state instead of being swept as abandoned
   after 7 days (`apps/server/src/services/benchmark-runner.ts:867`).
6. Cost per game stays inside the per-game budget the engine enforces
   (`game-engine.js:2308`, `COST_PER_GAME_TOTAL`).

Right now **only signal (1) is machine-readable, and it is only a scrape
target — the fleet's Prometheus does not scrape it.**

---

## 2. Current state — what exists today

### 2.1 No metrics surface at all

| Probe | Command | Result |
|---|---|---|
| Live `/metrics` | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3004/metrics` | **404** |
| Live `/health` | `curl -s http://localhost:3004/health` | 200, JSON with `status`, `timestamp`, `uptime`, `memory` |
| Prometheus client dep | `grep prom-client apps/server/package.json` | **none** — deps end at `ws` (`apps/server/package.json:18-29`) |
| First-party metric code | `grep -rIlE "prom-client\|prometheus\|opentelemetry\|/metrics"` excluding `node_modules/.git/dist/.opencode/.pnpm/archive/openrouter_models*` | **0 files** |

The static scan's `own_counter_or_gauge=1` hit is
`incrementMutationCounter` in `.opencode/lib/graph-harness.ts:5424` — a SQL
mutation counter in vendor tooling, **not** this product. Verdict of the
starting hypothesis: **confirmed, and it is worse than "no metrics" — there is no
metrics library in the dependency tree and no endpoint to hang one on.**

The only route enumeration helper is `GET /api/v1/health`
(`apps/server/src/index.ts:151`). There is no route named `metrics`
(`grep -rn "metrics" apps/server/src` → only prose comments and test fixtures).

### 2.2 Logging is unstructured `console.*` into the container log

- 403 `console.*` call sites in first-party `apps/*/src` + `packages/*/src`.
- Request logging is a hand-rolled one-liner with **no method/route split and no
  exported counter**: `apps/server/src/index.ts:138-144` logs
  `METHOD /path - STATUS (Nms)` on `res.on('finish')`.
- `LOG_LEVEL` appears in `.env.sample` but **is never read by server code**
  (only the env-audit test at
  `apps/server/src/__tests__/env-sample-audit.test.ts:194` mentions it). No
  logger is configured; there is no `pino` dependency in `apps/server`.
- Structured logging exists inside the engine only, and the bridge **forces it
  off** so stdout stays a clean JSON event stream:
  `apps/server/src/services/legacy-bridge.js:42` sets `LOG_STRUCTURED=false`,
  `:43` redirects `console.log` to stderr, `game-engine.js:13` gates on it.
- Consequence: engine diagnostics (including every API failure at
  `game-engine.js:5161`) land on the child's **stderr**, which the adapter
  re-logs verbatim at `apps/server/src/services/legacy-game-adapter.ts:272`.
  They are searchable in `docker logs` and nowhere else — no counter, no level,
  no route to Loki (no Alloy log scrape job for this container was found).

### 2.3 The signal exists — it just never leaves the DB

This is the core finding. The product already computes almost every metric the
operator wants; it writes it to SQLite and stops.

| Operator question | Where the answer already lives | Ever emitted? |
|---|---|---|
| Is it up? | `apps/server/src/index.ts:146` (`/health`) | HTTP only, not scraped |
| Is it doing work? | `games.status = 'IN_PROGRESS'`; live set in `legacy-game-adapter.ts:248` (`activeGames`), `benchmark-runner.ts:112` (`BenchmarkProgress`) | **No** |
| How many games played/completed? | `games` table, `status` + `ended_at` (`apps/server/src/db/schema.sql:5-19`) | **No** |
| How long does a game take? | `games.duration` ms, written at `legacy-game-adapter.ts:520` | **No** |
| Per-agent win rate | `player_game_stats` + `model_aggregate_stats` (`schema.sql:118`, `:135`), served at `apps/server/src/routes/stats.ts:38` | HTTP JSON only |
| Decision latency | `api_calls.latency` ms — real per-call average from the engine's `APITracker` (`legacy-usage-collector.js:28-57`, `:256`) | **No** |
| Seat/API failures | `api_calls.status_code` / `error` (`schema.sql:103-116`); engine retries at `game-engine.js:5030`; budget stop at `game-engine.js:4884` | **No** |
| Token cost per game | `token_usage.cost` (`schema.sql:87-101`), written at `legacy-game-adapter.ts:747` | **No** |
| Bridge spawn failures | `benchmark_games.error` (`benchmark-runner.ts:1176`) and child exit code (`legacy-game-adapter.ts:280`) | **No** |
| Runs stranded | `benchmark_runs.status`, swept after 7 days (`benchmark-runner.ts:867`) | **No** |
| DB growth | `mafia.db` 204 MB, growing | **No** |

Note the deliberate honesty trap in §2.3 row 1: `api_calls` is written with a
**hard-coded `status_code = 200`** at `legacy-game-adapter.ts:774`
(`insertApiCall.run(..., 200, now)`), and the engine's failed-call branch also
stamps a placeholder model (`game-engine.js:5175-5176` hard-codes
`provider: "openrouter", model: "openai/gpt-4o-mini"`). So `api_calls` is **not**
a trustworthy failure counter today. Live DB confirms it: 25,612 rows, **all**
`status_code = 200`, **zero** with an `error`, yet 65526 ms max latency — i.e.
failures are being lost, not recorded. Any failure metric must be sourced from
the adapter's own child-exit and event evidence, and the `api_calls` stamping
bug must be fixed separately. **Do not build a failure counter on `api_calls`.**

### 2.4 Blind spots that actually hurt at 3am

1. **A benchmark run can hang for 7 days with nothing firing.**
   `benchmark-runner.ts:867` marks a non-terminal run `FAILED` only after
   `STALE_RUN_MAX_MS` (7 days) and only at *startup* reconciliation
   (`apps/server/src/index.ts:117`). Nothing alerts while it is hanging.
   Evidence this is real: the repo-local DB holds a run `RUNNING` for
   3,212,019 s (37 days), and the production volume holds **16 runs already
   swept** with `"Run abandoned: still non-terminal with no completed game
   evidence after 7 days"`.
2. **Orphaned `IN_PROGRESS` games are invisible until restart.** The repo DB
   has 7 `IN_PROGRESS` rows; the oldest started 2026-07-17. Retirement happens
   only at startup (`apps/server/src/index.ts:101`) or on a read
   (`game-lifecycle-reconciler.ts`). No gauge, no alert.
3. **A dead LLM credential looks like a slow game.** Provider 401/402/429 is
   logged per player (`game-engine.js:5161`) and then swallowed by a retry loop
   (`game-engine.js:5180`). The operator sees `IN_PROGRESS` games with no
   progress and no error rate anywhere.
4. **Bridge spawn failure is silent for up to a whole run.** The known failure
   mode — child dies at `require()` before emitting any event — is documented at
   `benchmark-runner.ts:1155-1163`. It is now recorded per game, but nothing
   counts it.
5. **Cost is unbounded and unobserved.** Per-game budget enforcement exists
   (`game-engine.js:4880-4894`) but the amount spent is only a DB column;
   `token_usage.cost` sums to $0.103 for 26 rows in the repo DB. An operator
   cannot answer "what did the last 24h of benchmarking cost".
6. **The `/health` handler is a liar by construction.** `apps/server/src/index.ts:146-148`
   returns `status: "healthy"` unconditionally — it does not touch the DB, does
   not check the legacy adapter, and cannot fail. Docker's healthcheck
   (`docker-compose.yml:27-32`) therefore proves only that the event loop is
   alive. This is why a metrics endpoint must carry the *real* liveness signals
   (games completing, DB writes succeeding) rather than replacing `/health`
   with a blackbox probe.

---

## 3. Metric catalogue

Naming convention: `<product>_<subsystem>_<thing>_<unit>`.
Product prefix is `mafia`. Subsystems: `server`, `game`, `agent`, `llm`,
`benchmark`, `run`.

**Labels are capped at these low-cardinality sets and nothing else:**

- `provider` — from the model spec prefix (`openai`, `anthropic`, `google`, `openrouter`, `CUSTOM`). ≤ 10 values.
- `model` — for the *bounded* set of models under benchmark; capped by a
  configured allow-list, ≤ ~40 values. If the set cannot be bounded, the label
  is dropped and only `provider` is kept.
- `outcome` — `completed | cancelled | failed | degenerate`.
- `reason` — `bridge_spawn | bridge_crash | budget_exceeded | upstream_error | timeout | unknown`.
- `status` — `RUNNING | COMPLETED | CANCELLED | FAILED`.
- `role` — `MAFIA | TOWN` (side, not seat).

**Forbidden as labels:** `game_id`, `run_id`, `player_id`, `model_pair`,
`seed`, any prompt text, any file path, any timestamp. Games/runs are
per-entity and unbounded; they belong in logs and DB rows, not in series.

### 3.1 Tier 0 — minimal viable emission (board row `OBS-001`)

Five metrics that answer "is it alive, is it working, what failed, what did it
cost".

| Name | Type | Unit | Labels | The one question it answers |
|---|---|---|---|---|
| `mafia_server_up` | gauge | 1 | `version` | Is the server process serving at all, and what build? |
| `mafia_game_active` | gauge | games | — | Is a game running right now? |
| `mafia_game_ended_total` | counter | games | `outcome`, `provider` | Are games finishing, and on the right side of the success/failure line? |
| `mafia_game_failed_total` | counter | games | `reason` | When a game dies, why? |
| `mafia_game_duration_seconds` | histogram | s | `provider` | How long does one game take (buckets set the "it's stuck" threshold)? |

Buckets for `mafia_game_duration_seconds`: `60, 120, 300, 600, 900, 1800, 3600, 7200`.

### 3.2 Tier 1 — benchmark and LLM depth (board row `OBS-002`)

| Name | Type | Unit | Labels | The one question it answers |
|---|---|---|---|---|
| `mafia_benchmark_run_total` | counter | runs | `status` | Are benchmark runs completing, or accumulating FAILED? |
| `mafia_benchmark_run_duration_seconds` | histogram | s | — | How long is a full benchmark run? |
| `mafia_benchmark_run_stranded` | gauge | runs | — | Are runs stuck non-terminal right now (the 7-day sweep)? |
| `mafia_benchmark_games_queued` | gauge | games | — | Is the run backlog draining? |
| `mafia_llm_request_total` | counter | requests | `provider`, `model`, `outcome` | What is the upstream API success rate per model? |
| `mafia_llm_request_duration_seconds` | histogram | s | `provider`, `model` | What is decision latency per model (p50/p95/p99)? |
| `mafia_llm_tokens_total` | counter | tokens | `provider`, `model`, `direction` (`prompt`/`completion`) | Token volume, which is the cost driver. |
| `mafia_llm_cost_usd_total` | counter | usd | `provider`, `model` | What have we spent, cumulatively, per model? |
| `mafia_llm_budget_exhausted_total` | counter | events | `provider` | How often does a game stop early because a seat ran out of budget (`game-engine.js:4891`)? |
| `mafia_llm_retry_total` | counter | requests | `provider`, `reason` | Are retries masking an upstream problem (`game-engine.js:5030`)? |

Buckets for `mafia_llm_request_duration_seconds`: `0.25, 0.5, 1, 2, 5, 10, 30, 60, 120`.
(A live sample shows 848 ms average and a 65 s max — buckets must reach past 60 s.)

**Closed label value sets used by the implementation** (values the spec did not
enumerate are fixed here so no free-form string can ever become a label):

| Metric | Label | Values |
|---|---|---|
| `mafia_benchmark_run_total` | `status` | `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED` — only `COMPLETED`/`CANCELLED`/`FAILED` increment (a counter of an in-flight state is meaningless); all four are pre-registered at 0 |
| `mafia_llm_request_total` | `outcome` | `completed`, `failed` — sourced from adapter child-exit / bridge-event evidence, never from `api_calls.status_code` (§2.3) |
| `mafia_llm_tokens_total` | `direction` | `prompt`, `completion` |
| `mafia_llm_retry_total` | `reason` | `response_format`, `network_error`, `parse_error`, `unknown` (`game-engine.js:5030`/`:5138`/`:5183`) |
| all `mafia_llm_*` | `model` | the `METRICS_MODEL_ALLOWLIST` allow-list (documented default in `apps/server/src/observability/metrics.ts`) plus `other`; provider prefixes are stripped before matching, so `openai/gpt-4o-mini` and `gpt-4o-mini` are one series |
| all `mafia_llm_*` | `provider` | the §3 prefix set (`openai`, `anthropic`, `google`, `openrouter`, `custom`) plus `unknown` |

Buckets for `mafia_benchmark_run_duration_seconds`: `300, 900, 1800, 3600,
7200, 14400, 43200, 86400` (5 min to 24 h).

Identifier cardinality is bounded by construction: the `mafia_llm_request_total`
closed set is providers (6) × models (allow-list + `other`) × outcomes (2) =
108 series with the default allow-list, well under the 200-series acceptance
bound.

### 3.3 Tier 2 — storage, HTTP, and credential health (board row `OBS-003`)

| Name | Type | Unit | Labels | The one question it answers |
|---|---|---|---|---|
| `mafia_storage_bytes` | gauge | bytes | — | Is `mafia.db` growing faster than retention expects? |
| `mafia_storage_rows` | gauge | rows | `table` | Which table is growing (bounded allow-list of 6 tables)? |
| `mafia_http_requests_total` | counter | requests | `route`, `method`, `status_class` | Which endpoints are erroring? `route` must be the **matched Express route pattern**, never the raw path. |
| `mafia_http_request_duration_seconds` | histogram | s | `route`, `method` | Which endpoint is slow? |
| `mafia_game_in_progress` | gauge | games | — | Orphan detector: `IN_PROGRESS` rows with no live owner (bug 2 in §2.4). Alert when > 0 for 15 m. |
| `mafia_healthcheck_failed_total` | counter | checks | `check` (`db_write`, `legacy_adapter`, `spawn_capacity`) | What is broken while the process still says "healthy"? |

---

## 4. Exposure mechanism

**`GET /metrics` on the existing Express server**, using **`prom-client`**, the
de-facto Node client for the Prometheus text format. Rationale:

- The server already owns a long-lived HTTP listener (`apps/server/src/index.ts:125`,
  `:176`). Adding one route is the smallest possible change; no new process,
  no new port.
- `prom-client` is the standard Node counterpart to Go's `client_golang` +
  `promhttp`, which is what the rest of the fleet uses.
- The container is already published on host `:3004` (`docker-compose.yml:13`),
  so the fleet collector can reach it without a new port mapping. *If* a
  separate metrics port is ever needed, add `METRICS_PORT` rather than widening
  the existing listener — the API surface is CORS-open (`apps/server/src/index.ts:128`)
  and must not be conflated with operations endpoints.

Concrete wiring:

1. Add `prom-client` to `apps/server/package.json` dependencies.
2. Create `apps/server/src/observability/metrics.ts` exporting a single
   `Registry`, `collectDefaultMetrics({ register })` (gives process CPU, heap,
   event-loop lag, GC for free), and the `mafia_*` instruments above.
3. Mount **before** the auth middleware and before the 404 catch-all:
   ```ts
   app.get('/metrics', async (_req, res) => {
     res.set('Content-Type', registry.contentType);
     res.end(await registry.metrics());
   });
   ```
   `/metrics` must be unauthenticated (Prometheus cannot send a bearer token in
   this stack) but **must not** be reachable through the public web tier. Proven
   today: `apps/web/nginx.conf:22` proxies only `/api/` and `:35` only `/ws`, and
   `:46` `location / { try_files $uri $uri/ /index.html; }` is a static SPA
   fallback that never proxies upstream — so `GET :5174/metrics` returns the SPA
   `index.html`, not the server's metrics (verified live: `<!DOCTYPE html>`).
   No change is required there; a reviewer confirms with
   `curl -s http://localhost:5174/metrics | head -3` and greps for `<html`.
4. `/metrics` must be served on the **same listener** the healthcheck uses, and
   must respond even when the DB is wedged — instrument collection in a
   `try/catch` and expose `mafia_healthcheck_failed_total{check="db_write"}`
   rather than 500ing the scrape.

**The child-process problem and its answer.** Per-game outcome metrics cannot
live in the child's registry (it dies at end of game). Two acceptable sources,
in order of preference:

- **(a) Parent-side (preferred, used by `OBS-001`).** The adapter already knows
  every terminal transition: completion at
  `legacy-game-adapter.ts:365`, error exit at `:280-283`, spawn error at `:304-312`,
  and the `'gameEnded'`/`'gameError'` events it emits at `:301`/`:312`. Increment
  the counters there. No child changes needed and it works with the current
  per-game-process model.
- **(b) Textfile completion record (only if a child must report its own
  internals).** The bridge writes
  `${METRICS_TEXTFILE_DIR}/mafia_game_<gameId>.prom` and the parent's
  `collectDefaultMetrics` sibling collector (`prom-client`'s
  `collectDefaultMetrics` does not do this; use a custom collector over the
  directory) merges and deletes it. **This is a completion record, not a scrape
  target.** Never expose `/metrics` from the bridge.

There is no pushgateway in the fleet's described stack; do not introduce one for
this product.

---

## 5. Collection path

| Item | Value |
|---|---|
| Collector | Prometheus 3.15 on `fleet-monitor` |
| Mode | **New scrape job** — this product pushes nothing today (agents push to Prometheus via `remote_write`; this is a server, so scrape is correct) |
| Scrape job (proposed) | `job_name: mafia-ai-benchmark`, `metrics_path: /metrics`, `static_configs: [{ targets: ['<host>:3004'] }]` |
| Interval | `15s` |
| Extra labels | `host="<docker host>"`, `product="mafia-ai-benchmark"`, `service="mafia-server"` (set via `relabel_configs`, not in-product) |

Ownership note: the scrape job lives in
`/root/fleet-monitoring/prometheus/prometheus.yml` on `fleet-monitor`, which is
**outside this repo**. The worker implementing `OBS-001` must not edit it from
this repo's context; instead file the job patch text in the row's evidence and
request the fleet owner apply it, or (if the worker has `fleet-monitor` access via
the sanctioned path) apply it and cite the resulting target health.

Logs: this product currently has **no** log shipping. `docker logs` is the only
sink. If log shipping is wanted later, Alloy can read the Docker socket; that is
out of scope for this spec and must not block `OBS-001`.

---

## 6. Verification — what "done" looks like

Each check is a command a reviewer runs. All must pass.

### 6.1 `OBS-001` (Tier 0)

```bash
# 1. Endpoint exists and is Prometheus text format (was 404 before this row)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3004/metrics      # expect 200
curl -s http://localhost:3004/metrics | head -1                             # expect a # HELP line
curl -s http://localhost:3004/metrics | grep -c '^mafia_'                   # expect >= 5 families

# 2. Named metrics are present
for m in mafia_server_up mafia_game_active mafia_game_ended_total \
         mafia_game_failed_total mafia_game_duration_seconds; do
  curl -s http://localhost:3004/metrics | grep -q "^$m" && echo "OK $m" || echo "MISSING $m"
done

# 3. The counter actually moves: play one game, then re-read
before=$(curl -s http://localhost:3004/metrics | awk '/^mafia_game_ended_total/ {s+=$2} END {print s+0}')
curl -s -X POST http://localhost:3004/api/v1/games -H 'content-type: application/json' -d '{"numPlayers":5}'
sleep 240
after=$(curl -s http://localhost:3004/metrics | awk '/^mafia_game_ended_total/ {s+=$2} END {print s+0}')
[ "$after" -gt "$before" ] && echo "OK counter moved $before -> $after" || echo "FAIL counter static"
```

PromQL, once scraped (`job="mafia-ai-benchmark"`):

```promql
mafia_server_up                                                    # = 1
sum(mafia_game_active)                                             # games running now
sum(rate(mafia_game_ended_total[1h]))                              # games/hour
sum by (reason) (rate(mafia_game_failed_total[1h]))                # failures/hour by cause
histogram_quantile(0.95, sum by (le) (rate(mafia_game_duration_seconds_bucket[1h])))
```

Alert to ship alongside: `sum(mafia_game_failed_total) > 0` with
`for: 10m` when `rate(...[15m]) > 0` and outcome is `bridge_spawn` — that is the
documented spawn-failure mode from `benchmark-runner.ts:1155`.

### 6.2 `OBS-002` (Tier 1)

```bash
# Start a tiny benchmark and watch the counters
curl -s -X POST http://localhost:3004/api/v1/benchmark \
  -H 'content-type: application/json' \
  -d '{"config":{"models":["openai/gpt-4o-mini","openai/gpt-4o-mini"],"gamesPerPairing":1,"numPlayers":5}}'
curl -s http://localhost:3004/metrics | grep '^mafia_llm_request_total'
curl -s http://localhost:3004/metrics | grep '^mafia_llm_cost_usd_total'
```

Cross-check the cost counter against the DB — they must agree:

```bash
# DB truth for the same window (cost column is USD)
sqlite3 /app/data/mafia.db "SELECT round(sum(cost),6) FROM token_usage;"
# metric truth
curl -s http://localhost:3004/metrics | awk '/^mafia_llm_cost_usd_total/ {s+=$2} END {printf "%.6f\n", s}'
```

PromQL:

```promql
sum by (model) (rate(mafia_llm_request_total{outcome="failed"}[15m]))
  / sum by (model) (rate(mafia_llm_request_total[15m]))              # upstream error ratio
histogram_quantile(0.95, sum by (le, model) (rate(mafia_llm_request_duration_seconds_bucket[15m])))
sum(increase(mafia_llm_cost_usd_total[24h]))                          # $ spent/day
mafia_benchmark_run_stranded                                          # must be 0
```

**Truthfulness gate for `OBS-002`.** The `mafia_llm_request_total{outcome}`
counter must be sourced from the adapter's child-exit and event evidence, **not**
from `api_calls.status_code` — see §2.3, where every row is a hard-coded 200
(`legacy-game-adapter.ts:774`). A worker that wires the counter to `api_calls`
produces a permanently-zero failure rate and fails this row.

### 6.3 `OBS-003` (Tier 2)

```bash
curl -s http://localhost:3004/metrics | grep '^mafia_storage_bytes'    # compare to du -b of the DB
curl -s http://localhost:3004/metrics | grep '^mafia_game_in_progress'
curl -s -o /dev/null http://localhost:3004/api/v1/games                # then confirm the counter moved:
curl -s http://localhost:3004/metrics | grep 'mafia_http_requests_total{route="/api/v1/games"'
```

PromQL:

```promql
sum by (status_class) (rate(mafia_http_requests_total[5m]))            # 5xx shouldn't exist
mafia_storage_bytes < 5e9                                              # retention headroom
mafia_game_in_progress > 0                                             # alert: orphaned games
```

The `route` label **must** be the Express route pattern
(`/api/v1/games/:gameId`), not the concrete path — otherwise every game id
becomes a series and the target explodes. A reviewer proves this by requesting
two different game ids and confirming **one** series exists with
`route="/api/v1/games/:gameId"`.

### 6.4 Scratch instance rule

Verification may run against a scratch container
(`docker compose -p mafia-obs-scratch up`) so the live benchmark DB is not
polluted by test games. If verification runs against the live stack, say so and
record the games created.

---

## 7. Deliberately NOT instrumented

| Not instrumented | Why |
|---|---|
| `game_id`, `run_id`, `player_id`, `model_pair`, `seed` as labels | Unbounded. 5,079 games in the live DB → 5,079 series per metric. These belong in logs/DB rows and get joined offline. |
| Per-player / per-persona metrics | Same cardinality problem, and no operator question depends on a single seat. Side (`MAFIA`/`TOWN`) is enough. |
| Prompt / completion text, any content from a game | Secrets and unbounded. Also a privacy surface: seat prompts contain persona text. |
| Full model list as a free-form label | Capped allow-list only (§3). Unknown models roll up to `provider="other"`. |
| WebSocket connection count as a Tier-0 metric | Not load-bearing for a benchmark harness; operator questions there are answered by `mafia_http_requests_total` + logs. Revisit only if `/ws` spectators become a product surface. |
| `api_calls.status_code` as a failure source | Proven wrong (§2.3): hard-coded 200 at `legacy-game-adapter.ts:774`. Fixing the insert is a separate correctness task, not an observability task. |
| Pushgateway | No push path needed for a scrapeable server; adding one invents a second source of truth. |
| Alerting rules in this repo | Rules live on `fleet-monitor` with the scrape job; this repo ships the metrics and the suggested expressions, not the rule files. |

---

## 8. Known issues handed off (not fixed by this spec)

1. `api_calls.status_code` is hard-coded to `200` (`legacy-game-adapter.ts:774`); the engine's failure branch also hard-codes provider/model (`game-engine.js:5175-5176`). 25,612/25,612 rows in the live DB are `200` with no error text.
2. `/health` is unconditional and cannot fail (`apps/server/src/index.ts:146-148`); Docker treats it as authoritative (`docker-compose.yml:27`).
3. `game-engine.js` carries a second, mangled copy of the failure branch at `:4884-4894` (inside the budget check, referencing an undefined `estimatedCost` path) — the metric must be sourced from the adapter, not the engine's internal counters.
4. Orphaned `IN_PROGRESS` games are retired only at startup (`apps/server/src/index.ts:101`) or on read; the repo DB holds rows from 2026-07-17.
5. `LOG_LEVEL` is advertised in `.env.sample` and read by nothing.
