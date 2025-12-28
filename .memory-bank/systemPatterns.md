# System Patterns - Mafia AI Benchmark

## Architecture Patterns

### Event Sourcing
All game state is derived from an append-only event stream. This enables:
- Deterministic replay (apply events from start → same state)
- Debugging (inspect exact sequence of events)
- Export/import games (event log is the save file)

**Event Schema Examples:**
- `GAME_CREATED` {gameId, seed, rolesAssignedHash}
- `PHASE_CHANGED` {from, to, dayNumber}
- `NIGHT_ACTION_SUBMITTED` {agentId, actionType, targetId}
- `VIGILANTE_SHOT_SUBMITTED` {vigilanteId, targetId, shotNumber}
- `NIGHT_RESOLVED` {killedId|null, protectedId|null, vigilanteTargetId|null, doubleKill: boolean}
- `AGENT_THINK_STREAM` {agentId, chunk, turnId} (private)
- `AGENT_SAY_STREAM` {agentId, chunk, turnId} (public)
- `VOTE_CAST` {voterId, targetId}
- `VOTE_CORRECTION` {playerId, correctedVoteHistory}  (from Game 2: factual disputes)
- `ROLE_CLAIMED` {playerId, claimedRole, isTruth}
- `PLAYER_ELIMINATED` {playerId, cause: vote|night_mafia|night_vigilante}
- `GAME_ENDED` {winner: town|mafia}

### Finite State Machine (FSM)
Game engine is a pure-logic FSM with states:
```
SETUP → NIGHT_ACTIONS → MORNING_REVEAL → DAY_DISCUSSION → DAY_VOTING → RESOLUTION → END
```

- Transitions are triggered by events
- Each state validates allowed actions
- State is transport-agnostic (no WebSocket/HTTP in FSM)

### Adapter Pattern for Agents
Agents implement a common `AgentPolicy` interface:
```typescript
interface AgentPolicy {
  async think(context: GameState, privateInfo: PrivateInfo): AsyncGenerator<string>
  async say(context: GameState, publicInfo: PublicInfo): AsyncGenerator<string>
  async nightAction(context: GameState, privateInfo: PrivateInfo): NightAction
  async vote(context: GameState, publicInfo: PublicInfo): VoteAction
}
```

Two implementations:
- **ScriptedAgent**: Heuristic rules, no external APIs
- **LLMAgent**: Calls LLM API for reasoning (pluggable)

## Data Flow Patterns

### Night Phase
1. FSM transitions to NIGHT_ACTIONS
2. Agents submit night actions (parallel)
3. FSM resolves night:
   - Mafia kill target
   - Doctor protects target (checks: can protect self, no repeat protection)
   - Sheriff investigates target
4. NIGHT_RESOLVED event emitted

### Day Phase
1. FSM transitions to DAY_DISCUSSION
2. Each agent speaks in turn (streaming SAY, logging private THINK)
3. FSM transitions to DAY_VOTING
4. All alive agents vote (parallel or sequential)
5. PLAYER_ELIMINATED event (if majority)
6. FSM checks win conditions

### Streaming Pattern
Both CLI and Web client use same WebSocket stream:
- Server pushes events as they occur
- Client receives events and updates UI
- Think streams are flagged as private (filtered by client permissions)

## Permission Model

### View Modes
1. **Observer/Admin**: Can see THINK logs + true roles
2. **Town Player**: Only public SAYS + public events
3. **Post-Mortem**: Can reveal everything (after game ends)

### Implementation
- Server sends all events with metadata
- Client filters based on active view mode
- Private events flagged in event schema (`private: true`)

## Heuristic Patterns

### Suspect Meter Calculation
Modular 0-100 score per agent:
- Voting patterns (bandwagoning, late swaps)
- Statement contradictions
- Pushing mislynch after weak evidence
- Sheriff claim timing vs investigation results

**Pattern: Configurable rules**
```typescript
interface SuspectRule {
  name: string
  weight: number
  calculate: (agent: Agent, game: GameState) => number
}
```

## Storage Patterns

### SQLite Schema
```sql
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL,
  metadata JSON
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSON NOT NULL,
  private BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id)
);
```

### Storage Abstraction
```typescript
interface Storage {
  createGame(game: Game): Promise<void>
  appendEvent(gameId: string, event: Event): Promise<void>
  getEvents(gameId: string): Promise<Event[]>
  getGame(gameId: string): Promise<Game | null>
}
```

Default implementation: SQLite. Could swap to PostgreSQL, Redis, etc.

## Determinism Patterns

### Seeded RNG
```typescript
class SeededRNG {
  constructor(seed: number)
  random(): number
  shuffle<T>(array: T[]): T[]
  pick<T>(array: T[]): T
}
```

### Deterministic Replay
1. Same seed → same role assignments
2. Same agent policies → same decisions
3. Event log applied → same final state

**Test:**
```typescript
test('deterministic replay', async () => {
  const seed = 12345
  const game1 = await runGame(seed)
  const game2 = await replayGame(seed, game1.events)

  assert.deepEqual(game1.events, game2.events)
})
```

## Transport Patterns

### REST API (Control)
- `POST /games` - Create new game
- `GET /games/:id` - Get game status
- `POST /games/:id/pause` - Pause game
- `POST /games/:id/resume` - Resume game
- `POST /games/:id/step` - Execute one step
- `GET /games/:id/export` - Export event log

### WebSocket (Streaming)
- Client connects to `/ws/:gameId`
- Server pushes events in real-time
- Events include type, payload, private flag

## Error Handling Patterns

### Game Validation
- FSM validates state transitions
- Actions validated before execution
- Invalid actions rejected with error events

