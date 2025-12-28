# Critical Issues Found - Audit Results

## CRITICAL FAILURES REQUIRING IMMEDIATE FIX

### 1. Win Condition Wrong Location

**Spec:** "ALWAYS check at these points: Start of Night, Start of Day, After any death"

**Current State:**

- ✅ Check at START of `runDayPhase()` (we added this on commit 838b184)
- ❌ NO check at START of `runNightPhase()` - after day ends, before night starts
- ❌ NO check after vigilante shot resolution

**Impact:** Game runs extra cycles after mafia should have won

**Fix Required:**

```javascript
async runNightPhase(gameId) {
  // CHECK WIN CONDITION BEFORE STARTING NIGHT
  const alivePlayers = this.players.filter((p) => p.isAlive);
  const aliveMafia = alivePlayers.filter((p) => p.isMafia);
  const aliveTown = alivePlayers.filter((p) => !p.isMafia);

  if (aliveMafia.length >= aliveTown.length) {
    console.log("\n🏆 MAFIA WINS!");
    return;
  }

  if (aliveMafia.length === 0) {
    console.log("\n🏆 TOWN WINS!");
    return;
  }

  // ... continue with night phase
}
```

### 2. Seeds STILL Being Used

**Spec:** "Shut the fuck up with this seed concept"

**Current State:**

- ❌ Line 976-987: Default seed array still defined
- ❌ Line 100: Persona prompt references seed
- ❌ Function takes `seedDescription` parameter
- ❌ Line 75: Fallback uses `seedDescription, role`

**Fix Required:**

1. Remove all seed-related code
2. Rewrite persona prompt to say "Choose ANY character you want"
3. Remove seed parameter from all functions
4. LLM should generate entirely freestyle

### 3. Role Assigned DURING Persona Generation

**Spec:** "persona portion is decided before it even knows it's playing the game Mafia"

**Current State:**

- ❌ Line 72: `async function generatePersonaFromSeed(seedDescription, role)`
- ❌ Line 100: Prompt includes `GAME ROLE: ${role}`
- ❌ Line 1046: `const role = roleAssignment[i] || "VILLAGER"` passed during generation

**Fix Required:**

1. Generate ALL personas first (no role info)
2. Shuffle roles
3. Assign roles AFTER personas created
4. Provide role prompts AFTER assignment

### 4. Think→Speak Missing in Many Places

**Spec:** "every time before it speaks, it thinks. Then it speaks, we log the thinking"

**Missing Think In:**

- ❌ Doctor action prompt
- ❌ Sheriff investigation prompt
- ❌ Vigilante action prompt
- ❌ Voting prompt
- ✅ Mafia chat (has think)
- ✅ Day discussion (has think)

**Fix Required:**
Add to ALL prompts:

```
You must output BOTH:
- THINK (private reasoning) - your actual thoughts
- SAYS (public statement) - what you say aloud

Return JSON: {"think": "...", "says": "...", "action": {...}}
```

### 5. Mafia Memory Incomplete

**Current State:**

```javascript
previousPhaseData: "Mafia discussion so far:\n" +
  mafiaMessages.slice(-3)  // ← ONLY LAST 3 MESSAGES!
  .map((m) => "  - " + m.player + ": " + m.says)
  .join("\n"),
```

**Spec:** "Mafia remember everything Mafia has said to each other"

**Fix Required:**

```javascript
previousPhaseData: "Mafia discussion so far:\n" +
  mafiaMessages  // ← ALL MESSAGES, NOT JUST LAST 3
  .map((m) => "  - " + m.player + ": " + m.says)
  .join("\n"),
```

### 6. Vigilante Can Shoot Every Night

**Current State:**

```javascript
this.vigilanteShotUsed = false; // Created but NEVER USED
```

**Fix Required:**

```javascript
async runVigilanteAction() {
  const aliveVigilante = alivePlayers.filter((p) => p.role === "VIGILANTE");
  if (aliveVigilante.length > 0 && !this.vigilanteShotUsed) {
    // ... allow shot
    if (vigilante?.nightTarget) {
      this.vigilanteShotUsed = true;  // ← SET THIS
      // ... execute shot
    }
  }
}
```

