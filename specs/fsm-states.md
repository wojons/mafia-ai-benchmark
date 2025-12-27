# Finite State Machine - State Transitions

## Overview
The game engine uses a deterministic Finite State Machine (FSM) with 7 states. Each state has strict entry/exit conditions and triggers the next state transition automatically.

## State Diagram

```
SETUP
  │
  │ (roles assigned, night begins)
  ▼
NIGHT_ACTIONS ──────────────────────┐
  │                                 │
  │ (all actions submitted)         │
  ▼                                 │
MORNING_REVEAL                      │
  │                                 │
  │ (announce night results)        │
  ▼                                 │
DAY_DISCUSSION                      │
  │                                 │
  │ (N turns complete)              │ (immediate if win condition)
  ▼                                 │
DAY_VOTING                          │
  │                                 │
  │ (all votes cast + resolved)     │
  ▼                                 │
RESOLUTION ─────────────────────────┘
  │
  │ (elimination applied, check win)
  │
  ├───► END (if winner)
  │
  └───► NIGHT_ACTIONS (next night)
```

## State Details

### 1. SETUP
**Purpose:** Initialize game, assign roles, validate configuration

**Entry Conditions:**
- Game creation endpoint called
- Configuration validated

**State Data:**
```typescript
interface SetupState {
  players: Array<{
    id: string;
    name: string;
    role: 'mafia' | 'doctor' | 'sheriff' | 'villager';
    alive: boolean;
  }>;
  startingPlayerOrder: string[];  // Fixed order for discussion
  randomSeed: number;
}
```

**Transitions:**
- **TO:** NIGHT_ACTIONS
- **Trigger:** Roles assigned and broadcast
- **Event:** `PHASE_CHANGED { from: 'SETUP', to: 'NIGHT_ACTIONS', dayNumber: 0 }`

**Validation:**
- All 10 players assigned unique roles
- Mafia count = 3, Doctor = 1, Sheriff = 1, Villagers = 5
- No duplicate player IDs

**Duration:** Instant (no delay, internal state only)

---

### 2. NIGHT_ACTIONS
**Purpose:** Collect night actions from agents with night roles

**Duration:** Fixed timeout (default: 5 seconds per agent) or until all actions submitted

**Active Roles:**
- Mafia (3 players): Coordinate on kill target
- Doctor (1 player): Choose protection target
- Sheriff (1 player): Choose investigation target
- Villagers (5 players): No action (idle)

**State Data:**
```typescript
interface NightActionsState {
  nightNumber: number;        // 1-indexed
  phaseDeadline: number;      // Unix timestamp (ms)
  submittedActions: {
    mafiaKill?: {
      playerId: string;
      targetId: string;
      targetName: string;
      submittedAt: number;
    };
    doctorProtect?: {
      playerId: string;
      targetId: string;
      targetName: string;
      submittedAt: number;
    };
    sheriffInvestigate?: {
      playerId: string;
      targetId: string;
      targetName: string;
      submittedAt: number;
    };
  };
  pendingPlayers: Set<string>;  // Players who haven't acted yet
}
```

**Action Collection Rules:**

1. **Mafia Coordination:**
   - If first mafia submits: Stores provisional target
   - If different mafia submits same round: Uses majority agreement
   - If disagreement: Seeded RNG picks among submitted targets
   - Mafia team sees teammates' actions privately
   - Event: `NIGHT_ACTION_SUBMITTED { agentId, actionType: 'KILL', ... }`

2. **Doctor Protection:**
   - Can protect self: YES
   - Can protect same target two nights in a row: NO
   - Validation: Check against `lastProtected` in doctor's private state
   - If invalid choice: Agent must resubmit (or auto-pick second choice)
   - Event: `NIGHT_ACTION_SUBMITTED { agentId, actionType: 'PROTECT', ... }`

3. **Sheriff Investigation:**
   - Cannot investigate self
   - Cannot investigate dead players
   - Result known immediately (private to sheriff)
   - Event: `NIGHT_ACTION_SUBMITTED { agentId, actionType: 'INVESTIGATE', ... }`

**Transition Conditions:**
1. **Timeout:** `Date.now() > phaseDeadline`
2. **All Actions Submitted:** All required night roles have submitted

