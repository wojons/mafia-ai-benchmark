# Dogfood Integration Report — 2026-09-26 (benchmark-campaign angle)

**Angle:** runs 1-7 swept web/WS/API/stats/install surfaces. This run took the
project's namesake flow nobody had driven end-to-end: a **full CLI benchmark
campaign** — `benchmark --games 2 --models openai/gpt-4o-mini,openai/gpt-4o` —
as a real CLI user, then cross-checked every number the campaign produced
against the SQLite store.

**Verdict: PROMISING-BUT-ROUGH.** The campaign mechanism works. The numbers it
publishes do not survive cross-examination.

## Promise under test

> "A user can benchmark AI models' Mafia-playing ability via
> `mafiactl benchmark` and get real head-to-head games plus trustworthy
> per-model win/cost stats."

Reality: real head-to-head games — yes (2 games, 10 players, real LLM calls,
both ENDED with a winner, usage persisted). Trustworthy per-model stats — no.
The two flagship stat endpoints contradict each other, and the CLI's closing
verdict is derived from a polluted global report rather than the run just
played.

## The campaign, as it happened

```
$ node apps/cli/dist/index.js benchmark --games 2 \
    --models openai/gpt-4o-mini,openai/gpt-4o --timeout 25

🏁 Mafia AI Benchmark Suite
▶️  Starting benchmark: 2 game(s) per pairing across 2 model(s)
📡 POST http://localhost:3004/api/v1/benchmark ...
✅ Run started — runId: a3f14f3d-8dd9-4e18-b33b-59210e0c05e6
⏳ [RUNNING] 0/2 games completed (elapsed 2s … 211s)
⏳ [RUNNING] 1/2 games completed (elapsed 225s)
⏳ [COMPLETED] 2/2 games completed (elapsed 233s)
🎉 completed — 2/2 games (2 valid, 0 failed)
```

Then the report printed — including `🏆 Winner: openai/gpt-4o (76.1% win
rate, 88 games)` — which is **not about the 2 games just played** (see DF-28).

Measured on the live API after the run:

- Both games `status=ENDED, winner=TOWN` (~225s and ~232s).
- `benchmark_games` rows carry `winner/team_winner` after adapter closeout.
- Usage persisted: ~100.8K tokens / $0.0187 and ~100.6K / $0.0189 per game.
- Run row: `status=COMPLETED`, but `summary` is **NULL** (all 24 runs ever,
  including this one).

## Numbers that failed cross-examination

| Claim | Source | Store says |
|---|---|---|
| mini 72.7% over **2400** games | `/benchmark/report` | players table has mini rows in ≤1743 distinct ENDED games; 2400 only reachable from token_usage game_ids (2398) — different table, folded by the multi-source merge (models.ts:503-612) |
| mini **99.8%** over 1729 games | `/benchmark/compare` | counts a game won if ANY mini seat was on the winning side; mini holds ~4.8/10 seats → P(win)≈1−0.2^4.8≈99.97%. It measures team share, not skill (its own rolePerformance: VILLAGER 99.5%) |
| mafiaWinRate **8%** | report summary | games.winner empty on 1609/2873 ENDED rows (56%); zero GAME_OVER events; benchmark_games.team_winner (where filled) says ~36% mafia |
| "Winner: gpt-4o 76.1%" | CLI banner | quotes the all-time report; this run's 2 games both went TOWN |

Rows filed: DF-MAFIA-AI-BENCHMARK-25 (P0), -26 (P1), -28 (P2) on the board.

## Working recipe (for the next user)

```bash
# Non-TTY-safe invocation (documented pnpm form dies in cron/CI/agent shells, DF-27):
node apps/cli/dist/index.js benchmark --games 2 \
  --models openai/gpt-4o-mini,openai/gpt-4o
# …or CI=true pnpm --filter @mafia/cli dev -- benchmark ...

# Run-scoped truth (NOT the report table):
curl -s localhost:3004/api/v1/benchmark/<runId>          # status + progress
sqlite3 -readonly data/mafia.db "SELECT game_id, model_a, model_b,
  winner, team_winner FROM benchmark_games WHERE run_id='<runId>';"

# A defensible per-model win rate today = compute it yourself:
curl -s localhost:3004/api/v1/games/<id>   # per player: role, won, tokensUsed
```

## Errors hit while using it (the user's view)

1. `pnpm --filter @mafia/cli dev -- benchmark --quick` →
   `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY]`, exit 1, twice (deterministic).
   Workaround `CI=true` works (6.1s). Undocumented. → DF-27.
2. CLI banner verdict disagrees with the run it just finished. → DF-28.
3. Report vs compare disagree by 27 points / 671 games for one model. → DF-25.
4. Summary 8% mafia win rate is 4x below the store's own per-game record. → DF-26.
5. (Not re-filed, prior runs) WS live spectate still delivers zero events —
   SSE works; run status endpoint works.

## What worked well (credit where due)

- POST→poll→report CLI flow: clean progress lines, honest `--timeout` handling,
  clear error message when the server is down (caught and explained ECONNREFUSED).
- Game orchestration is solid: two concurrent 10-player legacy games, zero
  failed games, correct winner persistence, per-player usage rows, ~$0.037
  total cost for the campaign.
- The 400-response_format warnings in engine stderr degrade gracefully to
  unstructured output (games still completed).
- API latency is a non-issue: report 1.2-1.4s warm (acceptable for a
  3000-game aggregate), games list 22-24ms.

## What I did NOT re-test this tick (prior runs' territory)

Web dashboard, WS protocol edge cases, fresh-install via compose/pnpm, stats
UI — see `2026-09-24-integration.md` / `2026-09-25-integration.md`.
