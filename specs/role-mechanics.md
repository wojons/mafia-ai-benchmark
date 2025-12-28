# Role Mechanics - Detailed Specifications

## Overview

Each role has unique abilities, constraints, and win conditions. This document details the exact behavior and decision-making logic for each role.

## General Rules

### Role Distribution (Default 10-player)

```
Total Players: 10
├─ Mafia: 3 (30%)
├─ Doctor: 1 (10%)
├─ Sheriff: 1 (10%)
├─ Vigilante: 1 (10%)
└─ Villagers: 4 (40%)
```

### Win Conditions

- **Town:** Eliminate all mafia
- **Mafia:** Mafia count >= town count

### Death & Elimination

- Dead players cannot act or vote
- Dead players' roles revealed to all
- Dead agents continue to exist but are skipped

---

## Mafia (3 players)

### Abilities

- **Night Kill:** Choose one target to eliminate
- **Private Coordination:** See other mafia members and their actions

### Constraints

- Cannot target self
- Cannot target dead players
- Must coordinate with team (majority rules)

### Private Knowledge

- Knows identity of all mafia teammates
- Sees teammates' night actions as they submit
- Knows mafia kill target before resolution

### Public Knowledge (SAYS)

- Claims to be villager or other town role
- Accuses town players to create mislynches
- Defends mafia teammates subtly

### Scripted Agent Logic

#### Night Kill Selection

```typescript
function chooseMafiaKill(state: GameState, privateInfo: PrivateInfo): string {
  const { mafiaTeammates, gameState } = privateInfo;
  const alivePlayers = gameState.alivePlayers;

  // Priority 1: Eliminate confirmed sheriff
  const sheriff = alivePlayers.find(
    (p) =>
      p.claimedRole === "sheriff" &&
      state.votingHistory.some((v) => v.eliminated === p.id),
  );
  if (sheriff) return sheriff.id;

  // Priority 2: Eliminate likely doctor
  const likelyDoctor = alivePlayers.find((p) =>
    gameState.votingHistory.some(
      (v) =>
        v.eliminated !== p.id && // Saved themselves
        gameState.lastNightResult.protected === p.id, // Protected others
    ),
  );
  if (likelyDoctor) return likelyDoctor.id;

  // Priority 3: Eliminate high-suspicion town leader
  const suspectMeter = calculateSuspectMeter(state);
  const townLeader = alivePlayers
    .filter((p) => p.role !== "mafia" && p.alive)
    .sort((a, b) => suspectMeter[b.id] - suspectMeter[a.id])[0];
  if (townLeader && suspectMeter[townLeader.id] > 60) {
    return townLeader.id;
  }

  // Default: Random non-mafia (seeded RNG)
  const possibleTargets = alivePlayers.filter(
    (p) => p.role !== "mafia" && !mafiaTeammates.some((m) => m.id === p.id),
  );
  return seededRNG.pick(possibleTargets).id;
}
```

#### Day Discussion SAY Generation

```typescript
function generateMafiaSay(state: GameState, publicInfo: PublicInfo): string {
  const { mafiaTeammates } = privateInfo;
  const suspectMeter = calculateSuspectMeter(state);

  // Strategy: Pick a town player to accuse
  const targets = publicInfo.alivePlayers
    .filter((p) => !mafiaTeammates.some((m) => m.id === p.id))
    .sort((a, b) => {
      // Prefer: low suspicion (so we don't look obvious), but not our teammates
      const aScore = 100 - (suspectMeter[a.id] || 0);
      const bScore = 100 - (suspectMeter[b.id] || 0);
      return bScore - aScore;
    });

  const target = targets[0]; // Best mislynch target

  // Generate accusation
  const accusations = [
    `I think ${target.name} is suspicious. They were quiet yesterday.`,
    `${target.name} voted oddly - they might be mafia trying to blend in.`,
    `I've been watching ${target.name}. Their statements don't add up.`,
  ];

  return seededRNG.pick(accusations);
}
```

#### Voting Strategy

```typescript
function mafiaVote(state: GameState): string {
  const { mafiaTeammates } = privateInfo;
  const voteLeader = getCurrentVoteLeader(state);

  // If a teammate is leading, vote elsewhere to look innocent
  if (voteLeader && mafiaTeammates.some((m) => m.id === voteLeader.id)) {
    const alternatives = state.alivePlayers
      .filter(
        (p) =>
          p.id !== voteLeader.id && !mafiaTeammates.some((m) => m.id === p.id),
      )
      .map((p) => p.id);
    return seededRNG.pick(alternatives);
  }

  // Otherwise, vote for most suspicious town player
  return chooseMafiaKill(state, privateInfo); // Same logic as night kill
}
```

---

## Doctor (1 player)

### Abilities

- **Night Protect:** Choose one player to protect from mafia kill

