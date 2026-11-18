#!/usr/bin/env bash
# OBS-007 drift-check: compare the repo-pinned fleet-monitor Prometheus config
# (this directory) against what the mon-prometheus container ACTUALLY loads on
# fleet-monitor.
#
# Checks three things:
#   1. both pinned rule files are byte-identical (md5) to the live rule files
#      under the container-mounted rules dir
#   2. the pinned mafia-ai-benchmark scrape-job block is byte-identical to the
#      block inside the file the container actually MOUNTS:
#      /root/fleet-monitoring/stack/prometheus/prometheus.yml
#      (the container mount is the source of truth — see docs/observability-spec.md §5)
#   3. the mounted prometheus.yml is byte-identical to the bare mirror at
#      /root/fleet-monitoring/prometheus/prometheus.yml (if the mirror drifts,
#      this warns — the mounted path is the one that counts)
#
# Exit codes: 0 = in sync, 1 = drift detected, 2 = could not reach host.
#
# Usage:  bash docs/ops/fleet-monitor/drift-check.sh
# Env:    FLEET_MONITOR_HOST (default: fleet-monitor ssh alias)
#         FLEET_MONITOR_PROM (mounted prometheus.yml path)
#         FLEET_MONITOR_RULES (mounted rules dir)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${FLEET_MONITOR_HOST:-fleet-monitor}"
PROM="${FLEET_MONITOR_PROM:-/root/fleet-monitoring/stack/prometheus/prometheus.yml}"
PROM_MIRROR="${FLEET_MONITOR_PROM_MIRROR:-/root/fleet-monitoring/prometheus/prometheus.yml}"
RULES="${FLEET_MONITOR_RULES:-/root/fleet-monitoring/alerts/rules}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rc=0

# --- helper: md5 of a remote file
remote_md5() {
  ssh -o ConnectTimeout=10 "$HOST" "md5sum '$1'" 2>/dev/null | awk '{print $1}'
}

if ! ssh -o ConnectTimeout=10 "$HOST" true 2>/dev/null; then
  echo "FAIL: cannot reach $HOST (ssh); cannot verify drift."
  exit 2
fi

# --- 1. rule files, byte-faithful
for f in mafia-ai-benchmark.yml mafia.yml; do
  l="$(md5sum "$HERE/rules/$f" | awk '{print $1}')"
  r="$(remote_md5 "$RULES/$f")"
  if [ "$l" = "$r" ]; then
    echo "OK   rules/$f == $RULES/$f ($l)"
  else
    echo "FAIL rules/$f ($l) != live $RULES/$f ($r)"; rc=1
  fi
done

# --- 2. scrape-job block inside the MOUNTED prometheus.yml
# Anchor the block by its first and last lines (comment header -> labels line).
awk '/^  # OBS-004 \(mafia-ai-benchmark\)/{f=1} f{print} /service: mafia-server/{if(f) exit}' \
  "$HERE/prometheus-job-mafia-ai-benchmark.yml" > "$TMP/local.block"
ssh "$HOST" "awk '/^  # OBS-004 \\(mafia-ai-benchmark\\)/{f=1} f{print} /service: mafia-server/{if(f) exit}' '$PROM'" > "$TMP/live.block" 2>/dev/null
if diff -u "$TMP/local.block" "$TMP/live.block" > "$TMP/block.diff" 2>&1; then
  echo "OK   scrape-job block == mounted $PROM"
else
  echo "FAIL scrape-job block differs from mounted $PROM:"; cat "$TMP/block.diff"; rc=1
fi

# --- 3. mirror vs mounted (warn only: mounted path is authoritative)
l="$(remote_md5 "$PROM")"
r="$(remote_md5 "$PROM_MIRROR")"
if [ "$l" = "$r" ]; then
  echo "OK   mounted prometheus.yml == bare mirror"
else
  echo "WARN mounted $PROM ($l) != bare mirror $PROM_MIRROR ($r); the MOUNTED path is what the container loads."
fi

exit $rc
