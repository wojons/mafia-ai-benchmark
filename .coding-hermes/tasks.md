
## Dogfood Findings (2026-09-01)
Verdict: PROMISING-BUT-ROUGH
Promise: {"entry_point":"CLI (mafiactl via apps/cli, e.g. `pnpm --filter @mafia/cli dev -- benchmark`), with a secondary HTTP entry point: Express REST API + WebSocket server (:3004, /ws) and React dashboard (:5174).","promise":"This project claims a user can benchmark the strategic-deception ability of any model head-to-head in a live Mafia game."}

- [P1] Documented benchmark command cannot complete in one invocation — `pnpm --filter @mafia/cli dev -- benchmark --models openai/gpt-4o-mini,openai/gpt-4o` (2 games x 10 players) hits the CLI's 600s RUN_TIMEOUT with 0/2 completed and exit 1; games actually average 13m42s each at 10 players.
- [P1] Model attribution silently contaminated by environment + roleModel gap — Engine reads DEFAULT_MODEL, not the .env's documented MODEL=qwen3.6-35b-fast, and inherits ambient env: the judge's exported DEFAULT_MODEL=moonshotai/Kimi-K2.6 became the model for every unassigned role.
- [P1] --server flag silently dropped through the documented pnpm invocation — `pnpm --filter @mafia/cli dev -- benchmark --server <url>` forwards a literal `--` so commander stops parsing and the flag is ignored — the CLI queried the default :3004 (the live fleet stack) instead.
- [P1] Live game state untruthful: phase frozen at SETUP for the entire game — currentState.phase reported SETUP for each game's whole life while real votes/lynchings happened, flipping only to GAME_OVER at the end — so watch-game and the dashboard's live view are frozen/mislead.
- [P2] Data/config polish: duplicated listings, dead WS_PORT, 500-vs-400, WS flake — GET /api/v1/games returns every legacy game twice (6 rows, 3 unique ids, duplicated createdAt) and CLI list-games mirrors it; WS_PORT=3001 in .env.sample is dead config (WS actually lives at /ws on the HTTP port).