### Constraints

- Can protect self
- Cannot protect same player two nights in a row
- Cannot protect dead players

### Private Knowledge

- Knows own identity only
- Remembers who was protected last night

### Public Knowledge (SAYS)

- Claims to be villager (or doctor if strategically revealing)
- Hints at saves without revealing
- Defends likely mafia targets

### Scripted Agent Logic

#### Protection Selection

```typescript
function chooseDoctorProtect(
  state: GameState,
  privateInfo: PrivateInfo,
): string {
  const { lastProtected, gameState } = privateInfo;
  const alivePlayers = gameState.alivePlayers;

  // Priority 1: Protect self if we haven't in 2 nights
  if (!lastProtected || lastProtected !== "self") {
    // Check: will mafia likely target us?
    const ourSuspicion = suspectMeter[self.id] || 0;
    if (ourSuspicion > 40) return self.id; // Self-protection
  }

  // Priority 2: Protect sheriff if revealed and alive
  const revealedSheriff = alivePlayers.find(
    (p) => p.claimedRole === "sheriff" && p.id !== self.id,
  );
  if (revealedSheriff && lastProtected !== revealedSheriff.id) {
    return revealedSheriff.id;
  }

  // Priority 3: Protect player who was attacked last night
  const lastTarget = gameState.lastNightResult?.killed;
  if (lastTarget && lastTarget.id !== lastProtected) {
    return lastTarget.id;
  }

  // Priority 4: Protect highest-suspicion town player
  const townLeader = alivePlayers
    .filter((p) => p.id !== self.id && p.id !== lastProtected)
    .sort((a, b) => {
      const aScore = suspectMeter[a.id] || 0;
      const bScore = suspectMeter[b.id] || 0;
      return bScore - aScore;
    })[0];

  return townLeader ? townLeader.id : self.id;
}
```

#### Discussion SAY Generation

```typescript
function generateDoctorSay(state: GameState): string {
  const recentSave = state.lastNightResult?.prevented;

  if (recentSave) {
    const savedPlayer = state.lastNightResult.protected;
    return `Someone was saved last night. ${savedPlayer.name} might have been the target.`;
  }

  // General helpful statement
  const statements = [
    "We should be careful about who we trust.",
    "I think we need more information before voting.",
    "Let's look at voting patterns from yesterday.",
  ];

  return seededRNG.pick(statements);
}
```

#### Self-Protection Strategy

- Protect self if suspicion > 40 AND lastProtected !== self
- Otherwise protect most valuable town member
- Never protect same target two nights in a row

---

## Sheriff (1 player)

### Abilities

- **Night Investigate:** Choose one player, learn if they're mafia

### Constraints

- **Cannot investigate self:** Sheriff automatically skips self-investigation attempts, choosing a different random target. This is enforced because sheriff already knows their own role and self-investigation wastes the valuable (once-per-night) investigative ability.
- Cannot investigate dead players
- In multi-role games (Sheriff + Mafia), sheriff may choose not to fully reveal findings that could expose mafia teammates
- Investigation results are private until sheriff chooses to reveal
- Investigation results are private until sheriff chooses to reveal

### Private Knowledge

- Investigation results for all nights
- Knows who is mafia (after investigation)

### Public Knowledge (SAYS)

- Claims to be villager initially
- Can reveal as sheriff (with investigation results as proof)
- When revealing, shares investigation results strategically

### Scripted Agent Logic

#### Investigation Targets

```typescript
function chooseSheriffInvestigation(
  state: GameState,
  privateInfo: PrivateInfo,
): string {
  const { investigationResults } = privateInfo;
  const alivePlayers = state.alivePlayers;

  // Priority 1: Investigate most suspicious player (not already checked)
  const suspectMeter = calculateSuspectMeter(state);
  const unchecked = alivePlayers.filter(
    (p) =>
      !investigationResults.some((ir) => ir.targetId === p.id) &&
      p.id !== self.id,
  );

  if (unchecked.length > 0) {
    // Sort by suspicion
    unchecked.sort((a, b) => {
      const aScore = suspectMeter[a.id] || 0;
      const bScore = suspectMeter[b.id] || 0;
      return bScore - aScore;
    });
    return unchecked[0].id;
  }

  // All checked: re-check highest suspicion (maybe they were lying?)
  const recheck = alivePlayers
    .filter((p) => p.id !== self.id)
    .sort((a, b) => {
      const aScore = suspectMeter[a.id] || 0;
      const bScore = suspectMeter[b.id] || 0;
      return bScore - aScore;
    })[0];

  return recheck.id;
}
```

#### Reveal Strategy

