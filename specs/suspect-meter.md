# Suspect Meter Algorithm

## Overview
The Suspect Meter provides a visible heuristic score (0-100) for each player, helping observers track who seems suspicious based on game events.

## Design Philosophy
- **Observable:** Changes must be clearly traceable to events
- **Configurable:** Weights can be tuned via JSON config
- **Interpretable:** Easy to understand why someone is suspicious
- **Non-cheating:** Doesn't use private information (unless in admin mode)

## Score Range
- **0-25:** Very trustworthy / cleared
- **26-50:** Neutral / unknown
- **51-75:** Somewhat suspicious
- **76-100:** Very suspicious / likely mafia

## Algorithm Architecture

### Core Formula
```typescript
interface SuspectScore {
  [playerId: string]: number;  // 0-100
}

function calculateSuspectMeter(
  gameState: GameState,
  history: Event[],
  weights: WeightsConfig
): SuspectScore {
  const scores: SuspectScore = {};
  
  // Start with base suspicion (all players = 50)
  for (const player of gameState.players) {
    scores[player.id] = 50;
  }
  
  // Apply each scoring rule
  for (const rule of scoringRules) {
    const adjustments = rule.calculate(gameState, history, weights);
    for (const [playerId, delta] of Object.entries(adjustments)) {
      scores[playerId] = clamp(scores[playerId] + delta, 0, 100);
    }
  }
  
  return scores;
}
```

### Weight Configuration
```typescript
interface WeightsConfig {
  // Voting patterns
  lateVoteWeight: number;           // +X for late votes
  voteSwitchWeight: number;         // +X for changing votes
  bandwagonWeight: number;          // +X for pure bandwagon
  selfPreservationWeight: number;   // -X for voting with majority
  
  // Behavioral
  aggressionWeight: number;         // +X for accusations
  defensivenessWeight: number;      // +X for defensiveness
  consistencyWeight: number;        // -X for consistent statements
  
  // Information-based
  sheriffRevealBonus: number;       // -X for sheriff-confirmed town
  investigationHitBonus: number;    // +X for sheriff-confirmed mafia
  protectionPatternWeight: number;  // -X for doctor-like protection
  
  // Meta
  deathWeight: number;              // +X if player was killed (likely town)
  survivalWeight: number;           // +X for surviving long (could be mafia)
  earlyMafiaVoteWeight: number;     // +X for voting out mafia early
}

const DEFAULT_WEIGHTS: WeightsConfig = {
  // Voting (30% of total score)
  lateVoteWeight: 10,
  voteSwitchWeight: 15,
  bandwagonWeight: 8,
  selfPreservationWeight: -12,
  
  // Behavior (25% of total score)
  aggressionWeight: 5,
  defensivenessWeight: 8,
  consistencyWeight: -10,
  
  // Information (35% of total score)
  sheriffRevealBonus: -25,      // Big drop if sheriff confirms town
  investigationHitBonus: +30,   // Big jump if sheriff confirms mafia
  protectionPatternWeight: -8,
  
  // Meta (10% of total score)
  deathWeight: -20,             // Killed = likely town
  survivalWeight: 3,            // Each night survived
  earlyMafiaVoteWeight: -15     // Helped eliminate mafia
};
```

## Scoring Rules

### Rule 1: Late Voting
**Trigger:** Player votes in last 20% of voting period

**Logic:**
```typescript
function lateVoteRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const votingPhase = getVotingPhases(history);
  
  for (const phase of votingPhase) {
    const votingDuration = phase.endTime - phase.startTime;
    const lateThreshold = phase.startTime + (votingDuration * 0.8);  // Last 20%
    
    for (const vote of phase.votes) {
      if (vote.timestamp > lateThreshold) {
        adjustments[vote.voterId] = (adjustments[vote.voterId] || 0) + 
                                     weights.lateVoteWeight;
      }
    }
  }
  
  return adjustments;
}
```

**Why it works:** Mafia often wait to see where town is voting before deciding

---

### Rule 2: Vote Switching
**Trigger:** Player changes their vote during voting phase

**Logic:**
```typescript
function voteSwitchRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const voterChanges = countVoteChanges(history);
  
  for (const [voterId, changeCount] of Object.entries(voterChanges)) {
    adjustments[voterId] = changeCount * weights.voteSwitchWeight;
  }
  
  return adjustments;
}
```

**Scoring:**
- 1 switch: +15 points
- 2 switches: +30 points
- 3+ switches: +40 points (capped)

**Why it works:** Indecisiveness can indicate mafia trying to manipulate vote

---

### Rule 3: Bandwagon Voting
**Trigger:** Player votes for current leader without prior suspicion