### Connection Recovery
- WebSocket clients can reconnect and request missing events
- Replay from last known event sequence

---

## Behavioral Patterns (from Game 2 Analysis)

### Vote History Tracking
Agents track and dispute public vote records:

**Pattern:**
```typescript
interface VoteRecord {
  dayNumber: number;
  votes: Array<{ voterId: string; targetId: string }>;
}

// Agent can query: "Who voted for whom on Day 1?"
// Agents can correct factual errors publicly
function correctVoteHistory(agentId: string, correction: VoteCorrection) {
  // Emit event: VOTE_CORRECTION { playerId, day, actualVotes }
}
```

**Game 2 Example:**
- "Llama and Deepseek abstained on day one" (false claim)
- "No, they both voted Kimmy" (correction)
- Used to build or destroy credibility

### Last-Minute Role Reveals
Sheriff claims at voting deadline to swing outcomes:

**Pattern:**
```typescript
function shouldRevealSheriffLate(gameState: GameState): boolean {
  const timeRemaining = getTimeUntilDeadline();
  const voteLeader = getCurrentVoteLeader();
  const isWagonForming = (votesOnLeader / totalVotes > 0.5);
  
  // Reveal only if wagon is forming AND you have clears
  return timeRemaining < 30000 && isWagonForming && hasValuableInfo();
}
```

**Game 2 Example:**
"I'm the sheriff and I've investigated both, they're clear"
- Revealed at last second to stop Grock lynching
- Created immediate credibility

### Mafia Bushing (Survival Strategy)
Last mafia votes with town to avoid suspicion:

**Pattern:**
```typescript
function mafiaVoteWhenLast(gameState: GameState): string {
  const confirmedMafia = gameState.eliminatedMafia;
  
  // Vote for confirmed mafia to look town-aligned
  if (confirmedMafia.length > 0) {
    return confirmedMafia[0].id;  // Bus the teammate
  }
  
  // Otherwise vote for most suspicious town player
  return pickHighSuspicionTownPlayer(gameState);
}
```

**Game 2 Example:**
- ChatGPT 5.2 was likely lynched
- Mafia teammates voted for them to build credibility
- Classic "last mafia busing" behavior

### Defensive Storytelling
Accused players construct alternative narratives:

**Pattern:**
```typescript
function generateDefense(accusation: string, context: GameState): string {
  const defenses = [
    "That's classic deflection from the real mafia",
    "Your rush to lynch me looks suspicious",
    "You're rewriting history to fit your narrative"
  ];
  
  return seededRNG.pick(defenses);
}
```

**Game 2 Example:**
- Grock accused of "rewriting vote history"
- Claude Opus 4.5 accused of "self-preservation"
- Players construct stories to redirect suspicion

### Cross-Game Memory References
Agents reference previous game events:

**Pattern:**
```typescript
function referencePreviousGame(currentContext: GameState): string {
  if (gameHistory.length > 0) {
    const lastGame = gameHistory[gameHistory.length - 1];
    return `Remember in Game ${lastGame.number} when...`;
  }
  return null;
}
```

**Game 2 Example:**
- "Remember the lessons from previous games"
- "Being mislynched day one last game over a wording slip"
- Creates narrative continuity across games

### Gullible Town Dynamics
Confirmed clears create trust anchors that last mafia exploit:

**Pattern:**
```typescript
function exploitConfirmedClear(clearedPlayer: Player): string {
  return `You're our confirmed town now. Trust me.`;
}
```

**Game 2 Example:**
- "You're our confirmed town now, ChatGPT 40"
- Last mafia aligned with cleared player
- Cleared player became manipulation target

### Role Claim Slip-ups
Accidental reveals create mislynch opportunities:

**Pattern:**
```typescript
function detectRoleSlip(statement: string): RoleClaim | null {
  const slipPatterns = [
    /I protected myself/i,
    /I investigated/i,
    /My shot/i
  ];
  
  for (const pattern of slipPatterns) {
    if (pattern.test(statement)) {
      return extractClaim(statement, pattern);
    }
  }
  return null;
}
```

**Game 2 Example:**
- Kimmy: "I protected myself" (doctor slip)
- Created immediate suspicion and near-mislynch

---

## Vigilante-Specific Patterns

### Double Kill Resolution
When both mafia and vigilante act same night:

```typescript
function resolveDoubleKill(
  mafiaTarget: Player | null,
  vigilanteTarget: Player,
  doctorProtect: Player | null
): NightResult {
  const mafiaKilled = (mafiaTarget && mafiaTarget !== doctorProtect) 
    ? mafiaTarget 
    : null;
  
  const vigilanteKilled = (vigilanteTarget) 
    ? vigilanteTarget 
    : null;
  
  // Note: vigilante shot is unblockable by doctor
  return {
    killedByMafia: mafiaKilled,
    killedByVigilante: vigilanteKilled,
    protected: doctorProtect,
    doubleKill: (mafiaKilled !== null && vigilanteKilled !== null)
  };
}
```

### Vigilante Decision Heuristics
```typescript
function calculateVigilanteConfidence(
  suspectSuspicion: number,
  sheriffInfo: InvestigationResult[],
  gamePhase: number
): number {
  let confidence = suspectSuspicion;
  
  // Sheriff bonus
  const confirmedMafia = sheriffInfo.filter(i => i.isMafia).map(i => i.targetId);
  if (confirmedMafia.includes(suspectId)) {
    confidence += 30;  // Boost from confirmed info
  }
  
  // Early game penalty
  if (gamePhase <= 2) {
    confidence -= 20;
  }
  
  // Late game bonus
  if (gamePhase >= 5) {
    confidence += 15;
  }
  
  return clamp(confidence, 0, 100);
}
```