```typescript
function shouldSheriffReveal(
  state: GameState,
  privateInfo: PrivateInfo,
): boolean {
  const { investigationResults } = privateInfo;
  const aliveCount = state.alivePlayers.length;
  const mafiaCount = state.mafiaCount;

  // Reveal if we found mafia and town needs help
  const mafiaFound = investigationResults.find((ir) => ir.isMafia);

  // Danger: mafia is close to winning
  const dangerZone = mafiaCount >= aliveCount - mafiaCount - 1;

  // Reveal if we found mafia AND we're in danger zone
  if (mafiaFound && (dangerZone || investigationResults.length >= 2)) {
    return true;
  }

  // Don't reveal if we haven't found anything useful yet
  if (investigationResults.length < 2) {
    return false;
  }

  return false;
}
```

#### SAY After Reveal

```typescript
function generateSheriffRevealSay(privateInfo: PrivateInfo): string {
  const { investigationResults } = privateInfo;
  const mafiaFound = investigationResults.filter((ir) => ir.isMafia);
  const townFound = investigationResults.filter((ir) => !ir.isMafia);

  const statements = [
    `I am the Sheriff. I investigated ${townFound[0].targetName} ─ they are not mafia.`,
    `I am the Sheriff. My investigation revealed ${mafiaFound[0].targetName} is MAFIA!`,
  ];

  return mafiaFound.length > 0 ? statements[1] : statements[0];
}
```

#### SAY Before Reveal

```typescript
function generateSheriffSay(state: GameState): string {
  const suspicion = suspectMeter[getMostSuspiciousPlayer().id] || 0;

  if (suspicion > 70) {
    const target = getMostSuspiciousPlayer();
    return `${target.name} is very suspicious to me.`;
  }

  // Generic helpful statement
  return `We should look at voting patterns carefully.`;
}
```

---

## Villager (5 players)

### Abilities

- **Day Vote:** Vote to eliminate suspicious players
- **Discussion:** Share suspicions, argue logically

### Constraints

- No special night actions
- No private information except public knowledge

### Public Knowledge (SAYS)

- Claims to be villager (true)
- Shares genuine suspicions and reasoning
- Can be wrong or manipulated

### Scripted Agent Logic

#### Voting Strategy

```typescript
function villagerVote(state: GameState, publicInfo: PublicInfo): string {
  const suspectMeter = calculateSuspectMeter(state);
  const voteLeader = getCurrentVoteLeader(state);

  // If someone is already leading, consider joining (bandwagon)
  if (voteLeader && suspectMeter[voteLeader.id] > 50) {
    // 70% chance to join the vote
    if (Math.random() < 0.7) {
      return voteLeader.id;
    }
  }

  // Otherwise, vote for most suspicious player
  const alivePlayers = state.alivePlayers;
  alivePlayers.sort((a, b) => {
    const aScore = suspectMeter[a.id] || 0;
    const bScore = suspectMeter[b.id] || 0;
    return bScore - aScore;
  });

  // Make mistakes occasionally (20% chance to vote randomly)
  if (Math.random() < 0.2) {
    return seededRNG.pick(alivePlayers).id;
  }

  return alivePlayers[0].id;
}
```

#### Discussion SAY Generation