**Timeout Behavior:**
- If mafia hasn't submitted: Random living non-mafia target
- If doctor hasn't submitted: Random living player (respect no-repeat rule)
- If sheriff hasn't submitted: Random living non-sheriff target

**Transitions:**
- **TO:** MORNING_REVEAL
- **Trigger:** Timeout OR all actions submitted
- **Event:** `PHASE_CHANGED { from: 'NIGHT_ACTIONS', to: 'MORNING_REVEAL', dayNumber }`

**Events Emitted:**
- `NIGHT_ACTION_SUBMITTED` (one per acting agent)
- `PHASE_CHANGED` (on transition)

---

### 3. MORNING_REVEAL
**Purpose:** Announce results of night actions to all players

**Duration:** Fixed delay (default: 3 seconds) for dramatic effect

**Resolution Logic:**
```typescript
function resolveNight(actions: NightActions): NightResult {
  const mafiaTarget = actions.mafiaKill?.targetId;
  const doctorTarget = actions.doctorProtect?.targetId;
  const sheriffInvestigation = actions.sheriffInvestigate?.targetId;
  
  // Determine if kill was prevented
  const protected = (mafiaTarget === doctorTarget);
  const killed = protected ? null : mafiaTarget;
  
  // Sheriff gets private result
  const targetRole = getRole(sheriffInvestigation!);
  const isMafia = (targetRole === 'mafia');
  
  return {
    killed,
    protected: protected ? doctorTarget : null,
    prevented: protected,
    investigation: {
      targetId: sheriffInvestigation,
      isMafia
    }
  };
}
```

**State Data:**
```typescript
interface MorningRevealState {
  nightNumber: number;
  result: NightResult;
}
```

**Public Announcement:**
- If killed: "[Name] was killed during the night"
- If protected: "No one died (the Doctor saved someone!)"
- Investigation results: NOT announced (sheriff knows privately)

**Private Events:**
- Sheriff receives: `INVESTIGATION_RESULT { sheriffId, targetId, isMafia }`

**Transitions:**
- **TO:** DAY_DISCUSSION
- **Trigger:** After reveal delay
- **Event:** `PHASE_CHANGED { from: 'MORNING_REVEAL', to: 'DAY_DISCUSSION', dayNumber }`

**Events Emitted:**
- `NIGHT_RESOLVED { killed, protected, prevented, investigation }`
- If player died: `PLAYER_ELIMINATED { playerId, cause: 'night' }`
- `PHASE_CHANGED`

---

### 4. DAY_DISCUSSION
**Purpose:** Alive agents discuss, accuse, defend, strategize

**Duration:** Fixed number of turns (default: 10) OR until all agents speak once

**Turn Order:**
- First day: Order = initial role assignment order
- Subsequent days: Rotate by 2 positions (encourages new dynamics)
- Dead players: Skipped
- Agent can "pass" (say nothing)

**State Data:**
```typescript
interface DayDiscussionState {
  dayNumber: number;
  turnOrder: string[];        // Player IDs in order
  currentTurnIndex: number;    // 0-indexed position
  turnsRemaining: number;      // Decrements each turn
  statements: Array<{
    playerId: string;
    playerName: string;
    turnId: string;
    publicStatement: string;  // Full SAY after streaming complete
  }>;
}
```

**Turn Flow Per Agent:**
1. **Agent.think()** called: Generates private reasoning
   - Event: `AGENT_THINK_CHUNK` (streamed)
   - Only sent to admin/observers
2. **Agent.say()** called: Generates public statement
   - Event: `AGENT_SAY_CHUNK` (streamed)
   - Sent to all clients
3. **Statement Complete:** Final statement recorded
   - Event: (implicit from end of SAY stream)
4. **Turn Complete:** CurrentTurnIndex increments

**Statement Content Guidelines:**
- **Mafia:** Deflect suspicion, accuse others, coordinate misinformation
- **Sheriff:** Decide whether to reveal, share investigations indirectly
- **Doctor:** Hint at saves without revealing identity, protect self subtly
- **Villagers:** Share suspicions based on behavior, push for info

