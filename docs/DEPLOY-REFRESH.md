# Deploy Refresh (DF-MAFIA-AI-BENCHMARK-38)

Automated rebuild of the docker compose stack (`server` + `web`) when the
running build predates the current git HEAD — so merged P0/P1 fixes go live
within one cadence without manual intervention (DF-17 class, 2nd recurrence).

## Mechanism

`scripts/deploy-refresh.sh`:

1. Reads the current git HEAD sha (`git rev-parse HEAD`).
2. Compares it to the stamp file `.deploy-stamp` (gitignored), which records
   the sha of the last successful rebuild.
3. If they differ **or the stamp is missing**, runs:
   - `docker compose build server web`
   - `docker compose up -d server web`
4. Updates the stamp only **after** a successful `up` — a failed rebuild never
   advances the stamp, so the next run retries automatically.
5. Exit codes: `0` = no drift (no-op) or rebuild succeeded; non-zero = rebuild
   failed.

The script is idempotent: with a fresh stamp it short-circuits before docker
is touched, so it is safe to run repeatedly (hook + timer can coexist).

Environment overrides:

| Variable | Purpose |
|---|---|
| `DEPLOY_REFRESH_STAMP` | Alternative stamp path (tests, parallel environments). |
| `DEPLOY_REFRESH_DRY_RUN=1` | Print the planned actions, execute nothing. |

## Wiring (installed on this host)

The active git `core.hooksPath` is the global `/home/kara/.hermes/hooks`, so
repo-local `.git/hooks/*` never fire on this machine. The deploy-refresh
trigger therefore does NOT rely on git hooks alone:

1. **Systemd user timer (primary backstop, fires regardless of how commits
   land):** `~/.config/systemd/user/mafia-deploy-refresh.timer` runs the check
   hourly:

   ```
   systemctl --user daemon-reload
   systemctl --user enable --now mafia-deploy-refresh.timer
   ```

   Unit files reference the repo by absolute path
   (`/home/kara/wojons/mafia-ai-benchmark`) — after a clone elsewhere, re-run
   the two install commands with adjusted paths (units are tiny; regenerate
   them verbatim from this section).

2. **Post-merge hook (immediate refresh on merges):** `.githooks/post-merge`
   (host-local, gitignored) calls `scripts/deploy-refresh.sh` after the Axiom
   release automation, on merges to the primary branch. Failures are reported
   but never abort the merge.

The timer alone satisfies "live within one cadence" (hourly); the hook makes
merges converge faster when its path fires.

## Manual use

```bash
bash scripts/deploy-refresh.sh                      # check + rebuild on drift
DEPLOY_REFRESH_DRY_RUN=1 bash scripts/deploy-refresh.sh   # show plan only
bash scripts/deploy-refresh-cron.sh                 # entry point for cron/scheduler
```

Check the timer:

```bash
systemctl --user list-timers mafia-deploy-refresh.timer
journalctl --user -u mafia-deploy-refresh.service -n 50
```

## First-run stamp bootstrap

The stamp records the sha of the last *successful rebuild*, not merely the
last check. If containers were rebuilt out-of-band (e.g. by the 10-12 manual
rebuild), the first refresh run sees a missing/stale stamp and rebuilds once,
then keeps the stamp current afterwards. To adopt the current stack without a
rebuild, write HEAD into the stamp manually:

```bash
git rev-parse HEAD > .deploy-stamp
```