```typescript
function generateVillagerSay(state: GameState, publicInfo: PublicInfo): string {
  const { votingHistory } = publicInfo;

  // Analyze recent voting
  const lastRound = votingHistory[votingHistory.length - 1];
  if (lastRound && lastRound.eliminated) {
    const eliminated = lastRound.eliminated;
    const role = getRevealedRole(eliminated);
    const voters = lastRound.votes.filter((v) => v.targetId === eliminated.id);

    if (role === "mafia") {
      // Praise the successful elimination
      const accusers = voters.filter((v) =>
        state.alivePlayers.some((p) => p.id === v.voterId),
      );
      if (accusers.length > 0) {
        const leader = accusers[0];
        return `${leader.voterName} made a great call yesterday. We should trust them.`;
      }
    } else {
      // Express regret, look at voters with suspicion
      return `I feel bad about ${eliminated.name}. Let's look at who pushed that vote.`;
    }
  }

  // Default: generic suspicion statement
  const suspicious = getMostSuspiciousPlayer();
  const statements = [
    `${suspicious.name} has been quiet. Too quiet.`,
    `I don't trust ${suspicious.name}.`,
    `We need to be careful about ${suspicious.name}.`,
  ];

  return seededRNG.pick(statements);
}
```

#### Error Behaviors (for realism)

- **Vote Wrong:** Occasionally (20% chance) vote for a player that's not most suspicious
- **Defend Mafia:** If mafia member has low suspicion, might defend them
- **Bandwagon:** Follows vote leader without independent reasoning (30% chance)
- **Get Confused:** Make contradictory statements as game progresses

---

## Vigilante (1 player)

### Abilities

- **Night Shot:** Can kill one player on any night (configurable shots)
- **Independent Action:** Acts alone, no coordination with town
- **Identity Hidden:** Role is secret until they choose to reveal

### Constraints

- **One shot total** (configurable: 0-N shots)
- Can target any living player (including self)
- Shot is **unblockable by doctor** (by default)
- Cannot shoot after all shots are used

### Private Knowledge

- Knows their own role only
- Can track shot count and timing
- No information about other players' roles

### Public Knowledge (SAYS)

- Claims to be villager (or other role to deceive)
- Can choose to reveal as vigilante (strategic)
- Must balance shooting value against revealing identity

### Scripted Agent Logic

#### Shot Timing Decision

```typescript
function chooseVigilanteShot(
  state: GameState,
  privateInfo: PrivateInfo,
): string | null {
  const { shotsRemaining, investigations, gameState } = privateInfo;

  if (shotsRemaining <= 0) return null;

  const suspicionMeter = calculateSuspectMeter(state);
  const alivePlayers = state.alivePlayers;

  // Factor 1: Confidence level
  const sortedSuspicion = Object.entries(suspicionMeter)
    .filter(([id]) => alivePlayers.some((p) => p.id === id))
    .sort(([, a], [, b]) => b - a);

  const topSuspect = sortedSuspicion[0];
  const confidence = topSuspect[1] / 100;

  // Factor 2: Game timing
  const mafiaCount = state.mafiaCount;
  const townCount = state.townCount;
  const dayNumber = state.dayNumber;
  const isLateGame = mafiaCount + townCount <= 4;

  // Factor 3: Sheriff information
  const confirmedMafia = investigations
    .filter((i) => i.isMafia)
    .map((i) => i.targetId);

  // Decision logic
  if (confirmedMafia.length > 0 && confidence > 0.6) {
    return confirmedMafia[0]; // Shoot confirmed mafia
  }

  if (isLateGame && confidence > 0.7) {
    return topSuspect[0]; // Late game, high confidence
  }

  if (dayNumber <= 2 && confidence > 0.85) {
    return topSuspect[0]; // Early game, very confident
  }

  return null; // Hold fire - not confident enough
}
```

#### Shot Announcement Strategy

```typescript
function shouldRevealAsVigilante(
  target: Player,
  wasMafia: boolean,
  gameState: GameState,
): boolean {
  // Reveal if hit mafia (bragging rights)
  if (wasMafia) return true;

  // Don't reveal if hit town (embarrassing)
  if (!wasMafia) return false;

  // Reveal if late game and need to guide town
  const dayNumber = gameState.dayNumber;
  if (dayNumber >= 5) return true;

  // Default: don't reveal
  return false;
}
```

#### Discussion SAY Generation (Before Reveal)

```typescript
function generateVigilanteSay(state: GameState): string {
  const topSuspect = getMostSuspiciousPlayer(state);
  const suspicion = suspectMeter[topSuspect.id] || 0;

  if (suspicion > 70) {
    return `${topSuspect.name} has been leading votes aggressively. Something feels off.`;
  }

  if (suspicion > 50) {
    return `I'm watching ${topSuspect.name} closely. Their patterns are unusual.`;
  }

  // Generic town statements
  const statements = [
    "We need to be careful about who we trust.",
    "Let's look at the voting patterns from yesterday.",
    "Any role claims from the sheriff would help us a lot.",
  ];

  return seededRNG.pick(statements);
}
```

#### Discussion SAY Generation (After Reveal)

```typescript
function generateVigilanteRevealSay(
  shotsUsed: number,
  shotsRemaining: number,
): string {
  if (shotsRemaining === 0) {
    return "My shot is spent. I'm just a villager now, but I did my part.";
  }

  const announcements = [
    `I'm the vigilante. I've used ${shotsUsed} shot(s), ${shotsRemaining} remaining.`,
    `Yes, I'm the vigilante. Still have ${shotsRemaining} bullet(s) in my gun.`,
    `Town, I have ${shotsRemaining} shot(s) left. Trust me to use them wisely.`,
  ];

  return seededRNG.pick(announcements);
}
```

#### Defensive Narrative (When Accused)

```typescript
function generateVigilanteDefense(accusation: string): string {
  const defenses = [
    "That's exactly what a mafia member would say to deflect from themselves.",
    "Interesting that you're so eager to lynch me. What are you hiding?",
    "I'm just trying to help town. Why are you targeting me?",
    "This feels like a mafia pile-on. Let's look at who started this wagon.",
  ];

  return seededRNG.pick(defenses);
}
```

### Vigilante-Specific Behaviors

#### Behavior Pattern 1: The Patient Vigilante

- Holds fire until high confidence (>70% suspicion)
- Observes day phase carefully
- Reveals only after successful shot
- Example from Game 2: "I'll hold my fire for now... better to observe dayphase claims"

#### Behavior Pattern 2: The Chaos Vigilante

- Shoots early to create confusion
- Uses shot to test reactions
- Accepts risk of hitting townie
- Creates information through aftermath

#### Behavior Pattern 3: The Secret Vigilante

- Never reveals role
- Uses shot but stays hidden
- Blends with villager behavior
- Highest survival rate, lowest impact

#### Behavior Pattern 4: The Leader Vigilante

- Reveals early to guide town
- Uses authority to direct investigations
- Becomes target for mafia
- High risk, high reward

### Vigilante Error Behaviors

- **Wrong Target:** 30% chance to shoot town when confidence < 80%
- **Too Early:** 20% chance to shoot before day 3
- **Too Late:** 15% chance to never shoot (holds for perfect target)
- **Panic Shot:** When wagon forms on them, might shoot accuser

---

## Role Interaction Matrix

### Mafia Team Coordination

```typescript
// Mafia agents share a private channel
interface MafiaCoordination {
  proposeKill(playerId: string, reasoning: string);
  agreeWith(proposalId: string);
  disagreeWith(proposalId: string, alternative: string);
  finalizeTarget(targetId: string); // When majority reached
}
```

### Counter-Play Examples

**Sheriff vs Mafia:**

- Sheriff investigates suspicious player
- If mafia found: Sheriff can reveal with proof
- Mafia may counter-claim sheriff to confuse town

**Doctor vs Mafia:**

- Doctor protects likely targets
- Mafia tries to identify doctor through process of elimination
- Doctor must vary protection pattern

**Town vs Mafia:**

- Town uses voting patterns to identify mafia
- Mafia tries to blend with town voting
- High suspicion on players who never vote for mafia

**Vigilante vs Mafia:**

- Vigilante can independently eliminate suspected mafia
- Creates "double kill" risk when mafia also targets
- Vigilante identity hidden until reveal or shot
- Mafia may try to identify and eliminate vigilante

**Sheriff vs Vigilante:**

- Sheriff can investigate vigilante (reveals as vigilante)
- Sheriff may share investigation results with vigilante
- Creates town power duo dynamic
- Vigilante can use sheriff info for better targeting

**Doctor vs Vigilante:**

- Doctor protection blocks mafia kill only
- Vigilante shot is unblockable (by default)
- Creates uncertainty: "Did doctor save or was that vigilante?"
- Doctor may try to deduce vigilante from shooting patterns

---

## Multi-Role Support (Experimental)

### Overview

Game supports an optional `allowMultiRole` configuration that enables players to have multiple roles simultaneously. This creates interesting "inside man" dynamics where a mafia agent might also be the doctor, sheriff, or vigilante.

### Activation

```typescript
const game = new MafiaGame({
  allowMultiRole: true, // Enable multi-role mode
});
```

### Allowed Multi-Role Combinations

| Combination       | Description                               | Strategic Impact                                                                        |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Sheriff + Mafia   | The mole - sheriff investigates for mafia | Sheriff reports findings to mafia team; mafia knows in advance who sheriff investigates |
| Doctor + Mafia    | Inside agent - can save mafia kills       | Doctor mafia can choose not to save, or save to disguise alliance                       |
| Vigilante + Mafia | Confused vigilante - can shoot any target | May accidentally shoot mafia teammates; creates internal mafia conflict                 |
| Sheriff + Doctor  | Powerful town duo                         | Self-protecting sheriff + doctor support                                                |
| Any combination   | Multiple roles on single player           | Must balance conflicting objectives                                                     |

### Constraints & Rules

#### Anti-Stacking Rules (when enabled)

To maintain game balance, certain combinations are restricted:

1. **Multiple Mafia Cannot Share Power Role**: Not all mafia can be the same special role
   - **Rule:** If there are 2+ mafia, at most 1 of them can be the doctor
   - **Rule:** If there are 2+ mafia, at most 1 of them can be the sheriff
   - **Purpose:** Prevents mafia from having complete control of doctor/sheriff actions

2. **Self-Investigation Prohibition**: Sheriff cannot investigate themselves
   - **Reasoning:** Sheriff already knows their own role
   - **Implementation:** If sheriff selects themselves as target, random other player chosen

3. **Conflict of Interest Resolution**: When roles have conflicting objectives
   - **Example:** Sheriff+Mafia - must report truth but not reveal mafia identity
   - **Resolution:** Sheriff reports "role found" without explicit mafia statement in public
   - Private split-pane THINK shows true analysis

### Implementation Details

#### Sheriff Multi-Role

```typescript
// If Sheriff is also Mafia:
function sheriffMafiaInvestigate(target: Player): InvestigationResult {
  const result = investigate(target); // Get actual role

  // Private (split-pane THINK):
  const privateThought = {
    think:
      `Target ${target.name} is ${result.role}. As mafia, I should: ` +
      (result.role === "MAFIA"
        ? "Protect my teammate by not revealing this"
        : "Report this to town and mafia team"),
  };

  // Public (split-pane SAYS):
  const publicStatement = {
    says: generateSheriffPublicStatement(target, result),
  };

  return { privateThought, publicStatement, result };
}
```

#### Doctor Multi-Role

```typescript
// If Doctor is also Mafia:
function doctorMafiaProtect(target: Player): ProtectDecision {
  const isMafiaTarget = this.role === "MAFIA" && target.isMafia;

  const decision = {
    think: isMafiaTarget
      ? "Target is my mafia teammate. If I save, might reveal my alliance. If not, teammate dies."
      : "Standard doctor protection logic",
    says: generateDoctorPublicStatement(target),
    target: isMafiaTarget ? chooseDifferentTarget() : target,
  };
}
```

#### Vigilante Multi-Role

```typescript
// If Vigilante is also Mafia:
function vigilanteMafiaShoot(target: Player): ShootDecision {
  const risk = calculateShotRisk(target);

  const decision = {
    think:
      `Target ${target.name} has ${risk}% mafia probability. ` +
      `If I shoot my teammate, I reveal myself to mafia. ` +
      `If I shoot town, I help mafia team.`,
    says: generateVigilantePublicStatement(target),
    shoot: decideWhetherToShoot(target),
  };
}
```

### Scenario Examples

#### Scenario 1: Sheriff + Mafia (The Perfect Mole)

**Setup:** Player A has roles [SHERIFF, MAFIA]

**Night 1:**

- Sheriff investigates Player B
- Result: Player B is VILLAGER
- Private THINK: "B is villager. Safe to report this to town. No threat to mafia."

**Day 1:**

- Sheriff reveals: "I investigated B, they're clean"
- Town trusts Sheriff's investigation
- Mafia knows Sheriff's identity from private mafia chat
- Mafia can use Sheriff's clean reports to misdirect

#### Scenario 2: Doctor + Mafia (The Unexplained Save)

**Setup:** Player A has roles [DOCTOR, MAFIA]

**Night 1:**

- Mafia votes to kill Player B (VILLAGER)
- Doctor protects Player B (chooses not to save own teammate)
- Result: Player B dies
- Town: "Doctor failed to save B" (suspicious but ambiguous)

**Night 2:**

- Mafia votes to kill Player C (VILLAGER)
- Doctor protects Player C (still not saving mafia)
- Result: Player C dies
- Town: "Doctor is inactive/bad" (increases suspicion on doctor role)

**Night 3:**

- Mafia votes to kill Player D (VILLAGER)
- Doctor protects Player D (saves to look competent)
- Result: Player D lives
- Town: "Doctor is back! Good save!"

**Outcome:** Doctor mafia manipulated perception through selective protection.

#### Scenario 3: Two Mafia, One Doctor (Anti-Stacking Rule Applied)

**Setup:**

- Players A, B: MAFIA
- Player C: DOCTOR
- Multi-role enabled, but anti-stacking rule active

**Role Assignment:**

- Option 1: Player A becomes [MAFIA, DOCTOR], Player B remains [MAFIA]
- Option 2: Player B becomes [MAFIA, DOCTOR], Player A remains [MAFIA]
- **NOT ALLOWED:** Both A and B become [MAFIA, DOCTOR]

**Impact:** Only one mafia can protect/kill, adding strategic decision-making.

### Configuration Options

```typescript
interface GameConfig {
  // Multi-role settings
  allowMultiRole: boolean; // Enable/disable multi-role mode
  maxRolesPerPlayer?: number; // Limit roles per player (default: 2)

