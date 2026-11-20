# Ops tick — mafia-ai-benchmark-ops-2026-11-20-06-50-39

Lane: ops (read-only census first, one finding filed). Canonical root: ~/wojons/mafia-ai-benchmark
(origin git@github.com:wojons/mafia-ai-benchmark.git). Published tip at tick start: 5f626c7.

## 1. Service liveness — HEALTHY

    $ curl -s -o /dev/null -w 'health=%{http_code} t=%{time_total}' localhost:3004/health
    health=200 t=0.003716
    $ curl -s -o /dev/null -w 'web=%{http_code} t=%{time_total}' localhost:5174/
    web=200 t=0.008008
    $ curl -s -o metrics.txt -w 'metrics=%{http_code} bytes=%{size_download}' localhost:3004/metrics
    metrics=200 bytes=116617

Scrape integrity: 1242 `mafia_` series, 108 `mafia_llm_request_total` series,
`mafia_server_up{version="1.2.0"} 1`, `mafia_game_active 0`, `mafia_game_in_progress 0`,
`mafia_benchmark_run_stranded 0`.

## 2. Host reboot recovery — PROVEN AUTOMATIC (no action needed)

    $ who -b            -> 2026-11-20 00:59   (host booted ~59 min before this tick)
    $ docker inspect mafia-ai-benchmark-server-1 \
        --format 'started={{.State.StartedAt}} restarts={{.RestartCount}} ...'
    server: StartedAt=2026-11-20T05:59:19Z FinishedAt=2026-11-20T05:59:13Z exit=0
            RestartCount=0 health=healthy FailingStreak=0  policy=unless-stopped
    web:    StartedAt=2026-11-20T05:59:19Z FinishedAt=2026-11-20T05:59:13Z exit=0
            RestartCount=0                               policy=unless-stopped

Both containers stopped cleanly (exit 0) with the host and were started 19 s after boot by
their `unless-stopped` policy. Reboot survivability is therefore measured, not assumed.

## 3. Deployed artifact freshness — CLEAN

    $ head -n1 .deploy-stamp                  -> 5f626c7c4ddbc4bdd939664680f066004ca16deb
    $ git rev-parse HEAD                      -> 5f626c7c4ddbc4bdd939664680f066004ca16deb
    image Created 2026-11-18T23:34:39Z ; HEAD commit date 2026-11-18T22:33:48Z
    $ git rev-list --count --since='2026-11-18T23:34:39Z' HEAD -> 0

Deploy-refresh rebuilt the stack after the newest commit and the stamp matches HEAD, so the
live image is not stale relative to main. No redeploy performed (nothing to redeploy).

## 4. Resource footprint — NOT the host's load source

    $ docker stats --no-stream
    mafia-ai-benchmark-server-1  cpu=0.34%  mem=62.96MiB
    mafia-ai-benchmark-web-1     cpu=0.00%  mem=12.54MiB

Host shows load 13.5–26.4 on 16 cores and 84% root-fs use, but this project contributes
<1% of one core and its DB is 195 MiB. The load is other tenants (e.g. GitHub Actions runner
build at 109.68% of one core) — not something this project has to fix, and not restarted.

## 5. Live data inventory (from the service's own scrape)

    mafia_storage_bytes 204656640
    mafia_storage_rows{table="games"}         5087
    mafia_storage_rows{table="players"}       19270
    mafia_storage_rows{table="events"}        200119
    mafia_storage_rows{table="api_calls"}     25752
    mafia_storage_rows{table="token_usage"}   25662
    mafia_storage_rows{table="benchmark_runs"} 269

## 6. THE FINDING — this database has no backup anywhere

Every arm below was probed read-only, and each came back empty:

| arm | command | result |
|---|---|---|
| repo scripts | `ls scripts/` (11 scripts: deploy-refresh{,-cron}.sh, release{,-test}.sh, e2e-smoke-test.sh, gitreins-guard.sh, install-gitreins-hook.sh, check-usage-skill-coaching{,.test}.mjs, qa15-wiring.mjs, sync-test-counts.mjs) | no backup/restore script |
| repo docs | `grep -rin 'backup\|restore' README.md docs/*.md` | 0 matches (the only "restore" is COST_TRACKING event replay) |
| ops docs | `ls docs/ops` | only `fleet-monitor/`; no DR/runbook page |
| Hermes cron | `jq '.jobs[]' ~/.hermes/cron/jobs.json` filtered backup/snapshot/dump/mirror | 8 jobs, all Hermes state / DuckBrain / git mirrors — none covers this product DB |
| home backups | `find ~/backups -maxdepth 3 -iname '*mafia*'` | 0 hits (only cube-agent tarballs) |
| bulk backups | `find /mnt/bulk/hermes-backups -maxdepth 2 -iname '*mafia*'` | 0 hits |
| volume access | `ls /var/lib/docker/volumes/mafia-ai-benchmark_data/_data` | Permission denied (root-owned) — an out-of-container copy needs escalation |

Why it matters: `token_usage` (25,662 rows) is real provider spend and `games`/`events`
(5,087 / 200,119) are paid LLM-run history. Re-running the benchmark would re-buy every
token, so this data is not regenerable — losing the volume loses the money and the
published leaderboard's record. Blast radius is one root-owned volume on one host.

Not restarted, not rebuilt, nothing deleted: the fault named here is the absence of a
recovery path, not a running-service fault.
