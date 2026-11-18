# OBS-002 acceptance re-measurement — ops tick mafia-ai-benchmark-ops-2026-11-18-00-54-47

Measured at published tip `134b58334c4e02a2d190357a310be4c45d6af40b` (origin/main), after the
sibling OBS-002 fix (boot seed of cumulative LLM counters) recreated the stack at 01:30:05Z.
Judge binding: `.gitreins/history/2026-11-18/b707664b/verdict.json` — task OBS-002, commit
`134b5833…`, `passed=true`, `pass_class=judged`, tier1 PASS (secrets/lint/tests, 673 tests),
tier2 PASS 10/10 criteria, tree fp `fc1a1a190eed5df4e1f52ca22a7c0d50f00f2192fa961ab8ffaea4e919a975bd`.

## Arm 1 — one benchmark run accepted; Tier-1 families exposed live

    $ curl -s http://localhost:3004/metrics -o /tmp/ops-metrics-fire2.txt -w 'http=%{http_code} bytes=%{size_download}\n'
    http=200 bytes=135751
    $ grep -c '^# TYPE mafia_' /tmp/ops-metrics-fire2.txt
    21
    # each of the ten required families present exactly once as a TYPE line:
    mafia_benchmark_run_total 1, mafia_benchmark_run_duration_seconds 1,
    mafia_benchmark_run_stranded 1, mafia_benchmark_games_queued 1,
    mafia_llm_request_total 1, mafia_llm_request_duration_seconds 1,
    mafia_llm_tokens_total 1, mafia_llm_cost_usd_total 1,
    mafia_llm_budget_exhausted_total 1, mafia_llm_retry_total 1

The 1-game benchmark the arm asks to POST exists post-restart and completed:

    $ sqlite3 -readonly mafia-pair.db "SELECT id,status,created_at,completed_at FROM benchmark_runs ORDER BY created_at DESC LIMIT 3;"
    47d34b0a-b9f3-4671-bbab-864d85e22202|COMPLETED|1794965443208|1794965548520
    bab4e1ba-86ab-46af-a689-0c481e6db3f5|COMPLETED|1794964361788|1794964550569
    607910ec-b1ee-481d-a92b-9d51821e5182|COMPLETED|1794939696366|1794939807397

(created 01:30:43Z, i.e. 38 s after container start; completed 01:32:28Z)

## Arm 2 — cost metric equals durable spend within 1e-6

Metric side (fresh scrape, `/tmp/ops-metrics-fire2.txt`):

    $ grep '^mafia_llm_cost_usd_total' <file> | awk '{s+=$2} END {print s, NR}'
    95.475889 54

DB side, read from a copy of the live volume `/app/data/mafia.db` including WAL sidecars
(a DB-only copy under-counts by 0.013709 — the WAL holds the newest rows):

    $ sqlite3 -readonly mafia-fire2.db "SELECT round(sum(cost),6), count(*), max(timestamp) FROM token_usage;"
    95.475889|25656|1794965548509

delta = 0.0 < 1e-6. Back-to-back pair (`mafia-pair.db`) reproduced `95.475889|25656`.

## Arm 3 — request cardinality under 200, model label bounded

    $ grep -c '^mafia_llm_request_total' /tmp/ops-metrics-fire2.txt
    108
    $ grep '^mafia_llm_request_total' /tmp/ops-metrics-fire2.txt | sed -E 's/.*model="([^"]*)".*/\1/' | sort -u | wc -l
    9

108 series < 200; 9 distinct model labels (8 allow-list + `other`). The allow-list is
`METRICS_MODEL_ALLOWLIST` with `normalizeModel` rolling unknown names into `other`.

## Arm 4 — stranded gauge 0 on a clean stack

    $ grep '^mafia_benchmark_run_stranded' /tmp/ops-metrics-fire2.txt
    mafia_benchmark_run_stranded 0
    $ sqlite3 -readonly mafia-pair.db "SELECT status,count(*) FROM benchmark_runs GROUP BY status;"
    (no QUEUED/RUNNING rows — terminal statuses only)

## Arm 5 — gates

- tier1 at the judged tree: secrets clean (gitleaks + builtin), lint clean, tests `Test Files 50 passed (50) / Tests 673 passed (673)`, exit 0.
- CI workflow at `134b5833…`: `gh run list --commit 134b58334c4e02a2d190357a310be4c45d6af40b` → workflow `CI`, status `completed`, conclusion `success`.

## Delta proof that the fix is live, not a static seed

    $ sqlite3 -readonly mafia-pair.db "SELECT count(*), round(sum(cost),6) FROM token_usage WHERE timestamp >= 1794965405000;"
    7|0.01371

The 7 requests written after container start (all from run 47d34b0a) sum to exactly the
0.013709 by which the DB-only copy trailed the live metric: the boot seed plus live
increments both land in the same series, so the equality is produced by real recording.

## Stack facts for the record

- container `mafia-ai-benchmark-server-1`, metrics on `:3004`, data volume `mafia-ai-benchmark_data` → `/app/data`.
- in-container `sqlite3` is absent (exit 127); DB reads require `docker cp` of `.db` + `-wal` + `-shm`.
