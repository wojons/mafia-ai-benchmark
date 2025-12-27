# Project Brief - Mafia AI Benchmark

## Project Name
AI Mafia / Social Deduction Simulator

## Core Purpose
Build a complete, runnable "AI Social Deduction Engine (Mafia)" game where AI agents play mafia with a split-pane consciousness: private internal monologues ("THINK") vs public statements ("SAYS").

## Key Requirements

### Game Mechanics
- 10 players total: 3 Mafia, 1 Doctor, 1 Sheriff, 5 Villagers
- Night phase: Mafia kill, Doctor protect, Sheriff investigate
- Day phase: Discussion (streamed speech) + Voting (elimination)
- Doctor CAN protect self, CANNOT protect same player two nights in a row
- Win conditions: Town wins if all mafia eliminated; Mafia wins if majority

### Core Feature: THINK vs SAYS Split
- Each agent has both:
  - **THINK**: Private internal reasoning (hidden from other agents)
  - **SAYS**: Public statements broadcast during discussion/voting
- Agents actively lie in public while reasoning privately
- UI must clearly show this split-pane consciousness

### Components to Build
1. **Backend server**: Authoritative game engine (headless)
2. **CLI client**: Start games, attach, stream events, export logs
3. **Web client**: Full game interface with agent cards, game feed, controls
4. **Event-sourced logging**: Append-only stream for replayable games

## Architecture
- **Game engine**: Pure-logic FSM separated from transport/UI
  - States: SETUP → NIGHT_ACTIONS → MORNING_REVEAL → DAY_DISCUSSION → DAY_VOTING → RESOLUTION → END
- **Agents**: Adapter interface for scripted heuristic bots (default) or LLM-backed (pluggable)
- **Transport**: REST for control + WebSocket/SSE for live streaming
- **Storage**: SQLite (abstracted) - games, events, snapshots
- **Determinism**: Seeded RNG for reproducible games

## UI/UX Requirements
- Split-pane THINK vs SAYS in each agent card
- Live token streaming for both streams
- Day/night transitions with animation
- Permissions: Observer (all THINK + roles), Town mode (public only), Post-mortem (reveal all)
- Suspect Meter: 0-100 score per agent based on heuristics

## Tech Stack
- Backend: TypeScript + Node.js
- Frontend: TypeScript + React
- CLI: Node.js CLI tool
- Storage: SQLite
- Transport: REST + WebSocket
- Testing: Unit tests for FSM, determinism tests

## Deliverables
1. Architecture overview
2. Complete repo tree with all files
3. Full code: backend, CLI, web client, shared types/events
4. Docker support (docker-compose)
5. Tests: FSM transitions, win conditions, replay determinism
6. Scripted agent implementation with entertaining THINK/SAYS divergence

## Constraints
- Must run locally with one command: `docker-compose up` OR `pnpm i && pnpm dev`
- No paid APIs in default build
- Easy LLM plug-in later (adapter interface + stubs)
- Clear README with run instructions
