# Sync-Twin Integration Contract

## Overview

The mafia-ai-benchmark repository has a **sync twin**: a DuckBrain namespace
`mafia-benchmark` maintained every tick by the `mafia-benchmark-sync` data
skill (scheduler project `mafia-benchmark-sync`, cooldown 21600s).

The sync twin is a **consolidated layer only**: the foreman third-writer owns
per-tick detail. The sync writes window-summaries, never tick-level noise.

Contract sources (authoritative real-use recipe):
`~/.hermes/skills/data/mafia-benchmark-sync-data/dogfood-2026-08-28.md` and the
cheat sheet `context-sync-duckbrain/references/mafia-benchmark-project-sync.md`.
The dogfood report of 2026-08-28 documents the verified end-to-end run.

## Per-tick /sync markers

Every tick MUST write BOTH markers, even when it decides "nothing new" — a
no-op tick should be visible as a marker, not as an absence (GAP-001 fix
direction).

| Key | Domain | Contents |
|-----|--------|----------|
| `/sync/write-test-YYYY-MM-DD` | `config` | Rotating daily key; written by the preflight step |
| `/sync/last-run` | `config` | Window + writes + verification note |

A freshness guard is planned: if `/sync/last-run` is older than the tick
window and the repo has in-window commits, write the status window-summary
unconditionally (GAP-001).

## Data-skill flow

Write via the DuckBrain HTTP API:

```
POST /api/memories?namespace=mafia-benchmark
X-API-Key: <key from ~/.duckbrain/auth.json apiKeys[0]>
```

Batch keys (consolidated layer ONLY — never tick detail; foreman owns that):

| Key | Domain | Contents |
|-----|--------|----------|
| `/project/mafia-benchmark/status` | `event` | Window summary, ticks, escalations |
| `/project/mafia-benchmark/recent-commits` | `event` | Commit list + HEAD + parity |
| `/project/mafia-benchmark/live-stats-YYYY-MM-DD` | `event` | In-container report numbers |
| `/sync/last-run` | `config` | Window + writes + verification note |

Recall verification:

```
GET /api/memories?prefix=<key>&namespace=mafia-benchmark&limit=20
```

Locate by **UUID, NOT position** — recall order is mixed (the status
accumulator is the worst offender).

## config/ vs event/ domain split

Keys are split on disk by domain:

- `config`-domain keys → `namespaces/mafia-benchmark/config/YYYY-MM/current.jsonl`
- `event`-domain keys → `namespaces/mafia-benchmark/event/YYYY-MM/current.jsonl`

Verification MUST grep BOTH directories (friction 1 from the dogfood report:
a first verify pass grepping `event/` only falsely reported 2 FAILs for
`config`-domain keys).

## Verification & halt rules

1. Every write is verified **two ways**:
   - API recall (`GET /api/memories?prefix=<key>&namespace=mafia-benchmark&limit=20`),
     locating by UUID
   - JSONL grep (authoritative), on both
     `namespaces/mafia-benchmark/event/YYYY-MM/current.jsonl` AND
     `namespaces/mafia-benchmark/config/YYYY-MM/current.jsonl`
2. HALT rule: ≥2 write failures → stop and report. 1 failure → continue + note.

## Pitfalls

- Host `localhost:3000` is the **DuckBrain daemon** — mafia server live checks
  MUST be `docker exec mafia-ai-benchmark-server-1 wget -qO- http://localhost:3000/...`.
- Never `docker exec ... wget -O /tmp/file` — writes INSIDE the container;
  redirect stdout to a host file instead.
- Scheduler ticks endpoint: `GET http://127.0.0.1:9090/api/v1/ticks?project=<name>&limit=N`.
  `/api/v1/projects/X/ticks` returns 405.
- Board `tasks.jsonl` status field values: `open` / `in_progress` / `todo` /
  `pending` / empty — no one-liner documented; read the file directly.
- `mafiaWinRate` is historically unreliable — record it, never assert on it;
  do NOT hardcode expectations.
- Window-accumulator keys (status/recent-commits/live-stats) coexist under the
  same key prefix across windows — both entries present is normal.