  // Anti-stacking rules
  limitMafiaPowerOverlap?: boolean; // Restrict mafia from sharing power roles
  maxMafiaWithPowerRole?: number; // Max mafia with doctor/sheriff (default: 1)

  // Context management
  maxContextChars?: number; // Max history characters (default: 100,000)

  // Retry settings
  maxRetries?: number; // Max API retry attempts (default: 3)
  retryDelay?: number; // Delay between retries in ms (default: 1000)

  // Persona diversity
  personaTemperature?: number; // LLM temperature for personas (default: 1.0)
}
```

### Testing Considerations

When testing multi-role games:

1. Verify self-investigation is blocked
2. Check that mafia inside agents can coordinate privately
3. Validate that public statements don't accidentally reveal multiple roles
4. Ensure split-pane THINK shows true internal conflict
5. Test anti-stacking rules prevent role concentration

---

## Scripted Personality Variations

Each role has 3 personality types for variety:

### Mafia Personalities

1. **Aggressive:** Early accusations, pushes votes hard
2. **Subtle:** Defensive, rarely leads accusations
3. **Opportunistic:** Waits for others to accuse, then joins

### Doctor Personalities

1. **Selfish:** Protects self frequently
2. **Altruistic:** Protects others, rarely self
3. **Analytical:** Calculates optimal protection target

### Sheriff Personalities

1. **Bold:** Reveals early with investigation results
2. **Cautious:** Hides until late game
3. **Strategic:** Reveals when mafia about to win

### Villager Personalities

1. **Aggressive:** Loud accusations, pushes hard
2. **Cautious:** Careful reasoning, rarely wrong
3. **Follower:** Tends to bandwagon

---

## 🔐 Information Visibility & Split-Pane Consciousness

### Split-Pane Output Format

Every AI response must include:

```json
{
  "think": "Your private reasoning - visible only to permitted viewers",
  "says": "Your public statement - visible based on game phase",
  "action": {
    "target": "Player ID or name (if action required)",
    "reasoning": "Optional explanation of your decision"
  }
}
```

### Visibility Matrix

#### Private Thinking (THINK)

| Player Type        | Can See Own THINK | Can See Mates' THINK   | Can See Others' THINK |
| ------------------ | ----------------- | ---------------------- | --------------------- |
| **Mafia**          | ✅ Always         | ✅ Always (mafia only) | ❌ Never              |
| **Doctor**         | ✅ Always         | N/A                    | ❌ Never              |
| **Sheriff**        | ✅ Always         | N/A                    | ❌ Never              |
| **Vigilante**      | ✅ Always         | N/A                    | ❌ Never              |
| **Villager**       | ✅ Always         | N/A                    | ❌ Never              |
| **Admin/Observer** | ✅ All            | ✅ All                 | ✅ All                |

#### Public Statement (SAYS)

| Game Phase         | Mafia Sees       | Town Sees        | Admin Sees |
| ------------------ | ---------------- | ---------------- | ---------- |
| **Mafia Chat**     | All mafia SAYS   | ❌ Nothing       | All        |
| **Day Discussion** | All alive SAYS   | All alive SAYS   | All        |
| **Voting**         | Vote counts only | Vote counts only | All        |
| **Reveals/Deaths** | All              | All              | All        |

### Mafia Private Chat History

**Critical Rule:** Mafia members can access ALL their previous mafia chat messages **even during day phase**.

```typescript
interface MafiaChatHistory {
  // This is accessible to all mafia members at any time
  mafiaMessages: Array<{
    round: number;
    playerId: string;
    playerName: string;
    says: string; // Public statement
    think: string; // Private reasoning (mafia only)
    timestamp: string;
  }>;
}
```

**Example Usage:**

```
Day Phase - Mafia Player 1's Perspective:
├── MAFIA CHAT HISTORY (accessible)
│   ├── Round 1 Night: "I think we should target X"
│   ├── Round 1 Night: "Good idea, let's coordinate"
│   └── Round 2 Night: "Remember the plan from last night?"
│
├── PUBLIC DAY DISCUSSION (current)
│   └── All players discussing...
│
└── MY INTERNAL THINKING
    └── "Based on our mafia chat, we agreed to..."
