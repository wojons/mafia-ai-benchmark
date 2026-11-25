# Static Site (MAF-LAYER-4)

A fully static site built from the benchmark corpus — run index, per-run
replays, and a model leaderboard. No runtime API dependency anywhere:
publishing is a sync of the `site/` tree, never a live API.

Live: https://wojons.github.io/mafia-ai-benchmark/ (GitHub Pages, `gh-pages`
branch, source = `gh-pages / (root)`).

## Regeneration (one deterministic command)

```bash
python3 scripts/generate_site.py [--runs N] [--corpus-dir DIR] \
    [--metrics-dir DIR] [--out DIR]
```

Defaults: `--runs 300`, `--corpus-dir data/runs` (falls back to the primary
checkout's corpus when run from a worktree), `--metrics-dir data/metrics`,
`--out site`. Requires python3 stdlib only, plus the built mafiactl CLI when
derived metrics are missing:

```bash
pnpm --filter @mafia/shared build && pnpm --filter @mafia/cli build
```

What it does:

1. Reads `data/runs/index.jsonl` and selects the **most recent N runs** (site
   cap = 300 by default; the cap keeps the static tree small — the full corpus
   has ~4,900 runs / 159 MB. The cap is stated on the index page).
2. Ensures layer-2 metrics exist for every selected run; missing ones are
   derived by invoking the real mafiactl CLI (`metrics derive`) — the site
   never invents metrics. Aggregation (`metrics aggregate`) also runs through
   the CLI over exactly the selected runs.
3. Emits `site/`:
   - `index.html` — run index (date, winner, players, models, link to replay)
   - `runs/<game_id>.html` — one replay page per run: stage-by-stage playback
     (setup/night actions/morning reveal/discussion & voting/game over) with
     prev/next controls, a clickable stage timeline, and the full event log.
     Private THINK content is hidden behind a "show private THINK" toggle
     (default hidden).
   - `leaderboard.html` — per-model leaderboard from the layer-2 aggregate:
     games played, win rate, survival overall and per role, vote accuracy,
     persuasion, lie rate — sortable on every column (vanilla JS), each value
     showing its sample n; n < 5 carries the `*` low-sample marker; "n/a"
     means no sample (never fabricated as 0).
   - `_data/aggregate.jsonl` — the raw layer-2 aggregate rows for transparency.

Numbers are real derived numbers, even when bad. Deterministic: re-running
the command on the same corpus reproduces byte-identical output (no
timestamps are embedded).

## Re-deploying (publish = sync)

The live site is the `gh-pages` branch rooted at the site tree:

```bash
# from a clone (orphan branch so the branch contains ONLY the site tree):
git clone --no-checkout git@github.com:wojons/mafia-ai-benchmark.git /tmp/mab-pages
cd /tmp/mab-pages
git checkout --orphan gh-pages
git reset --hard
cp -r <repo>/site/. .
git add -A && git commit -m "publish: regenerate static site from corpus"
git push origin gh-pages
```

Pages source is enabled once via the GitHub API:

```bash
gh api -X POST repos/wojons/mafia-ai-benchmark/pages \
  -f "source[branch]=gh-pages" -f "source[path]=/"
# (409/already exists → use `gh api -X PUT ...` with the same fields)
```