**Logic:**
```typescript
function bandwagonRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const votingPhases = getVotingPhases(history);
  
  for (const phase of votingPhases) {
    const voteLeader = getVoteLeader(phase);
    if (!voteLeader) continue;
    
    for (const vote of phase.votes) {
      // Check if voter previously expressed suspicion of leader
      const priorSuspicion = getPriorSuspicion(vote.voterId, voteLeader.id, history);
      
      if (!priorSuspicion && vote.targetId === voteLeader.id) {
        adjustments[vote.voterId] = (adjustments[vote.voterId] || 0) + 
                                     weights.bandwagonWeight;
      }
    }
  }
  
  return adjustments;
}
```

**Why it works:** Pure bandwagoning without reasoning suggests following rather than leading

---

### Rule 4: Self-Preservation Voting
**Trigger:** Player votes with majority to avoid suspicion

**Logic:**
```typescript
function selfPreservationRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const votingPhases = getVotingPhases(history);
  
  for (const phase of votingPhases) {
    const majorityTarget = getMajorityTarget(phase);
    if (!majorityTarget) continue;
    
    for (const vote of phase.votes) {
      const isMajorityVote = (vote.targetId === majorityTarget.id);
      const votePosition = getVoteOrderPosition(vote);
      const totalVotes = phase.votes.length;
      
      // If voted late with majority, might be self-preservation
      if (isMajorityVote && votePosition > totalVotes * 0.5) {
        adjustments[vote.voterId] = (adjustments[vote.voterId] || 0) + 
                                     weights.selfPreservationWeight;
      }
    }
  }
  
  return adjustments;
}
```

**Why it works:** Mafia often vote with majority to blend in, especially late

---

### Rule 5: Aggression/Arousal
**Trigger:** Player frequently accuses others

**Logic:**
```typescript
function aggressionRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const accusationCount = countAccusations(history);
  
  for (const [playerId, count] of Object.entries(accusationCount)) {
    // Normalize: +5 per accusation above average
    const avgAccusations = getAverageAccusations(history);
    const excess = Math.max(0, count - avgAccusations);
    
    adjustments[playerId] = excess * weights.aggressionWeight;
  }
  
  return adjustments;
}
```

**Why it works:** Excessive accusations can indicate mafia trying to control narrative

---

### Rule 6: Consistency Score
**Trigger:** Player statements align with actions over time

**Logic:**
```typescript
function consistencyRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  
  for (const player of gameState.players) {
    if (!player.alive) continue;
    
    const consistency = calculateStatementActionConsistency(player.id, history);
    
    // Bonus for consistency: -10 points per consistent pattern
    adjustments[player.id] = consistency * weights.consistencyWeight;
  }
  
  return adjustments;
}
```

**Examples of Consistency:**
- Suspected player → voted for them later ✓
- Claimed strategy → followed it ✓
- Defended player → protected them (if doctor) ✓

**Why it works:** Consistent players are more likely to be genuine town

---

### Rule 7: Sheriff Confirmation
**Trigger:** Sheriff reveals investigation results

**Logic:**
```typescript
function sheriffConfirmationRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const sheriffResults = getSheriffResults(history);
  
  for (const result of sheriffResults) {
    if (result.isMafia) {
      // Confirmed mafia gets big boost
      adjustments[result.targetId] = weights.investigationHitBonus;
    } else {
      // Confirmed town gets big drop
      adjustments[result.targetId] = weights.sheriffRevealBonus;
    }
  }
  
  return adjustments;
}
```

**Why it works:** Sheriff investigations are definitive (if sheriff is believed)

---

### Rule 8: Doctor Protection Patterns
**Trigger:** Player shows doctor-like behavior

**Logic:**
```typescript
function doctorPatternRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  const nightResults = getNightResults(history);
  
  for (const player of gameState.players) {
    let doctorScore = 0;
    
    for (const night of nightResults) {
      if (night.protected === player.id) {
        // Player was protected
        doctorScore += 2;
      }
      if (night.killed !== player.id && night.protected !== player.id) {
        // Player survived when others died
        doctorScore += 0.5;
      }
    }
    
    adjustments[player.id] = doctorScore * weights.protectionPatternWeight;
  }
  
  return adjustments;
}
```

**Why it works:** Doctor survives while protecting others; pattern emerges

---

### Rule 9: Death/Survival Meta
**Trigger:** Player died or survived nights

**Logic:**
```typescript
function survivalRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  
  for (const player of gameState.players) {
    if (!player.alive) {
      // Died = likely town (mafia typically targets town)
      adjustments[player.id] = weights.deathWeight;
    } else {
      // Each night survived adds small suspicion
      const nightsSurvived = getNightsSurvived(player.id, history);
      adjustments[player.id] = nightsSurvived * weights.survivalWeight;
    }
  }
  
  return adjustments;
}
```