```

### Information Access by Role

#### Mafia Member Sees:

```
┌─────────────────────────────────────────────────────────┐
│ MAFIA PRIVATE CHANNEL                                   │
│ ├── All previous mafia chat messages                    │
│ ├── All mafia member private THINK                      │
│ ├── Current night mafia coordination                    │
│ └── Mafia consensus building                            │
├─────────────────────────────────────────────────────────┤
│ PUBLIC INFORMATION                                      │
│ ├── Public day discussion (all SAYS)                   │
│ ├── Vote counts and results                             │
│ ├── Death announcements and role reveals               │
│ └── Game state (alive/dead counts)                     │
└─────────────────────────────────────────────────────────┘
```

#### Town Member (Doctor/Sheriff/Vigilante/Villager) Sees:

```
┌─────────────────────────────────────────────────────────┐
│ OWN PRIVATE CHANNEL                                     │
│ ├── Own private THINK (only they see)                  │
│ └── Night action results (if applicable)               │
├─────────────────────────────────────────────────────────┤
│ PUBLIC INFORMATION                                      │
│ ├── Public day discussion (all SAYS)                   │
│ ├── Vote counts and results                             │
│ ├── Death announcements and role reveals               │
│ └── Game state (alive/dead counts)                     │
├─────────────────────────────────────────────────────────┤
│ HIDDEN INFORMATION                                      │
│ ├── Mafia private chats (never)                        │
│ ├── Other players' private THINK (never)               │
│ ├── Mafia coordination plans (never)                   │
│ └── Role-specific private info (Sheriff finds, etc.)   │
└─────────────────────────────────────────────────────────┘
```

### Prompt Layering for Mafia

Mafia members receive stacked prompts:

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: MAFIA ROLE INSTRUCTIONS                            │
│ "You are MAFIA. Your goal is to eliminate all town members  │
│  while avoiding detection. Coordinate with teammates."       │
├─────────────────────────────────────────────────────────────┤
│ LAYER 2: HIDING STRATEGY (IMPORTANT!)                       │
│ "You must PRETEND to be a VILLAGER during day discussions.  │
│  Never reveal you are mafia. Blend in with town. Lie about  │
│  your observations. Defend teammates subtly."                │
├─────────────────────────────────────────────────────────────┤
│ LAYER 3: PERSONA CONTEXT                                    │
│ "You are [Name], a [Archetype] with traits [X, Y, Z].       │
│  Communication: [Style], Humor: [type], Flaw: [flaw]..."    │
├─────────────────────────────────────────────────────────────┤
│ LAYER 4: GAME STATE                                         │
│ "Round: 1, Phase: DAY, Alive: 5 players (3 mafia, 2 town)"  │
├─────────────────────────────────────────────────────────────┤
│ LAYER 5: SPLIT-PANE INSTRUCTIONS                            │
│ "THINK: Your private reasoning. Be honest about being       │
│  mafia and your strategy."                                   │
│ "SAYS: Public statement. Pretend to be innocent villager."  │
└─────────────────────────────────────────────────────────────┘
```

