# Vigilante Role Specifications

## Overview
The Vigilante is a powerful town-aligned role with **one shot** (configurable) that can be used on any night during the game. Unlike other roles, the Vigilante must balance the value of information against the cost of wasting their only bullet on a townie.

## Role Definition

### Basic Properties
```typescript
interface VigilanteConfig {
  totalShots: number;           // Default: 1 (configurable 0-N)
  canShootSameNightAsMafia: boolean;  // Default: true
  doctorProtectionBlocksVigilante: boolean;  // Default: false
  shotTiming: 'any_night' | 'specific_night';  // Default: any_night
}
```

### Comparison with Other Roles
| Role | Ability | Constraint | Risk |
|------|---------|------------|------|
| Mafia | Kill | Must coordinate with team | Risk of doctor save |
| Sheriff | Investigate | One per night | No risk, pure info |
| Doctor | Protect | No repeat protection | No personal risk |
| Vigilante | Kill | One shot total | Risk of killing townie |

## Night Action Resolution Order

### Default Order (configurable)
1. Sheriff investigates (pure info, no risk)
2. Mafia submits kill target
3. Doctor submits protect target
4. Vigilante submits shot (if using shot)
5. **Resolution:**
   - Apply mafia kill
   - Check doctor protection (blocks mafia kill only)
   - Apply vigilante shot (unblockable by doctor by default)
   - Sheriff gets investigation result

### Double Kill Scenario
When both mafia and vigilante act on the same night:
```
Night X Results:
- Mafia killed: [Player A]
- Vigilante shot: [Player B]
- Doctor protected: [Player A] (blocks only mafia kill)

Outcome:
- Player A: Alive (saved by doctor)
- Player B: Dead (vigilante shot)
```

**Agent Communication (internal):**
- Town agents don't know vigilante shot Player B
- May suspect mafia kill was blocked if only one death
- Creates uncertainty: "Was that a save or a vigilante shot?"

## Strategic Considerations

### When Should Vigilante Shoot?

#### Early Game (Night 1-2)
**Pros:**
- No prior information, pure guess
- If mafia kills someone who looks suspicious, might hit mafia
- Creates chaos that town can exploit

**Cons:**
- 90%+ chance of hitting townie (3/10 players are mafia)
- Wastes only bullet before gaining any information
- Gives mafia an extra kill (doctor can only block one)

**Game 2 Example:**
```
Vigilante reasoning (night 1):
"It's night one with no prior information or discussions.
Making any shot a random guess with high risk of hitting town
and wasting my only bullet. Better to observe dayphase claims
and behaviors first. I'll hold my fire for now."
```

