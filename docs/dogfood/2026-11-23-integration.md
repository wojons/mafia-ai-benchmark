# Dogfood Integration Report — 2026-11-23 (tick mafia-ai-benchmark-dogfood-2026-11-23-15-19-10)

## What this run did

Fifteenth recorded run; first re-walk since the 11-20 records-only delivery. The product tree
changed meaningfully since the last verified HEAD (15a21b4): MAF-LAYER-1 landed (8a8e56d —
`mafiactl runs export/backfill`, the per-run JSONL run-record corpus), plus PERF-MAFIA-7
(report-watermark memoization), PERF-MAFIA-8 (composite index), DF-50 (mafia_game_* counters),
DF-52 (analytics real queries), DF-53 (corrupt IN_PROGRESS flagging), DF-53/DF-41-R3 (dashboard
win totals). The compose stack was rebuilt by the deploy-refresh timer minutes before probing
(.deploy-stamp == HEAD ec45163, containers < 10 min old) — this tick measured a current stack.

## Promise under test

"Benchmark AI models' Mafia ability head-to-head via mafiactl / API :3004 / web :5174 with
trustworthy per-model win/cost stats" — extended this cycle by the layer-1 promise: every ENDED
game can be persisted as one JSONL run file + a runs index (`mafiactl runs export/backfill`).

## Real use performed

1. **mafiactl runs (NEW surface, exercised first as a user)**
   - Discovery only via `mafiactl --help` (1.81s cold tsx start). NOTHING in README/QUICK_START/docs
     names the feature → DOC-024.
   - `runs export 5f9a6afb…` warm re-export: `Run file unchanged (already exported): … 65 events`
     + `Index already contains this game (no duplicate added)` in 3.69s total (≈1.9s post-startup).
     The compare-then-skip idempotency promise holds on an independent re-drive.
   - Corpus contract verified: line 1 = header {game_id, started_at, ended_at, num_players, winner,
     seats[] (seat/player_id/provider/model/role/survived/won)}; lines 2+ = projected events in
     game order (GAME_STARTED → … AGENT_THINK/AGENT_SAYS/VOTE_CAST/NIGHT_ACTION → …); index.jsonl
     line carries the same seats.
   - Error paths are genuinely good: 404 names the URL; CANCELLED game refused with
     "refusing to export a non-terminal game"; unreachable server prints an actionable
     "Make sure the server is running: pnpm run dev --filter=@mafia/server".
   - `runs backfill` full corpus: "✅ Backfill complete — 4889 ENDED game(s) on server, 0 newly
     written, 4889 already up to date." in **BACKFILL-TOTAL 105.01s** (~21ms/game compare-then-skip).
     Idempotency proven end-to-end by an out-of-tree re-drive of the worker's claim.

2. **API surfaces (fresh numbers at HEAD, 5,095 games)**
   - /api/v1/stats 0.21–0.23s ×3 · /api/v1/benchmark/report 0.21–0.24s ×3 · dashboard warm
     0.23–0.31s ×6 (first-hit 0.92s) · /api/v1/games?limit=50 0.01s · /api/v1/games?limit=5000 0.23s.
     PERF-MAFIA-7 memoization is live: report/stats share the watermark cache.
   - /api/v1/benchmark/compare: 1.01s / 0.02s / 0.19s / 0.20s — sub-second warm, no new finding.
   - /api/v1/analytics: 1.19–1.24s ×4, still uncached per request (PERF-MAFIA-010 premise confirmed,
     corroboration event 893).
   - /api/v1/health healthy (db_write, legacy_adapter checks ok).
   - /metrics serves the DF-50 observability surface: mafia_game_active=0, mafia_game_in_progress=0,
     mafia_game_ended_total seeded "5095/5095 terminal games → 4889 ended, 206 cancelled"; duration
     histogram buckets intentionally cold (seeded counters only). Working as designed.

3. **Web walk (visitor, CDP)**
   - Stats identity holds: 5095 total / 4406 completed / 88 mafia + 4318 town = 4406, activeGames 0
     == IN_PROGRESS list (DF-53 live). Header counters populated on Games tab (32-R2 fix holds).
   - Leaderboard seat caveat present on BOTH rows incl. the 653-game uncovered mini row (39-R3 fix
     holds).
   - NEW defects (row evidence): compare.models carries 'gpt-4o-2024-08-06' (1 game) as a separate
     series from 'gpt-4o' (99); report.data.agentStats[3].model == '[object Object]'
     (DF-22 recurrence → 22-R3); report.data.recommendations crowns "Best win rate:
     OPENAI/gpt-4o-2024-08-06 (100.0%)" on n=1 → DF-MAFIA-AI-BENCHMARK-055.

## Verdict

PROMISING-BUT-ROUGH, same as prior cycles: the benchmark machinery + the new runs corpus work
honestly end-to-end with good idempotency and error quality; the report/recommendation surfaces
still leak unnormalized model keys and n=1 statistical claims, and the runs corpus is
undocumented.

## Artifacts

- Board: DF-MAFIA-AI-BENCHMARK-22-R3, DF-MAFIA-AI-BENCHMARK-055, DOC-024 + audit events 892/893.
- Install leg: bunker-qa.sh launch (detached battery, agent 6aa4e1b3, evidence
  /tmp/bunker-qa-evidence-20261123T160347Z-1489497.jsonl) — graded in the dogfood-log entry.
- Perf: no new PERF row — nothing user-felt above filed rows; corroboration numbers live in the log.