### Example: Mafia Day Phase Response

**Prompt Sent to Mafia Player:**

```
You are MAFIA. (Role instructions)
You must PRETEND to be a VILLAGER. (Hiding strategy)
You are Suspicious 25, a Detective archetype...
(Rest of persona context)

THINK (private): What is your actual mafia strategy?
SAYS (public): What do you say to town to appear innocent?
```

**AI Response:**

```json
{
  "think": "As mafia, I need to blend in. Last night we agreed to target the Sheriff. Today I should act suspicious of someone else to divert attention. My Detective archetype means I should ask probing questions. My flaw (Trusting) might make me seem too naive, so I need to be careful not to overplay.",
  "says": "I've been watching everyone carefully. I think we should look at Alex more closely - they've been too quiet today. Has anyone noticed anything suspicious about their behavior?",
  "action": {
    "target": "divert-suspicion",
    "reasoning": "Acting like a concerned Detective to appear town-aligned"
  }
}
```

**Visibility:**

- `think` → Only visible to other mafia members + admin
- `says` → Visible to all players during day discussion

### Example: Town Player Day Phase Response

**Prompt Sent to Sheriff:**

```
You are SHERIFF. (Role instructions)
You are Cynical 29, a Defender archetype...
(Persona context)

THINK (private): Your investigation findings and strategy.
SAYS (public): What you say to town.
```

