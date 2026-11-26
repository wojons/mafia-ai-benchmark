# League Weekly Operating Note — 2026-11-25

Status: weekly note for the mixed-model league schedule (MAF-INIT-002).
Written 2026-11-26 (covering 2026-11-25 local). Every number below is from
a file read or an API response captured this session; sources cited inline.

## What ran

- The schedule is armed: crontab `7 */4 * * *` (six fires/day at
  00:07/04:07/08:07/12:07/16:07/20:07 local) against
  `scripts/league-cron.sh`. Real mode was validated at 20:07 -05 on
  2026-11-25: run `a2f624d5-06c6-4bc4-bc91-053113a061b7`, COMPLETED after
  663 s, 2 games exported.
- One additional accelerated run was triggered the same day, inside the
  daily cap: run `42f51484-0f66-4f83-8cef-b6330d9acb73`, COMPLETED after
  722 s, 2 games exported (both TOWN wins).
- `~/.local/state/mafia-league/daily-spend.json` ended the day at
  `{"date":"2026-11-25","spendUsd":4.000000}` — upper-bound accounting
  (4 runs x $0.80 budget), never a real bill.

## Mixed-gate progress

`grep -c '"provenance":"mixed"' data/runs/index.jsonl` (4,899 rows total):

- Before this week's work: **8** mixed games.
- After: **10** mixed games (the two exports of run 42f51484:
  `b8c4289b`, `7f075f96`).
- Board gate wants >= 20: **10/20**. At 2 mixed games per run, ~5 more
  scheduled runs (~1.5 days at the six-fire cadence) clear it, budget
  permitting.

## What it cost

Actual per-run cost comes from the league detail endpoint
(`GET /api/v1/league/:id`, token_usage rollups):

| Run        | Actual spend | Upper bound recorded | Games |
| ---------- | ------------ | -------------------- | ----- |
| `a2f624d5` | $0.1269      | $0.80                | 2     |
| `42f51484` | $0.1387      | $0.80                | 2     |

Actual is ~6x under the bound the client books. Per-game detail:
`a2f624d5` = $0.09068605 (559,822 tokens) + $0.03621155 (197,938);
`42f51484` = $0.03697495 (203,152) + $0.10169465 (624,846).

## What the numbers say — mixed games only (10 games)

All 10 mixed games ended TOWN (winners from `data/runs/index.jsonl`).
Per-seat outcomes by model (`won`/`survived` flags on each game's `seats[]`):

| Model                   | Seats | Seat wins | Survived | Mafia seats (won) |
| ----------------------- | ----- | --------- | -------- | ----------------- |
| openai/gpt-4o-mini      | 38    | 32        | 25       | 6 (0)             |
| openai/qwen3.6-35b-fast | 62    | 48        | 11       | 14 (0)            |

Mafia won 0 of 20 mafia seats and none of the 10 games — with only 2 mafia
seats per 10-player game, town wins are the historical norm in this corpus,
so this is a small-sample observation, not a model verdict. Qwen's overall
survival is much lower than gpt-4o-mini's (11/62 vs 25/38) but both share
the same mafia-seat zeros; the role mix differs per game (qwen held the
MAFIA and VILLAGER-heavy deals).

## Site

The static site (`site/`) was regenerated from the live corpus
(`python3 scripts/generate_site.py --runs 300`): leaderboard now includes
`openai/qwen3.6-35b-fast` (10 games in the 300-run window) and all 10 mixed
replay pages. Every published number is re-derived from
`data/runs/*.jsonl` via `mafiactl metrics derive` + `metrics aggregate`
(`site/_data/aggregate.jsonl` is the raw intermediate). GitHub Pages is
still NOT enabled — no live URL exists yet.

## Open items

1. Mixed gate: 10/20 — keep the schedule running; ~5 runs remain.
2. Pool: still the two ratified OpenRouter models; the xkiro pool stays
   pending server credentials.
3. GitHub Pages enablement is an admin-gated repo setting.

---

## Addendum — 2026-11-26 (MAF-INIT-002 closure leg: full-corpus site regen + gate status)

Written the day after the body above; supersedes the "Mixed-gate progress"
counts (8→10) and the "Site" section's 300-run window. Same evidence
discipline: every number from a file read or an HTTP response this session.

### Corpus gate status (AC3)

- `data/runs/index.jsonl` now holds **4,899** games, **55** flagged
  `"provenance":"mixed"`.
- Of the 55, **27 have complete per-seat provider+model provenance on every
  seat**; **28 are excluded** for at least one seat missing provider or
  model attribution.
- Gate wants >= 20 fully-provenanced mixed games: **27/20 — MET**.

### Site regenerated from the FULL corpus

`python3 scripts/generate_site.py --runs 4899` → 4,899 replay pages,
`site/_data/aggregate.jsonl` with 8 model rows, leaderboard and index
reflecting the entire corpus (mixed and single-model), not the old
300-run window. One render crash surfaced a corpus data quirk: run
`81d7e1be…` carries a list-valued `playerName` in one event — the only
non-string name in all 4,899 files; fixed with a two-line type guard in
`scripts/generate_site.py` (`seat_names()`), no numbers affected (details
in `site/REDERIVATION.md`).

### Re-derivability (AC4 gate arm): MATCH

Independent recompute from the raw run-file headers (bypassing `mafiactl`
and `data/metrics/` entirely) reproduces every published headline number
bit-exactly: all 8 model rows MATCH on `games_played`, `win_rate.value`
and `win_rate.n` — including the top three: openai/gpt-4o-mini 4,215
games @ 0.7968 win rate (n=20,986), openai 208 @ 0.5505 (n=1,860),
openai/gpt-4o 42 @ 1.0 (n=237). Method, commands and full table:
`site/REDERIVATION.md`.

### Site-live status: NOT live (404) — pending one-time admin enable

`https://wojons.github.io/mafia-ai-benchmark/` returned **404** as of
2026-11-26 (verified live this session). This is NOT "live" and must not
be reported as such anywhere. Cause: GitHub Pages is not enabled on the
repo, and the current push-scope identity cannot enable it (POST /pages
returned 404). Pending one-time admin enable:
**Settings -> Pages -> Deploy from a branch -> gh-pages**. The regenerated
site tree is committed on `main` (`site/`); syncing it to `gh-pages`
happens at push time, after which the URL above should serve it.

