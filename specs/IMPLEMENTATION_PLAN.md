# Implementation Plan to Fix Critical Issues

## Changes Required

### 1. Make Seed Optional for Persona Generation

**Files affected:** `game-engine.js`
**Function:** `generatePersonaFromSeed(line 72-187)`

**Clarified Requirement:**

- Seeds CAN exist for database/API creation
- When seed provided: Use as guidance/inspiration
- When NO seed: LLM chooses any character freely
- Default game should have NO seeds (LLM freedom)

**Changes:**

- Function becomes: `async function generatePersona(seed = undefined)`
- Conditional prompt based on whether seed exists:
  ```javascript
  if (seed) {
    userPrompt = `Use this as inspiration: "${seed}" Create a persona...`;
  } else {
    userPrompt = `Choose ANY character you want (fictional, historical, original, real)...`;
  }
  ```
- Remove role parameter
- Remove default seed array from startGame
- Allow database/API to pass seed when creating players

### 2. Fix Procedural Fallback

**Files affected:** `game-engine.js`
**Function:** `generateProceduralPersona(line 240-452)`

**Changes:**

- Remove `seedDescription` and `role` parameters
- Function becomes: `function generateProceduralPersona()`
- Remove all seed parsing logic
- Simple random persona generation:

  ```javascript
  function generateProceduralPersona() {
    const firstNames = [...]; // 30 diverse names
    const lastNames = [...]; // 30 diverse names

    return {
      name: `${first} ${last}`,
      personality: "...",
      coreTraits: [...],
      communicationCadence: "...",
      keyFlaw: "...",
    };
  }
  ```

### 3. Separate Persona Generation from Role Assignment

**Files affected:** `game-engine.js`
**Function:** `startGame(line 881-1011)`

**Current flow:**

```
for each player:
  seed = personaSeeds[i]
  role = roles[i]
  persona = generatePersonaFromSeed(seed, role)  // ← Role passed in!
  player = createPlayer(persona, role)
```

**New flow:**

```
// Step 1: Generate all personas (parallel, no game context)
const personaPromises = [];
for (let i = 0; i < numPlayers; i++) {
  personaPromises.push(generatePersona());
}
const personas = await Promise.all(personaPromises);

// Step 2: Assign roles (after personas created)
const roles = this.calculateRoles(numPlayers);
for (let i = 0; i < numPlayers; i++) {
  const persona = personas[i];
  const role = roles[i];
  player = createPlayer(persona, role);
}
```

### 4. Add Win Condition Check at Start of Night

**Files affected:** `game-engine.js`
**Function:** `runNightPhase(line 1005-1106)`

**Current state:** NO win condition check at start of night

**Add at line 1010 (after this.round++):**

```javascript
// CHECK WIN CONDITION BEFORE STARTING NIGHT
const alivePlayers = this.players.filter((p) => p.isAlive);
const aliveMafia = alivePlayers.filter((p) => p.isMafia);
const aliveTown = alivePlayers.filter((p) => !p.isMafia);

if (aliveMafia.length >= aliveTown.length) {
  console.log("\n" + E.WIN + " WIN CONDITION CHECK:");
  console.log("  Mafia: " + aliveMafia.length + ", Town: " + aliveTown.length);
  console.log("\n" + E.MAFIAWIN + " MAFIA WINS! Mafia controls the town!");
  return;
}

if (aliveMafia.length === 0) {
  console.log("\n" + E.WIN + " WIN CONDITION CHECK:");
  console.log("  Mafia: 0, Town: " + aliveTown.length);
  console.log("\n" + E.TOWN + " TOWN WINS! All mafia eliminated!");
  return;
}
```

### 5. Support Multiple Doctors and Sheriffs

**Files affected:** `game-engine.js`
**Functions:** `runNightPhase` - doctor section (line 1430-1475), sheriff section (line 1493-1537)

**Current:**

```javascript
const aliveDoctor = alivePlayers.filter((p) => p.role === "DOCTOR");
if (aliveDoctor.length > 0) {
  const doctor = aliveDoctor[0];  // ← Only first one!
```

**Change to:**

```javascript
const aliveDoctors = alivePlayers.filter((p) => p.role === "DOCTOR");
for (const doctor of aliveDoctors) {  // ← All doctors!
  const gameState = {...};
  const response = await this.getAIResponse(doctor, gameState);
  // ... handle save
}
```

Same for sheriff.

### 6. Fix Vigilante One-Shot

