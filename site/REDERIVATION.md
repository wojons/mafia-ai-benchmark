# Re-derivability verification — 2026-11-26

Verification that every headline number the site publishes in
`site/_data/aggregate.jsonl` can be independently re-derived from the raw
MAF-LAYER-1 corpus (`data/runs/*.jsonl`), bypassing the site pipeline
entirely (no `mafiactl`, no `data/metrics/`).

## Corpus state at verification

- `data/runs/index.jsonl`: 4,899 rows, all 4,899 run files present on disk.
- Site regenerated same session from the full corpus:
  `python3 scripts/generate_site.py --runs 4899`
  → 4,899 replay pages + index + leaderboard (8 model rows).

## Method

For every run file, the header is line 1 of the JSONL (the same header the
metrics deriver consumes). From those headers only:

- `games_played(model)` = count of distinct `game_id`s containing at least
  one seat with that model.
- `win_rate(model)` = (seats with `won == 1`) / (seats with `won != null`),
  per seat — matching the aggregator's per-seat definition in
  `apps/cli/src/metrics-format.ts` (`aggregateModels`).

Recompute script (run this session, output pasted below):

```
python3 /tmp/rederive_mafia_2947.py
```

Core logic (stdlib only):

```python
# per run file: header = json.loads(first line of <game_id>.jsonl)
# per seat with a non-empty model:
#   games[model].add(game_id)
#   if seat.won is not None: decided[model] += 1; wins[model] += won == 1
# games_played = len(games[model]); win_rate = wins[model] / decided[model]
```

Comparison: recomputed `games_played`, `win_rate.value` (exact float
equality, tolerance 1e-9) and `win_rate.n` vs `site/_data/aggregate.jsonl`.

## Results — top 3 models by games_played

| Model              | games_played (recomputed) | games_played (site) | win_rate (recomputed) | win_rate (site)  | win_rate n (rec/site) | Verdict |
| ------------------ | ------------------------- | ------------------- | --------------------- | ---------------- | --------------------- | ------- |
| openai/gpt-4o-mini | 4215                      | 4215                | 0.7968169255694273    | 0.7968169255694273 | 20986 / 20986       | MATCH   |
| openai             | 208                       | 208                 | 0.5505376344086022    | 0.5505376344086022 | 1860 / 1860         | MATCH   |
| openai/gpt-4o      | 42                        | 42                  | 1.0                   | 1.0               | 237 / 237            | MATCH   |

## Results — all 8 published model rows

| Model                    | games (rec) | games (site) | win_rate rec vs site           | Verdict |
| ------------------------ | ----------- | ------------ | ------------------------------ | ------- |
| CUSTOM/gpt-4o-mini       | 1           | 1            | 1.0 = 1.0                      | MATCH   |
| CUSTOM/qwen3.6-35b-fast  | 1           | 1            | 0.5 = 0.5                      | MATCH   |
| OPENAI/gpt-4o-2024-08-06 | 1           | 1            | 0.8 = 0.8                      | MATCH   |
| gpt-4o-mini              | 3           | 3            | 0.7692307692307693 = same      | MATCH   |
| openai                   | 208         | 208          | 0.5505376344086022 = same      | MATCH   |
| openai/gpt-4o            | 42          | 42           | 1.0 = 1.0                      | MATCH   |
| openai/gpt-4o-mini       | 4215        | 4215         | 0.7968169255694273 = same      | MATCH   |
| openai/qwen3.6-35b-fast  | 10          | 10           | 0.7741935483870968 = same      | MATCH   |

## Verdict

**MATCH** on all 8 rows — recomputed and published numbers are bit-identical
(floats compared exactly; none required rounding). No MISMATCH rows to report.

## Data-quality note (does not affect published numbers)

One corpus event, run `81d7e1be-592a-48bb-96a3-cf5b9aee9f58` (event id
`6d6b8810…`, NIGHT_ACTION_SUBMITTED), carries
`"playerName":["Marco","Meyer","Yang"]` — a list where the schema expects a
string. A full scan of all 4,899 run files found this to be the only
non-string name in the corpus. The site generator's `seat_names()` gained a
two-line type guard (skip non-string `playerName`/assignment names; the
"Seat N (role)" fallback then applies) so replay rendering tolerates it.
Game-level metrics and every aggregate number are unaffected (they come from
the header's `seats[]`, which is well-formed).