### 7. Multiple Doctors/Sheriffs Ignored

**Current State:**

```javascript
const aliveDoctor = alivePlayers.filter((p) => p.role === "DOCTOR");
if (aliveDoctor.length > 0) {
  const doctor = aliveDoctor[0];  // ← ONLY FIRST ONE!
```

**Fix Required:**

```javascript
const aliveDoctors = alivePlayers.filter((p) => p.role === "DOCTOR");
for (const doctor of aliveDoctors) {
  // Each doctor gets to save someone
  const gameState = {...};
  const response = await this.getAIResponse(doctor, gameState);
  // ... handle save
}
```

Same for sheriff.

### 8. No Villager Base Prompt

**Spec:** "everyone gets the villager prompt, because the Mafia need to pretend to be villagers"

**Current State:**

- Only role-specific prompts exist
- No universal villager behavior guide

**Fix Required:**
Add to beginning of ALL prompts (including mafia):

```
## BASE VILLAGER BEHAVIOR
- You are a villager in a town trying to find the mafia
- Watch for suspicious behavior and voting patterns
- Be helpful and cooperative
- Share information to help the town
- Vote for who you think is mafia

(Note: If you are mafia, you must pretend to follow these behaviors while secretly working for your team)
```

### 9. Sequential API Calls with Artificial Delays

**Current State:**

```javascript
if (API_KEY && i < numPlayers - 1) {
  await new Promise((r) => setTimeout(r, 100));
}
```

**Fix Required:**
Remove delay, use Promise.all() for parallel calls:

```javascript
const personaPromises = personaSeeds.map(async (seed, i) => {
  return await generatePersona();
});
const personas = await Promise.all(personaPromises);
```

### 10. No Statistics Tracking

**Current State:** Zero

**Fix Required:**

- Track winner (mafia/town)
- Track per-model win rates
- Track per-role win rates
- Track token usage
- Track cost
- Store in database

---

## ARCHITECTURAL ISSUE

### 11. Monolithic 2100+ Line File

**Impact:**

- Impossible to maintain
- Easy to introduce bugs
- Can't test in isolation
- Cognitive overload

**Fix Required:**
Split into:

```
engine/
  - index.js (main game class)
  - roles/ (role-specific logic)
  - phases/ (night, day, discussion, voting)
  - persona.js (persona generation)
  - memory.js (memory management)
  - stats.js (statistics tracking)
  - types.js (type definitions)
```

---

## NEXT ACTIONS IN PRIORITY ORDER

### IMMEDIATE (Blockers)

1. ✅ Win condition at start of day phase - DONE (commit 838b184)
2. ⏳ Win condition at start of night phase - NOT DONE
3. ⏳ Remove seeds entirely - NOT DONE
4. ⏳ Separate persona generation from role assignment - NOT DONE

### CRITICAL (Game Breaking)

5. ⏳ Vigilante one-shot enforcement - NOT DONE
6. ⏳ Multiple doctors/sheriffs support - NOT DONE
7. ⏳ Think→Speak everywhere - PARTIALLY DONE
8. ⏳ Mafia full memory - NOT DONE

### HIGH QUALITY (Spec Compliance)

9. ⏳ Villager base prompt for everyone - NOT DONE
10. ⏳ Statistics tracking - NOT DONE

### ARCHITECTURE (Long-term)

11. ⏳ Split game-engine.js into modules - NOT DONE

---

## STATUS

As of commit 838b184:

- ✅ Dynamic role assignment working
- ✅ Diverse names (partially - LLM still choosing)
- ❌ Still using seeds (main blocker)
- ❌ Persona knows role during generation (main blocker)
- ❌ Win condition only checked at start of day (should also check at start of night)
- ❌ Win condition not checked after deaths
- ❌ Vigilante can shoot every night
- ❌ Only first doctor/sheriff acts
- ❌ No villager base prompt
- ❌ No statistics tracking
