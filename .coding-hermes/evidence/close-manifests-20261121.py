#!/usr/bin/env python3
"""Close out stale wave manifests: 2026-11-20-16-08-00 (recovered this tick)
plus the two untracked 11-17/11-18 manifests whose work has since landed."""

import json
import pathlib

waves = pathlib.Path("/home/kara/wojons/mafia-ai-benchmark/.coding-hermes/waves")


def update(name, extra):
    p = waves / name
    d = json.loads(p.read_text())
    d.update(extra)
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    print(f"updated {name}: finished_at={d.get('finished_at')}")


update(
    "mafia-ai-benchmark-foreman-2026-11-20-16-08-00.json",
    {
        "finished_at": "2026-11-21T01:35:00Z",
        "recovery": {
            "tick": "mafia-ai-benchmark-foreman-2026-11-21-01-05-08",
            "outcome": (
                "PERF-MAFIA-8: merged 44b0f5e, tier-2 PASS 8e1816a9/a319ae8f, row complete (044629e/8489bb0). "
                "DF-MAFIA-AI-BENCHMARK-50: merged cbe7e6a, row pending awaiting async judge (dispatched this tick). "
                "DOC-022: merged 49a6d94, row pending awaiting judge. "
                "DF-MAFIA-AI-BENCHMARK-41-R3 + DF-MAFIA-AI-BENCHMARK-52: worker branches sat at base fcfdabb with zero commits "
                "(workers never delivered); dead worktrees reaped, fresh wave re-dispatched by tick 2026-11-21-01-05-08."
            ),
        },
    },
)

update(
    "mafia-ai-benchmark-foreman-2026-11-17-17-45-01.json",
    {
        "finished_at": "2026-11-21T01:35:00Z",
        "reconciliation": (
            "Reconciled by tick 2026-11-21-01-05-08: OBS-002 merged 53d85a6 and README-014 merged 2cf6090 "
            "(both rows complete on main); OBS-004 foreman-direct ops row complete. Manifest was left open by its tick; closed now."
        ),
    },
)

update(
    "mafia-ai-benchmark-foreman-2026-11-18-18-12-30.json",
    {
        "finished_at": "2026-11-21T01:35:00Z",
        "reconciliation": (
            "Reconciled by tick 2026-11-21-01-05-08: PERF-MAFIA-5 R2 landed via 4fbbf8a/merge 91a9cc2 (COS-directed), "
            "row closed 74a4328 with tier-2 PASS 1993f1b8. Leftover WIP branch wt/PERF-MAFIA-5 (886fa46, arm-2 materialization) "
            "preserved as evidence. Manifest was left open by its tick; closed now."
        ),
    },
)
