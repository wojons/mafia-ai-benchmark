# Active Context - Mafia AI Benchmark

## Current Focus
Project initialization and setup phase. The master prompt (PROMPT.md) has been created with complete specifications for the AI Mafia game.

## Recent Changes
- Created PROMPT.md with comprehensive master prompt for generating the entire project
- Initialized memory-bank documentation structure
- Git repo set up at git@github.com:wojons/mafia-ai-benchmark.git
- Initial commit completed (contains memory-bank and opencode.jsonc)
- Created `/specs` directory with 13 comprehensive specification documents
- Analyzed second game transcript (Game 2) with AI agents playing mafia
- Added Vigilante role specification based on Game 2 learnings

## Second Game Insights (Game 2)
The second game revealed critical design considerations:

### Vigilante Role (NEW)
- Has **one shot total** for entire game (configurable: 0-N shots)
- Can shoot on **any night**, not just a specific night
- Creates **double kill potential** when combined with mafia kill
- Doctor protection applies to mafia kill only (configurable)
- Strategic tension: When to use the shot? Early for info? Late for confirmed target?

### Key Behaviors Observed
1. **Vote History Tracking**: Agents dispute and correct vote records publicly
   - "You said X abstained but they voted" - factual callouts
   
2. **Last-Minute Role Reveals**: Sheriff claims at deadline to swing votes
   - "I'm the sheriff and I've investigated both, they're clear"
   - Timing is strategic: late reveals carry more weight but also more suspicion

3. **Mafia Busing**: Last mafia votes with town to survive
   - "ChatGPT 5.2 is likely lynched anyway, voting for them builds credibility"
   - Textbook behavior: pile on confirmed mafia after abstaining earlier

4. **Gullible Town Dynamics**: Confirmed clears from sheriff create trust anchors
   - "You're our confirmed town now" - players defer to cleared individuals
   - Last mafia exploits this by aligning with confirmed town

5. **Cross-Game References**: Agents remember previous games
   - "Remember the lessons from previous games"
   - "Being mislynched day one last game over a wording slip"
   
6. **Defensive Storytelling**: Accused players construct narratives
   - "That's classic self-preservation" 
   - "Your leap to you knew she'd flip is just storytelling"
   - Fabricated vote history (observed in game: "Llama and Deepseek abstained" - false)

7. **Desperation Plays**: Cornered agents make unusual moves
   - Last-second sheriff claims when wagon forms
   - Vigilante shots taken under pressure
   - Accusations against confirmed clears

8. **Role Claim Slip-ups**: Players accidentally reveal roles
   - "I protected myself" - classic doctor slip day one
   - Creates mislynch opportunities

### Design Implications
- **Event schema must track**: vote history, role claims, factual disputes
- **Suspect meter should weight**: vote record accuracy, role claim timing, consistency
- **Agent scripts need**: vote memory, factual checking, defensive narratives
- **UI must show**: vote history, claim timeline, consistency indicators

## Next Steps

### Immediate Priority
Use the PROMPT.md to generate the complete project structure:
1. Backend server with FSM game engine
2. CLI client with all commands
3. Web client with React + TypeScript
4. Shared types/events
5. Docker support
6. Tests
7. Scripted agent implementation

### Implementation Order
1. **Vigilante spec** - Add vigilante role mechanics (based on Game 2)
2. **Shared types/events** - Foundation for all components
3. **Game engine (FSM)** - Pure logic, transport-independent
4. **Backend server** - REST + WebSocket transport
5. **CLI client** - Basic game creation and streaming
6. **Web client** - Full UI with agent cards, game feed, controls
7. **Scripted agents** - Entertaining THINK/SAYS divergence
8. **Tests** - FSM transitions, determinism
9. **Docker setup** - One-command local dev

## Active Decisions

### Architecture Decisions
- **Event sourcing**: Append-only event stream for replayability
- **FSM game engine**: Pure logic separated from transport/UI
- **Agent adapter pattern**: Pluggable policies (scripted → LLM)
- **Seeded RNG**: Deterministic game reproduction

### Tech Stack Confirmed
- Backend: TypeScript + Node.js
- Frontend: TypeScript + React
- Storage: SQLite (abstracted interface)
- Transport: REST (control) + WebSocket (streaming)

### Role Configuration (Updated from Game 2)
- 10 players total
- Default: **3 Mafia**, **1 Doctor**, **1 Sheriff**, **1 Vigilante**, **4 Villagers**
- Vigilante has 1 shot (configurable 0-N shots)

### UI/UX Decisions
- Split-pane THINK vs SAYS as core visual element
- Live token streaming for both streams
- Three view modes: Admin (all), Town (public only), Post-mortem (reveal all)
- Suspect Meter: Configurable 0-100 score based on heuristics

## Known Issues
None - project is in initialization phase

## Blocking Issues
None

## Context Notes
- The PROMPT.md is comprehensive and ready to use
- Two complete game transcripts analyzed (Game 1 and Game 2)
- This is a greenfield project with no existing code
- Priority is getting a working end-to-end game loop
- Scripted agents must demonstrate entertaining THINK/SAYS divergence
- The "insane" part is agents lying publicly while reasoning privately
- Vigilante role adds strategic complexity with one-shot tension
- Agent behaviors from Game 2 inform scripted agent patterns:
  - Vote history tracking and factual disputes
  - Last-minute role reveals at deadlines
  - Mafia busing (voting confirmed mafia to survive)
  - Defensive storytelling when accused
  - Cross-game memory references

## Session State
Session started with project initialization. Memory bank files created. PROMPT.md finalized. Ready to proceed with implementation.
