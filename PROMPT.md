Below is a **single "master prompt"** you can paste into a strong coding model to generate the whole project (backend + CLI + web UI) for the **AI Mafia / social deduction simulator** with **THINK vs SAYS** split-pane consciousness. This has been refined with lessons from multiple game transcripts including the Vigilante role and advanced agent behaviors.

```text
You are a Lead Engineer + Product Designer. Build a complete, runnable "AI Social Deduction Engine (Mafia)" game where each agent has BOTH:
1) an internal monologue ("THINK") that is hidden from other agents, and
2) a public statement ("SAYS") that is broadcast during discussion/voting.
The UI must show this split-pane consciousness clearly.

REFERENCE BEHAVIOR / GAME FEEL (from game transcripts):
- 10 players total. Roles: 3 Mafia, 1 Doctor, 1 Sheriff, 1 Vigilante, 4 Villagers.
- NIGHT: Mafia chooses 1 target to kill. Doctor chooses 1 player to protect; Doctor CAN protect self; Doctor CANNOT protect the same player two nights in a row. Sheriff investigates 1 player per night -> result {mafia|not mafia}. Vigilante has ONE SHOT (configurable) that can be used on any night to kill a player.
- DOUBLE KILL: If both mafia and vigilante act the same night, both kills resolve (doctor only blocks mafia kill).
- MORNING: reveal who died and how (mafia kill, vigilante shot, or both). No other private info revealed unless an agent chooses to claim.
- DAY DISCUSSION: agents speak in turn (streamed), can reference prior events and vote history. Then VOTING: all alive vote to eliminate 1 player; plurality wins, ties broken by seeded RNG.
- VIGILANTE MECHANICS: Has one shot total. Can shoot any night. Shot is unblockable by doctor. Identity is secret until they reveal or shoot. Creates strategic tension: when to use the only shot?
- WIN: Town wins if all mafia eliminated. Mafia wins if mafia count >= town count (majority).
- The "insane" part is that agents actively lie in public while reasoning privately (THINK vs SAYS), and logs show both.

ADVANCED AGENT BEHAVIORS (from game transcripts):
1) Vote History Tracking: Agents track and correct public vote records ("You said X abstained but they voted")
2) Last-Minute Role Reveals: Sheriff claims at voting deadline to swing outcomes
3) Mafia Busing: Last mafia votes confirmed mafia teammates to look town-aligned
4) Defensive Storytelling: Accused players construct alternative narratives to redirect suspicion
5) Cross-Game Memory: Agents reference previous game events ("Remember Game 1 when...")
6) Role Claim Slip-ups: "I protected myself" - accidental reveals create mislynch opportunities
7) Gullible Town Dynamics: Confirmed clears from sheriff create trust anchors that last mafia exploit

You MUST produce:
A) Backend server (authoritative game engine) that can run games headless.
B) CLI client that can:
   - start a new game with configurable roles (include --vigilante flag)
   - attach to a running game
   - stream live events/logs
   - request status snapshots
   - export full replay logs
C) Web client that provides the full game interface:
   - grid/list of agent cards
   - each card shows THINK + SAYS (with permissions; see below)
   - day/night transitions with vigilante indicator
   - a scrolling "Game Feed" event log with vote corrections
   - ability to pause/resume/step for debugging
   - "Suspect Meter" per agent that updates based on events and heuristics
   - vigilante shot counter on agent cards
D) Event-sourced logging: everything is an append-only stream so games are replayable deterministically.

IMPORTANT UI/UX REQUIREMENTS:
- Split-pane "THINK" vs "SAYS" in each agent card (core mechanic).
- Live token streaming for both THINK and SAYS.
- High-frequency updates should not freeze UI; use a state approach designed for streaming (e.g., transient store + throttled renders).
- Show day/night transitions (animation acceptable).
- Vigilante indicator on agent cards (show shots remaining: "1/1" or "0/1").
- Accessibility: do not rely on color alone to indicate mafia/town; use patterns/icons/text.
- Vote history display in game feed (who voted for whom each day).

PERMISSIONS / MODES:
- "Observer mode (Admin)" can see all THINK logs and true roles (for making videos / debugging).
- "Town player mode" can only see public SAYS and public events. (Still keep THINK stored server-side, but hidden.)
- "Post-mortem / replay mode" can reveal everything.

ARCHITECTURE REQUIREMENTS:
1) Game engine as a pure-logic finite state machine (FSM) separated from transport/UI.
   States: SETUP -> NIGHT_ACTIONS -> MORNING_REVEAL -> DAY_DISCUSSION -> DAY_VOTING -> RESOLUTION -> END
2) Agents are adapters:
   - Provide an interface for "AgentPolicy" that can be:
     a) scripted heuristic bot (default, no external APIs)
     b) LLM-backed bot (pluggable later)
   - Each agent turn produces:
     - think_stream (private)
     - say_stream (public)
     - optional structured actions (vote, night target, vigilante shot, claim role, etc.)
3) Transport:
   - Server exposes:
     - REST endpoints for control (create game, pause, resume, step, export logs)
     - WebSocket (or SSE) for live event streaming to CLI and web client
4) Storage:
   - Use SQLite by default (simple), but abstract it.
   - Store:
     - games table (metadata, seed)
     - events table (append-only JSON)
     - snapshots (optional) for fast resume
5) Determinism:
   - Seeded RNG for role assignment and any random tie-breaks.
   - Replay: applying events from start must reproduce the same state.

CLI REQUIREMENTS:
- Provide a CLI executable (e.g., `mafiactl`) with commands:
  - `mafiactl new --players 10 --mafia 3 --vigilante 1 --seed 123 --mode scripted`
  - `mafiactl attach <gameId> --follow`
  - `mafiactl status <gameId>`
  - `mafiactl pause <gameId>` / `resume` / `step`
  - `mafiactl export <gameId> --format jsonl`
- CLI should display:
  - phase (Night/Day)
  - alive/dead list with role indicators (V for Vigilante)
  - latest public feed with vote corrections
  - optionally admin view toggles if authorized

WEB CLIENT REQUIREMENTS:
- Tech preference: TypeScript + React.
- Use a clean component structure:
  - AgentGrid / AgentCard (THINK vs SAYS, Vigilante shot counter)
  - GameFeed panel (events + vote history)
  - PhaseHeader (Day/Night, round number, double-kill warning)
  - Controls (pause/resume/step, speed, reveal roles toggle for admin)
  - VigilanteIndicator component
- Must support:
  - live mode (websocket stream)
  - replay mode (load exported log, scrub timeline)
- "Suspect Meter":
  - A numeric 0-100 suspicion score per agent updated by rules like:
    - voting patterns (bandwagoning, late vote swaps, vote history accuracy)
    - contradictions between prior statements
    - pushing mislynch after weak evidence
    - sheriff claims timing vs checks
    - vigilante shot timing and accuracy
  - Keep it modular and configurable.

LOGGING / EVENTS:
Define a strict event schema. Examples:
- GAME_CREATED {gameId, seed, rolesAssignedHash}
- PHASE_CHANGED {from, to, dayNumber}
- NIGHT_ACTION_SUBMITTED {agentId, actionType, targetId} (private)
- VIGILANTE_SHOT_SUBMITTED {vigilanteId, targetId, shotNumber, remainingShots} (private)
- NIGHT_RESOLVED {killedByMafiaId|null, protectedId|null, killedByVigilanteId|null, doubleKill: boolean}
- INVESTIGATION_RESULT {sheriffId, targetId, isMafia} (private until revealed by sheriff)
- AGENT_THINK_CHUNK {agentId, chunk, turnId} (private)
- AGENT_SAY_CHUNK {agentId, chunk, turnId} (public)
- VOTE_CAST {voterId, targetId}
- VOTE_CORRECTION {playerId, dayNumber, correctedVoteHistory} (public, from factual disputes)
- PLAYER_ELIMINATED {playerId, cause: vote|night_mafia|night_vigilante}
- ROLE_CLAIMED {playerId, claimedRole, isTruth} (public)
- GAME_ENDED {winner: town|mafia, finalVoteHistory}

DELIVERABLES (your output to me):
1) A short architecture overview (why this structure, how FSM + event sourcing works).
2) A repo tree with all files.
3) Full code for:
   - backend server (with vigilante mechanics)
   - CLI
   - web client (with vigilante indicators and vote history)
   - shared types/events (with vigilante events)
4) Docker support:
   - docker-compose to run server + web
5) Tests:
   - unit tests for FSM transitions and win conditions
   - unit tests for vigilante shot mechanics and double-kill resolution
   - a replay determinism test (run a seed twice, compare event streams)
6) A "scripted agent" implementation that creates entertaining THINK/SAYS divergence:
   - mafia agents: coordinate privately, fabricate accusations publicly, bus teammates when caught
   - town agents: suspicion, reasoning, occasional mistakes, vote history tracking
   - sheriff/doctor: act with constraints and strategic last-minute reveals
   - vigilante agents: patience vs chaos, shot timing decisions, identity hiding strategy
   - defensive storytelling when accused

REFERENCE SPECIFICATIONS (use these for implementation details):
- `specs/technical-architecture-decisions.md` - Complete technical stack:
  - LLM providers: Multi-provider adapter (OpenAI, Anthropic, Google, DeepSeek, Groq, Ollama, LM Studio, Custom)
  - API: REST + WebSocket with complete specs
  - CLI: API integration with streaming
  - Language: TypeScript 5.x (Node.js 20, React 18)
  - Database: SQLite with better-sqlite3
  - Visualization: 2D/3D hybrid (Three.js + React Three Fiber)
  - TTS: Browser native + External API support
  - State: Event sourcing + reactive state (hybrid streaming)
- `specs/multi-agent-ai-architecture.md` - Role prompts and memory system
- `specs/event-schemas.md` - Complete event definitions
- `specs/*.md` - All other specifications for game mechanics, UI, etc.

IMPLEMENTATION CONSTRAINTS:
- Must run locally with one command:
  - `docker-compose up` OR `pnpm i && pnpm dev` (choose and document)
- Avoid paid APIs in the default build.
- Make it easy to plug LLMs later (adapter interface + config stubs).
- Include clear README: how to run, how to start game, how to attach CLI, how to open web UI, how to export replay.

STYLE GOAL:
The experience should feel like a "multi-agent state-orchestration dashboard" where deception is visible via THINK vs SAYS, and the log makes it bingeable. The vigilante adds a layer of tension - one shot, one chance, timing is everything.

When you output code, do it file-by-file with headers like:
`// File: server/src/index.ts`
and use fenced code blocks per file.

Now produce the complete project.
```

### Optional add-ons

**1) Make the UI match the "video vibe" more closely (without needing the raw video yet):**

```text
Add a dark "terminal / cyber-noir" theme. Agent cards should have subtle motion on active speaker, and a scan-line/glitch overlay (optional). Provide a mobile layout that switches to a focused carousel for <768px width. Show vigilante shot status prominently (e.g., "🔫 1/1" or "🔫 0/1"). Vote history should scroll horizontally or in a compact list.
```

**2) Add a "recording mode" suitable for YouTube-style highlights:**

```text
Add a "Highlights" extractor that tags moments like: first accusation, big role claim, mislynch, night-save, vigilante shot (especially if hits mafia), confirmed mafia flip, final 3, and last mafia confession. Export a highlights.json with timestamps / event indexes for the replay scrubber.
```

**3) Cross-game memory (advanced, post-v1):**

```text
Add a game_history.json that tracks aggregate stats across multiple games. Agents can reference this ("In Game 5, the vigilante shot on night 1 and it was town"). This creates narrative continuity across sessions.
```

If you upload the raw video later, I can help you refine **UI layout, timing, pacing, and exact on-screen elements** (phase banners, turn order behavior, how fast the streams scroll, vigilante shot timing, etc.) using those visuals.