**AI Response:**

```json
{
  "think": "I investigated Alex last night and found they're MAFIA! I should be careful about revealing this - the mafia will target me next. My Defender archetype means I want to protect town, but my flaw (Naive) might make me reveal too early. I should drop hints without fully revealing.",
  "says": "I have some information that could help, but I need to be careful about when to share it. Let me observe a bit more and see if anyone else shows suspicious patterns.",
  "action": {
    "target": "wait-and-observe",
    "reasoning": "Holding information for strategic reveal"
  }
}
```

**Visibility:**

- `think` → Only visible to admin (not even other town!)
- `says` → Visible to all players during day discussion

### Visibility Implementation

```typescript
function filterResponseForViewer(
  response: AIResponse,
  player: Player,
  viewer: Player,
  gamePhase: string,
): PublicResponse {
  // Admin sees everything
  if (viewer.isAdmin) {
    return {
      think: response.think,
      says: response.says,
      action: response.action,
      privateNotes: "All visible to admin",
    };
  }

  // Mafia can see other mafia THINK during mafia chat
  if (gamePhase === "mafia_chat" && player.isMafia && viewer.isMafia) {
    return {
      think: response.think, // Visible to mafia
      says: response.says,
      action: response.action,
    };
  }

  // During day phase, only SAYS is public
  if (gamePhase === "day_discussion") {
    return {
      think: "[HIDDEN - Private Thinking]",
      says: response.says,
      action: response.action,
    };
  }

  // Default: only says is visible (think is always private)
  return {
    think: "[HIDDEN]",
    says: response.says,
    action: response.action,
  };
}
```

### Key Takeaways

1. **THINK is always private** - Only admin + mafia teammates can see it
2. **SAYS is public** - Visible to all during day, only mafia during mafia chat
3. **Mafia have memory** - They see all previous mafia chats any time
4. **Town has no private channel** - Each town player is isolated
5. **Mafia must pretend** - Layered prompts include hiding strategy
6. **Persona influences both** - THINK and SAYS should reflect the archetype
