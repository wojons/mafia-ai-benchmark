# fleet-monitor Prometheus config — pinned copies (OBS-007)

This directory is the in-repo pin of the observability surface that
`docs/observability-spec.md` §5 documents. Everything here was pulled
byte-faithful from `fleet-monitor` (host `100.122.154.108`, ssh alias
`fleet-monitor`) on 2026-11-17.

## What is pinned

| File | Live source (what the container actually loads) |
|---|---|
| `prometheus-job-mafia-ai-benchmark.yml` | the `# OBS-004 (mafia-ai-benchmark)` job block inside `/root/fleet-monitoring/stack/prometheus/prometheus.yml` — the file the `mon-prometheus` container MOUNTS as `/etc/prometheus/prometheus.yml` |
| `rules/mafia-ai-benchmark.yml` | `/root/fleet-monitoring/alerts/rules/mafia-ai-benchmark.yml` (mounted at `/etc/prometheus/rules/`) |
| `rules/mafia.yml` | `/root/fleet-monitoring/alerts/rules/mafia.yml` (mounted at `/etc/prometheus/rules/`) |

Ownership rule: the mounted path is the source of truth. A bare mirror at
`/root/fleet-monitoring/prometheus/prometheus.yml` also exists and was
byte-identical as of 2026-11-17, but the container mount decides what runs.

## Drift check

    bash docs/ops/fleet-monitor/drift-check.sh

Exit 0 = repo pin matches the live host; exit 1 = drift; exit 2 = host
unreachable. It never writes anything.

## Apply procedure (repo -> host)

1. Edit the pinned copies here and land the change through a PR/commit as
   usual (this repo's normal review path).
2. On `fleet-monitor`, apply the same edits to the MOUNTED paths:
   - job block -> `/root/fleet-monitoring/stack/prometheus/prometheus.yml`
   - rules     -> `/root/fleet-monitoring/alerts/rules/*.yml`
3. Reload (Prometheus handles SIGHUP without dropping scrapes):

       ssh fleet-monitor 'docker exec mon-prometheus kill -HUP 1'

   or, for a full rules-file re-read: restart the container only if no tick
   is in flight and the reload is insufficient.
4. Validate before/after on the host:

       docker exec mon-prometheus promtool check rules /etc/prometheus/rules/mafia-ai-benchmark.yml /etc/prometheus/rules/mafia.yml
       curl -s http://127.0.0.1:9090/api/v1/rules | grep -o '"name": "Mafia[^"]*"'

5. Re-run the drift check to prove repo and host are back in sync (exit 0).

## Why this exists

Until 2026-11-17 these three files existed only on the remote host. A host
rebuild or a rules-dir cleanup would have silently dropped the
mafia-ai-benchmark scrape and both product alerts, and every `mafia_` panel
would go stale-green with no red anywhere. OBS-004's judge flagged this as
failure-mode 1; OBS-007 is the fix.