**Files affected:** `game-engine.js`
**Functions:** `runVigilanteAction(line 1540-1572)` and `night resolution(line 1600-1617)`

**Current:** `this.vigilanteShotUsed` is set but NEVER checked before allowing shot

**Fix in `runVigilanteAction` around line 1542:**

```javascript
const aliveVigilante = alivePlayers.filter(
  (p) => p.role === "VIGILANTE" && p.isAlive && !this.vigilanteShotUsed,
); // ← Add !this.vigilanteShotUsed check
```

### 7. Fix Mafia Memory to Show All Messages

**Files affected:** `game-engine.js`
**Location:** `runNightPhase`, mafia chat section (line 1164-1168)

**Current:**

```javascript
previousPhaseData:
  "Mafia discussion so far:\n" +
  mafiaMessages
    .slice(-3)  // ← ONLY LAST 3!
    .map((m) => "  - " + m.player + ": " + m.says)
    .join("\n"),
```

**Change to:**

```javascript
previousPhaseData:
  "Mafia discussion so far:\n" +
  mafiaMessages  // ← ALL MESSAGES
    .map((m) => "  - " + m.player + ": " + m.says)
    .join("\n"),
```

### 8. Add Think→Speak to All Prompts

**Files affected:** `game-engine.js`
**Function:** `createPrompt(line 786-960)`

**Add to EVERY prompt (lines 795-795 for role instructions):**

```
## THINK → SPEAK PATTERN
Before speaking, you must think privately, then speak publicly.
- THINK: Your private reasoning and strategy
- SAYS: Your public statement

Return JSON: {"think": "...", "says": "...", "action": {...}}
```

**Currently only in:**

- Mafia chat prompt (implicitly works)
- Day discussion prompt

**Missing from:**

- Doctor action
- Sheriff investigation
- Vigilante action
- Voting

### 9. Add Villager Base Prompt to Everyone

**Files affected:** `game-engine.js`
**Function:** `createPrompt(line 786-960)`

**Add at line 791 (after role instructions, before persona context):**

```
## BASE VILLAGER BEHAVIOR (Applies to Everyone)

As a villager in this town:
- Watch for suspicious behavior in voting patterns and statements
- Be helpful and cooperative with other townspeople
- Share information to help the town identify mafia
- Vote for players you suspect are mafia
- Protect yourself and your friends from accusations

(If you are mafia, you must pretend to follow these behaviors while secretly working to eliminate the town)
```

### 10. Remove All Seed-Related Code from startGame

**Files affected:** `game-engine.js`
**Function:** `startGame(line 881-1011)`

**Remove lines 885-919:**

```javascript
// DELETE ALL THIS:
// Default seeds if none provided - rich personality descriptions
if (!personaSeeds) {
  personaSeeds = [
    "A quiet accountant who loves solving puzzles...",
    // ... more seeds
  ];
}

// DELETE ALL THIS:
// Ensure we have enough seeds for all players (cycle if needed)
while (personaSeeds.length < numPlayers) {
  const moreSeeds = [...];
  personaSeeds.push(...moreSeeds);
}
```

**Change function signature:**

```javascript
// From:
async startGame(numPlayers = 5, personaSeeds = null)

// To:
async startGame(numPlayers = 5)
```

**Remove from display (line 973):**

```javascript
// DELETE:
console.log("      Seed: " + (p.persona.seed || "Generated"));
```

---

## Priority Order

### BLOCKER (Can't proceed without these fixes)

1. ⏳ Make seed optional (seed = undefined, LLM chooses freely when no seed provided, uses as guidance when seed provided)
2. ❌ Separate persona generation from role assignment

### CRITICAL (Game-breaking bugs)

3. ✅ Win condition at start of day (done in commit 838b184)
4. ⏳ Win condition at start of night
5. ⏳ Vigilante one-shot enforcement
6. ⏳ Multiple doctors/sheriffs support

### HIGH QUALITY (Spec compliance)

7. ⏳ Think→Speak everywhere
8. ⏳ Mafia full memory
9. ⏳ Villager base prompt

---

## Testing Strategy

After each fix:

1. Run 5-player game (minimum)
2. Run 10-player game (standard)
3. Verify:
   - Personas generated without knowing roles
   - Diverse names (no stereotypical Italian)
   - Win condition checked at start of night AND day
   - Multiple doctors can each save
   - Multiple sheriffs can each investigate
   - Vigilante can only shoot once
   - Mafia sees full chat history
   - Everyone gets think→speak pattern