#### Mid Game (Night 3-5)
**Pros:**
- Sheriff investigations provide clues
- Voting patterns reveal suspicious players
- Can target a strong town leader (if believing they're mafia)

**Cons:**
- Mafia may have already killed key roles
- Time pressure: more nights = more chances to use shot

#### Late Game (Night 6+)
**Pros:**
- High confidence target
- Sheriff likely has confirmed clears
- If only 1-2 mafia left, better odds

**Cons:**
- Game may end before shot is useful
- If town wins by vote, shot was wasted

### Vigilante Shot Strategy Patterns

#### Pattern 1: The Patience Shot
Wait until high confidence, then strike.
```
Think: "I'll hold my fire to gather more information"
Say: "I'm observing day one to see claims and behaviors"
Outcome: Shoot confirmed mafia late game
```

#### Pattern 2: The Chaos Shot
Shoot early to create confusion and information.
```
Think: "Let's create chaos and see how people react"
Say: "I'm taking the shot" (announce publicly to scare mafia)
Outcome: May hit town, but forces reactions
```

#### Pattern 3: The Leader Shot
Target the most influential town player if you suspect they're mafia.
```
Think: "This person is guiding town too effectively"
Say: [No announcement - keep shot secret]
Outcome: If they flip mafia, huge value. If town, costly mistake.
```

## Event Schema

### VIGILANTE_SHOT_SUBMITTED
```typescript
interface VigilanteShotSubmittedEvent {
  eventType: 'VIGILANTE_SHOT_SUBMITTED';
  visibility: 'private';  // Hidden from public
  payload: {
    vigilanteId: string;
    vigilanteName: string;
    targetId: string;
    targetName: string;
    shotNumber: number;  // Which shot (for multi-shot config)
    remainingShots: number;
  };
}
```

### VIGILANTE_SHOT_RESOLVED
```typescript
interface VigilanteShotResolvedEvent {
  eventType: 'VIGILANTE_SHOT_RESOLVED';
  visibility: 'public';
  payload: {
    vigilanteId: string;      // Reveal vigilante identity!
    vigilanteName: string;
    targetId: string;
    targetName: string;
    wasMafia: boolean;        // Did vigilante hit mafia?
    shotNumber: number;
    remainingShots: number;
    publicMessage: string;    // For UI display
  };
}
```

**Key Design Decision:** When vigilante shoots, their identity becomes public (if they choose to shoot). This is a tradeoff: using the shot reveals you're the vigilante.

### Alternative: Secret Vigilante
Optionally, vigilante identity can remain hidden:
```typescript
interface VigilanteShotResolvedEvent {
  // ...
  revealIdentity: boolean;  // If true, show vigilante name
}
```

## Scripted Vigilante Behavior

### Decision Tree
```typescript
function chooseVigilanteShot(
  gameState: GameState,
  privateInfo: PrivateInfo
): string | null {
  const { shotsRemaining, investigations, votingHistory } = privateInfo;
  
  if (shotsRemaining <= 0) return null;  // Already used
  
  const suspicionMeter = calculateSuspectMeter(gameState);
  const topSuspects = Object.entries(suspicionMeter)
    .sort(([, a], [, b]) => b - a)
    .filter(([id]) => isAlive(id))
    .slice(0, 3);
  
  // Decision: Shoot or Wait?
  
  // Factor 1: Confidence level
  const maxSuspicion = topSuspects[0][1];
  const confidence = maxSuspicion / 100;
  
  // Factor 2: Game state
  const mafiaCount = gameState.mafiaCount;
  const townCount = gameState.townCount;
  const isLateGame = (mafiaCount + townCount <= 4);
  
  // Factor 3: Sheriff information
  const confirmedMafia = investigations.filter(i => i.isMafia).map(i => i.targetId);
  const confirmedTown = investigations.filter(i => !i.isMafia).map(i => i.targetId);
  
  // Decision logic
  if (confirmedMafia.length > 0 && confidence > 0.6) {
    return confirmedMafia[0];  // Shoot confirmed mafia
  }
  
  if (isLateGame && confidence > 0.7) {
    return topSuspects[0][0];  // Late game, high confidence
  }
  
  if (!isLateGame && mafiaCount >= 2 && confidence > 0.8) {
    return topSuspects[0][0];  // Multiple mafia left, very confident
  }
  
  return null;  // Hold fire
}
```

### Vigilante SAY Generation (Announcing Shot)
```typescript
function generateVigilanteShotAnnouncement(
  target: Player,
  wasMafia: boolean
): string {
  if (wasMafia) {
    const announcements = [
      `I took the shot on ${target.name}. Justice is served.`,
      `${target.name} won't be causing any more trouble.`,
      `Sometimes you just have to take matters into your own hands.`
    ];
    return randomPick(announcements);
  } else {
    const apologies = [
      `I apologize, ${target.name}. I thought you were mafia.`,
      `That was a mistake. I was wrong about ${target.name}.`,
      `I pulled the trigger on the wrong person. My bad.`
    ];
    return randomPick(apologies);
  }
}
```

### Vigilante THINK Generation (Private)
```typescript
function generateVigilanteThink(
  context: GameState,
  privateInfo: PrivateInfo
): string {
  const { shotsRemaining, investigations, votingHistory } = privateInfo;
  
  if (shotsRemaining === 0) {
    return "My shot is spent. I'm just a villager now.";
  }
  
  const topSuspect = getMostSuspiciousPlayer(context);
  const sheriffResults = investigations.map(i => 
    `${i.target.name}: ${i.isMafia ? 'mafia' : 'town'}`
  ).join(', ');
  
  const thoughts = [
    `I've been watching ${topSuspect.name}. Their voting patterns are off.`,
    `Sheriff found: ${sheriffResults || 'nothing useful yet'}.`,
    `If I shoot now, I might hit a townie. But if I wait...`,
    `${topSuspect.name} has been too quiet. That's suspicious.`,
    `I need to time this perfectly. One shot, one chance.`
  ];
  
  return randomPick(thoughts);
}
```

## Agent Interactions

### When Vigilante Shoots (Public Knowledge)
After night resolution, public sees:
```
Night 3 Results:
- [Player A] was killed by the MAFIA
- [Player B] was shot by the VIGILANTE
```

Town deduction:
- "So vigilante exists and just used their shot"
- "Vigilante is still anonymous (unless they announced)"
- "If Player B was mafia, vigilante made a good shot"
- "If Player B was town, vigilante wasted their shot"

### Vigilante Identity Reveal
Two design options:

**Option A: Automatic Reveal**
When vigilante shoots, their role is public:
```
[Player X] reveals themselves as the VIGILANTE!
"I shot [Player B]. They were mafia."
```
- Pros: Clear information, prevents fake claims
- Cons: Vigilante becomes target next night

**Option B: Secret Vigilante (Default)**
Vigilante identity remains hidden:
```
[Player B] was shot. No faction claimed.
```
- Pros: Vigilante survives longer, can shoot again
- Cons: Creates uncertainty ("Was that vigilante or mafia?")

**Recommendation:** Secret vigilante by default, with option to reveal.

## Suspect Meter Impact

### Vigilante-Specific Factors

#### Increases Suspicion
- Playing aggressively (accusations, leadership)
- Voting consistently with confirmed clears
- Pushing for lynches that benefit mafia
- "Protecting" certain players from lynches

#### Decreases Suspicion
- Being cleared by sheriff
- Helping eliminate confirmed mafia
- Taking calculated risks that pay off

### Vigilante Detection Heuristics
```typescript
function calculateVigilanteSuspicion(
  player: Player,
  gameState: GameState,
  history: Event[]
): number {
  let suspicion = 50;  // Base
  
  // Factor 1: Shot usage timing
  const shotEvent = history.find(e => 
    e.eventType === 'VIGILANTE_SHOT_RESOLVED' && 
    e.payload.vigilanteId === player.id
  );
  
  if (shotEvent) {
    const wasMafia = shotEvent.payload.wasMafia;
    suspicion += wasMafia ? -30 : +25;  // Good shot = less suspicious
    
    // Factor 2: Shot timing
    const dayOfShot = shotEvent.payload.shotNumber;
    if (dayOfShot <= 2) suspicion += 15;  // Early shot = risky
    if (dayOfShot >= 5) suspicion -= 10;  // Late shot = patient
  }
  
  // Factor 3: Leadership behavior
  const accusationCount = countAccusations(player.id, history);
  if (accusationCount > 5) suspicion += 10;  // Vocal player
  
  // Factor 4: Vote alignment with clears
  const voteAlignment = calculateClearVoteAlignment(player.id, history);
  suspicion -= voteAlignment * 0.5;  // Helps town = less suspicious
  
  return clamp(suspicion, 0, 100);
}
```

## Edge Cases

### 1. Vigilante and Mafia Target Same Player
```
Night Action: Mafia targets Player A
Night Action: Vigilante targets Player A
Resolution:
- Player A dies once (single death)
- Vigilante wasted shot on same target
- Doctor could still save if they protected Player A
```

### 2. Vigilante Shoots Mafia Who Would Be Saved
```
Night Action: Mafia targets Player A
Night Action: Doctor protects Player A
Night Action: Vigilante targets Player A
Resolution:
- Mafia kill blocked by doctor
- Vigilante shot succeeds: Player A dies
- Doctor's protection was "wasted" on mafia kill
```

### 3. Vigilante Shoots Vigilante (Multi-Shot Config)
If vigilante has multiple shots and shoots themselves:
```
Outcome: Vigilante kills themselves
Result: Town loses vigilante role
```

### 4. No Mafia Kills (Mafia Skips)
If mafia chooses not to kill:
```
Night Action: Mafia submits no target (or "skip")
Night Action: Vigilante shoots Player B
Resolution:
- Only Player B dies (vigilante shot)
- Town knows: vigilante shot, but not if mafia also acted
```

## Testing Requirements

### Unit Tests
```typescript
test('vigilante cannot shoot after using all shots', () => {
  const vigilante = new VigilanteAgent('p1', 'Vigi');
  vigilante.useShot();  // Shot 1
  expect(() => vigilante.useShot()).toThrow('No shots remaining');
});

