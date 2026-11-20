# Evidence — dogfood tick 2026-11-20 (delivery 3 records salvage)

## Provenance

- Produced by delivery 1 of tick `mafia-ai-benchmark-dogfood-2026-11-20-14-19-33`
  (gateway dispatch 09:19:40 -05) during its 09:19-10:08 window, against the live
  deployment on this host: API :3004 / UI :5174, product HEAD `2b780d3`
  (the MAF-GAP-075 backup/restore capability), board commit `15a21b4`.
- Salvaged by delivery 3 (dispatch 10:28:11 -05) from
  `/home/kara/.hermes/cache/scratch/df-mab-1120/` — a scratch tree pruned after
  24h idle — before the rows' citations could rot into unverifiable prose.
- The five rows these probes support (all `pending`, unchanged by this salvage):
  `DF-MAFIA-AI-BENCHMARK-41-R3`, `DF-MAFIA-AI-BENCHMARK-50`, `PERF-MAFIA-7`,
  `DOC-022`, `DF-MAFIA-AI-BENCHMARK-51` (paired `task_created` events 855-859
  backfilled in the same repair commit).

## Files

| file | what it is |
|---|---|
| `probe.sh` | delivery 1's surface probe driver (live API health/stats/dashboard/metrics reads) |
| `n1_probe.py` | the N+1 measurement behind PERF-MAFIA-7 (706 ms of the dashboard's 1.52-1.95 s) — reads a local copy of the product DB |
| `n1.js` | earlier JS iteration of the same N+1 probe |
| `dashboard.json` | GET /api/v1/dashboard capture used for the win-population mix (DF-41-R3) |
| `stats.json` | GET /api/v1/stats capture (completed-games denominator side of DF-41-R3 / DF-50) |
| `backup.out` / `backup.err` | documented backup path run: `scripts/backup-db.sh`, 7.9 s, verified counts |
| `drill.out` / `drill.err` | documented restore drill run: `scripts/restore-drill.sh`, 1.16 s |
| `rows.jsonl` | delivery 1's staged row drafts (provenance for the 5 rows; the landed copies live on the board at `15a21b4`) |
| `commit-msg.txt` | delivery 1's commit message draft for `15a21b4` |

## NOT salvaged

- `stats-probe.db` (205 MB): a COPY of the production product DB made for the N+1
  probe. Excluded by `.gitignore` `*.db` and by the no-real-data rule; `n1_probe.py`
  is committed so the reads that produced PERF-MAFIA-7 stay reproducible against a
  fresh local copy.

## Transformations (disclosed)

1. `rows.jsonl`: 2 self-referential citations of the scratch path rewritten to this
   in-repo evidence path (so the citations survive the scratch prune). No field
   other than those path strings changed; row ids re-parsed post-edit.
2. `n1_probe.py`: ruff-formatted + E401 auto-fix (imports split) for the lint gate.
   The committed bytes are NOT the bytes that ran this morning; the probe was not
   re-driven (the tree is unchanged since delivery 1 measured it — re-driving
   measures the host, not the product). PERF-MAFIA-7's numbers remain delivery 1's.
3. Loopback URLs (`localhost:3004`) left as-is; no host-home or tailnet literals
   remain in the directory (checked post-edit).

## Install leg (this delivery): battery died at the harness floor; product install PROVEN manually

- Battery `16c23fac` on `bunker-las-03`, QA HEAD `15a21b4`, launched 15:34Z —
  DIED ~3.5 min in: 15 evidence rows, NO `qa-run.finished` marker,
  `qa-run.log` ends at the bootstrap WARN.
- Floor root cause (pinned): `corepack enable` →
  `EACCES: permission denied, symlink '../lib/node_modules/corepack/dist/pnpm.js' -> '/usr/bin/pnpm'`
  (rootless agent user + system node) → no `pnpm` on PATH → downstream cells
  grade 127/ENV-BLOCKED; runner died without completing cells.
  HARNESS defect, fleet-owned (`bunker-qa.sh` is not product code): fix direction
  `corepack enable --install-directory "$HOME/.local/bin"` (its own toolchain cell
  already installs act into `~/bin`) or invoke `corepack pnpm` directly.
- Product install, same agent, manual probe with the shim in `~/bin`:
  `corepack pnpm install --frozen-lockfile` rc=0 28.9s → `pnpm build` rc=0
  (turbo 27.4s, 29s wall on a host at ~177% CPU) → documented dev start with NO
  `.env`, PORT=3911 → `/health` 200 (11ms), `/api/v1/games` 200 (3ms), server
  killed cleanly. **Fresh install PROVEN at HEAD 15a21b4 on the designated host.**
- The harness collector aborted twice (`ssh probe returned no state`) while
  `bunker exec` answered throughout — evidence pulled by hand into
  `battery-las03/` (15-row ledger + qa-run.log + pnpm.log). Collector probe
  defect, not a missing agent.
- Agent `16c23fac` destroyed (first refusal: 5 orphaned `tail` pids from my own
  exec sessions → pkill → destroy clean), verified absent from `bunker list`.