**Special Actions:**
- **Role Claims:** Agent can claim any role publicly (may be true or false)
- Event: `ROLE_CLAIMED { playerId, claimedRole, actualRole }` (private field)

**Transition Conditions:**
1. **All Turns Used:** `turnsRemaining <= 0`
2. **All Alive Agents Spoke:** `currentTurnIndex >= alivePlayerCount`
3. **Majority Request Vote:** Not implemented in v1

**Transitions:**
- **TO:** DAY_VOTING
- **Trigger:** Out of turns OR all spoke
- **Event:** `PHASE_CHANGED { from: 'DAY_DISCUSSION', to: 'DAY_VOTING', dayNumber }`

**Events Emitted:**
- `AGENT_THINK_CHUNK` (private, per agent)
- `AGENT_SAY_CHUNK` (public, per agent)
- `PHASE_CHANGED`

---

### 5. DAY_VOTING
**Purpose:** All alive agents vote to eliminate one player

**Duration:** Fixed timeout (default: 10 seconds) OR until all votes cast

**Voting Rules:**
- Each alive agent gets exactly one vote
- Cannot vote for self
- Cannot vote for dead players
- Can change vote before deadline
- Majority/plurality wins (see tie-breaking below)

**State Data:**
```typescript
interface DayVotingState {
  dayNumber: number;
  votingDeadline: number;      // Unix timestamp (ms)
  votes: Map<string, {         // voterId -> vote
    targetId: string;
    targetName: string;
    voteTime: number;          // When vote was cast
    changed: boolean;          // True if changed before deadline
  }>;
  voteDistribution: Map<string, number>;  // targetId -> count
  votesNeededForMajority: number;         // floor(alivePlayers / 2) + 1
}
```

**Vote Collection:**
1. **Agent.vote()** called for each alive agent
   - Agent.think() runs first (private reasoning)
   - Agent chooses target based on suspicion/heuristics
   - Event: `VOTE_CAST { voterId, targetId, voteTime }`
2. **Vote Recording:** Server tracks all votes
   - If agent votes again: Updates existing vote, marks `changed: true`
   - Agents can see current vote tally (public info)

**Tie-Breaking Rule (Chosen for v1):**
- **Plurality Wins:** Player with most votes is eliminated
- **Tie:** Seeded RNG picks among tied players
- **No Elimination:** If all players get exactly 1 vote each → No elimination

**Resolution Logic:**
```typescript
function resolveVote(votes: Vote[]): VoteResult {
  const distribution = countVotes(votes);
  const maxVotes = Math.max(...distribution.values());
  const leaders = [...distribution.entries()]
    .filter(([_, count]) => count === maxVotes)
    .map(([playerId, _]) => playerId);
  
  let eliminated: string | null = null;
  
  if (leaders.length === 1) {
    eliminated = leaders[0];  // Clear plurality
  } else {
    // Tie - seeded RNG picks
    eliminated = seededRNG.pick(leaders);
  }
  
  return {
    eliminated,
    votes: votes,
    distribution: Object.fromEntries(distribution),
    tie: leaders.length > 1
  };
}
```

**Transition Conditions:**
1. **Timeout:** `Date.now() > votingDeadline`
2. **All Votes Cast:** `votes.size === alivePlayerCount`

**Transitions:**
- **TO:** RESOLUTION
- **Trigger:** Timeout OR all votes
- **Event:** `PHASE_CHANGED { from: 'DAY_VOTING', to: 'RESOLUTION', dayNumber }`
- **Immediate:** `VOTE_RESULT { eliminated, votes, distribution, tie }`

**Events Emitted:**
- `VOTE_CAST` (one per voter)
- `VOTE_RESULT`
- If eliminated: `PLAYER_ELIMINATED { playerId, cause: 'vote' }`
- `PHASE_CHANGED`

---

### 6. RESOLUTION
**Purpose:** Apply elimination, check win conditions, prepare next phase

**Duration:** Instant (internal processing)

**State Data:**
```typescript
interface ResolutionState {
  dayNumber: number;
  eliminationApplied: boolean;
  winConditionChecked: boolean;
  winner: 'town' | 'mafia' | null;
}
```