test('double kill resolves correctly', () => {
  const result = resolveNight({
    mafiaTarget: 'p1',
    doctorProtect: 'p1',
    vigilanteTarget: 'p2'
  });
  
  expect(result.mafiaKilled).toBe(null);  // Blocked by doctor
  expect(result.vigilanteKilled).toBe('p2');  // Shot succeeds
});

test('vigilante shot reveals identity', () => {
  const event = createVigilanteShotResolved(
    'p1', 'Vigilante', 'p2', 'Mafia', true
  );
  expect(event.visibility).toBe('public');
  expect(event.payload.vigilanteId).toBe('p1');
});
```

### Integration Tests
```typescript
test('full game with vigilante playing optimally', async () => {
  const config = { players: 10, mafia: 3, vigilante: 1 };
  const seed = 12345;
  
  const game = await simulator.runFullGame(config, seed);
  
  // Vigilante should have shot exactly once
  const shotEvents = game.events.filter(
    e => e.eventType === 'VIGILANTE_SHOT_SUBMITTED'
  );
  expect(shotEvents.length).toBe(1);
});
```

## Configuration Options

### Default Config
```json
{
  "vigilante": {
    "enabled": true,
    "shots": 1,
    "canShootAnyNight": true,
    "revealIdentityOnShoot": false,
    "doctorProtectionBlocksShot": false
  }
}
```

### Variant Configurations
```json
// Classic: Vigilante has 1 shot, secret identity
{ "shots": 1, "revealIdentityOnShoot": false }