**Why it works:** Mafia rarely kills their own; long survival can indicate mafia

---

### Rule 10: Early Mafia Votes
**Trigger:** Player participated in voting out mafia

**Logic:**
```typescript
function earlyMafiaVoteRule(gameState, history, weights): Adjustments {
  const adjustments = {};
  
  for (const player of gameState.players) {
    let mafiaVotes = 0;
    
    for (const vote of getPlayerVotes(player.id, history)) {
      const targetRole = getTrueRole(vote.targetId);
      if (targetRole === 'mafia') {
        mafiaVotes++;
      }
    }
    
    // Significant drop per mafia eliminated by their vote
    adjustments[player.id] = mafiaVotes * weights.earlyMafiaVoteWeight;
  }
  
  return adjustments;
}
```

**Why it works:** Players who help eliminate mafia are likely town

---

## Composite Scoring Example

### Scenario: Day 2, after Night 1

**Game State:**
- Alice (Villager) - alive, investigated by sheriff (town)
- Bob (Mafia) - alive, late vote Day 1, switched vote
- Charlie (Doctor) - alive, protected Alice Night 1
- Diana (Sheriff) - alive, revealed
- Eve (Villager) - alive
- Frank (Villager) - dead Night 1

**Events Log:**
1. Day 1: Bob voted late (10s voting period, voted at 9s)
2. Day 1: Bob changed vote from Eve to Frank
3. Day 1: Frank was eliminated (town)
4. Night 1: Charlie protected Alice
5. Night 1: Mafia killed Frank (protected, no death)
6. Day 2: Diana revealed sheriff, said Alice is town

**Calculations:**

**Alice:**
- Base: 50
- Sheriff confirmed town: -25
- **Total: 25** (Very trustworthy)

**Bob:**
- Base: 50
- Late vote: +10
- Vote switch: +15
- No contradictions: 0
- Survived 1 night: +3
- Voted town (Frank): 0 (didn't know he was town)
- **Total: 78** (Very suspicious)

**Charlie:**
- Base: 50
- Protection pattern: -8
- Survived 1 night: +3
- No voting issues: 0
- **Total: 45** (Neutral)

**Diana:**
- Base: 50
- Revealed sheriff: -25 (implied trust)
- **Total: 25** (Very trustworthy)

**Eve:**
- Base: 50
- No special events: 0
- Survived 1 night: +3
- **Total: 53** (Slightly suspicious)

---

## UI Display

### Agent Card
```
┌─────────────────────────┐
│  Bob                    │
│  [Mafia] ⚰️ Alive       │
│                         │
│  Suspect Meter:         │
│  [████░░░░░░░░░░░░] 78% │
│                         │
│  ⚠️ Late voter          │
│  ⚠️ Changed vote        │
│  ⚠️ Survived 1 night    │
└─────────────────────────┘
```

### Hover Tooltip
```
Suspicion: 78%

Contributing Factors:
✓ Late vote Day 1 (+10)
✓ Changed vote Day 1 (+15)
✓ Survived 1 night (+3)
✗ Inconsistent behavior (+0)
```

---

## Configuration Examples

### Aggressive Detection (catches everything)
```json
{
  "lateVoteWeight": 15,
  "voteSwitchWeight": 20,
  "bandwagonWeight": 12,
  "selfPreservationWeight": -8,
  "aggressionWeight": 8,
  "inconsistencyWeight": 15,
  "sheriffRevealBonus": -20,
  "investigationHitBonus": 40
}
```

### Balanced (default)
```json
{
  "lateVoteWeight": 10,
  "voteSwitchWeight": 15,
  "bandwagonWeight": 8,
  "selfPreservationWeight": -12,
  "aggressionWeight": 5,
  "inconsistencyWeight": 10,
  "sheriffRevealBonus": -25,
  "investigationHitBonus": 30
}
```

### Lenient (only obvious mafia)
```json
{
  "lateVoteWeight": 5,
  "voteSwitchWeight": 8,
  "bandwagonWeight": 4,
  "selfPreservationWeight": -15,
  "aggressionWeight": 3,
  "inconsistencyWeight": 5,
  "sheriffRevealBonus": -30,
  "investigationHitBonus": 25
}
```

---

## Performance

**Time Complexity:** O(n*m) where:
- n = number of players
- m = number of events

**Optimization:**
- Cache intermediate results
- Incremental updates (don't recalculate entire history)
- Run calculation every 3-5 events, not every event

**Typical Calculation Time:** <10ms for 500 events