**Processing Steps:**
1. **Apply Elimination:**
   - If vote eliminated a player → Mark as dead, reveal role
   - Update counts: mafiaCount, townCount

2. **Check Win Conditions:**
   ```typescript
   function checkWinCondition(state: GameState): 'town' | 'mafia' | null {
     if (state.mafiaCount === 0) return 'town';  // All mafia dead
     if (state.mafiaCount >= state.townCount) return 'mafia';  // Mafia majority
     return null;  // Game continues
   }
   ```

3. **Special Cases:**
   - If Doctor died: No protection next night
   - If Sheriff died: No more investigations

**Transition Logic:**
```typescript
function resolvePhase(eliminatedPlayer: Player | null): string {
  // Update player state if someone was eliminated
  if (eliminatedPlayer) {
    eliminatedPlayer.alive = false;
    eliminatedPlayer.eliminatedRound = currentRound;
    
    // Update counts
    if (eliminatedPlayer.role === 'mafia') {
      mafiaCount--;
    } else {
      townCount--;
    }
  }
  
  // Check win condition
  const winner = checkWinCondition();
  if (winner) {
    return 'END';
  }
  
  // Continue to next night
  dayNumber++;  // New day begins
  return 'NIGHT_ACTIONS';
}
```

**Transitions:**
- **TO:** END (if winner found)
  - **Event:** `GAME_ENDED { winner, finalState, duration }`
- **TO:** NIGHT_ACTIONS (if no winner)
  - **Event:** `PHASE_CHANGED { from: 'RESOLUTION', to: 'NIGHT_ACTIONS', dayNumber: dayNumber + 1 }`

**Events Emitted:**
- `PLAYER_ELIMINATED` (if applicable)
- Either `PHASE_CHANGED` or `GAME_ENDED`

---

### 7. END
**Purpose:** Game concluded, final state recorded

**Duration:** Terminal state (no exit)

**State Data:**
```typescript
interface EndState {
  winner: 'town' | 'mafia';
  finalDayNumber: number;
  finalRoundNumber: number;
  finalGameState: FullGameState;
  durationMs: number;
}
```

**Finalization:**
- Record winner
- Calculate total duration
- Update game status to 'FINISHED'
- Persist all state

**Cleanup:**
- Game can be exported for replay
- Players can view post-mortem
- Engine stops processing this game

**Events Emitted:**
- `GAME_ENDED { winner, winningPlayers, finalState, durationMs }`

---

## Phase Timing Configuration

Default timing for each phase:

```typescript
const DEFAULT_PHASE_TIMING = {
  NIGHT_ACTIONS: {
    timeoutMs: 30000,        // 30 seconds
    perAgentBuffer: 5000     // 5 seconds per agent
  },
  MORNING_REVEAL: {
    delayMs: 3000            // 3 seconds for reveal
  },
  DAY_DISCUSSION: {
    turns: 10,               // Number of turns
    timePerTurnMs: 15000     // 15 seconds per turn max
  },
  DAY_VOTING: {
    timeoutMs: 15000,        // 15 seconds to vote
    perAgentBuffer: 2000     // 2 seconds per agent
  },
  RESOLUTION: {
    delayMs: 0               // Instant
  }
};
```

### Speed Modes
- **NORMAL:** Use defaults above
- **FAST:** Divide all times by 2
- **DEBUG:** Short times (5s night, 3s discussion, 5s voting)
- **STEP:** No timeouts, manual advance only

---

## Visual State Representation

For CLI/web display:

```
┌─────────────────────────────────┐
│  Game: game-123                 │
│  Status: RUNNING                │
│                                 │
│  Phase: DAY DISCUSSION          │
│  Day: 2                         │
└─────────────────────────────────┘
         │
         │ (transition logic)
         ▼
┌─────────────────────────────────┐
│  Processing...                  │
│  Next: DAY VOTING               │
└─────────────────────────────────┘
```

CLI color coding:
- 🔴 NIGHT phases: Red
- 🌅 MORNING: Yellow
- 💬 DAY DISCUSSION: Blue
- 🗳️ DAY VOTING: Purple
- ⚰️ RESOLUTION: Gray
- ✅ END: Green