// Bold: Vigilante reveals themselves when shooting
{ "shots": 1, "revealIdentityOnShoot": true }

// Powerful: Vigilante has 2 shots
{ "shots": 2, "revealIdentityOnShoot": false }

// No vigilante
{ "enabled": false }
```

## UI Display

### Vigilante Card (when revealed)
```
┌──────────────────────────────────┐
│  [V] Vigilante ⚔️               │
│  Shots Remaining: 0/1           │
│                                 │
│  Last Shot: Night 3             │
│  Target: ChatGPT 5.2 (Mafia) ✓  │
└──────────────────────────────────┘
```

### Night Results (when vigilante shoots)
```
🌙 Night 3 Results:
   ☠️ Mafia killed: Kimmy K2
   🔫 Vigilante shot: ChatGPT 5.2
   
   The vigilante remains anonymous...
```

### Vigilante Indicator (Agent Card)
- Small pistol icon next to name
- "1/1" or "0/1" showing shots remaining
- Hidden until vigilante reveals or shoots

## Future Extensions

### Multi-Shot Vigilante
- Can shoot multiple times (configurable)
- Each shot reveals identity (optional per shot)
- Creates sustained threat throughout game

### Day Vigilante (Day Action)
- Can only shoot during day phase
- Must declare before voting
- Creates tension between vote and shoot

### Vigilante with Limit
- Can only shoot N nights (e.g., nights 2-4)
- Creates timing puzzle for vigilante

### Vigilante vs Sheriff Team-up
- Sheriff can share investigation results with vigilante
- Vigilante gets better targeting information
- Creates town power duo dynamic