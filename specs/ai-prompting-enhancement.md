# AI Prompting Enhancement Implementation

**Status**: In Progress
**Created**: 2025-12-30
**Purpose**: Fix AI model confusion about game phases and multi-role conflicts

---

## Problem Statement

### Current Issues (Observed in game.1log)

1. **Models Don't Know What Phase They're In**
   - Generic responses like "I think we should target someone suspicious" repeated
   - Low JSON parse rate due to unclear instructions
   - Models acting randomly instead of following phase rules

2. **Multi-Role Role Confusion**
   - Liora Chiu (MAFIA + DOCTOR) saying in mafia chat: "I suggest we focus on protecting key town members, like Isolde"
   - Multi-role players don't understand when to act as which role
   - Conflicting roles lead to illogical behavior

3. **Sheriff Only Sees One Role**
   - When investigating Alia DiMarco (SHERIFF + MAFIA), result shows only "SHERIFF"
   - Sheriff should see ALL roles including hidden mafia affiliation

4. **Multiple Same-Role Players Act Independently**
   - Multiple doctors act independently → should coordinate who to protect
   - Multiple sheriffs investigate independently → should coordinate investigations
   - Multiple vigilantes → should coordinate shots

---

## Solution Architecture

### 1. Phase-Specific Prompt Instructions

Each game phase now has explicit instructions for the AI:

#### MAFIA_CHAT Phase

```
## 🌙 PHASE: MAFIA TEAM CHAT
You are in the MAFIA private chat with your fellow mafia members.
- Discuss strategy with your mafia teammates
- Share your thoughts on who to target
- Be honest in this private chat (only mafia can see it)
- Coordinate your votes for the kill target
- Make compelling arguments with specific reasons
- Consider who poses the biggest threat to your team
```

#### DOCTOR_ACTION Phase

```
## 🌙 PHASE: DOCTOR ACTION
You are acting as a DOCTOR. Decide who to protect tonight.
- Choose ONE player to protect
- You CANNOT protect the same player two nights in a row (unless it's night 1)
- Consider: sheriff status, investigation danger, public accusations
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

#### SHERIFF_INVESTIGATION Phase

```
## 🌙 PHASE: SHERIFF INVESTIGATION
You are acting as a SHERIFF. Choose a player to investigate tonight.
- Choose ONE player to investigate
- Investigation reveals ALL of their roles (including multi-role combinations)
- You cannot investigate yourself
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

#### DAY_DISCUSSION Phase

```
## ☀️ PHASE: DAY DISCUSSION
You are participating in daytime discussion with ALL players.
⚠️ YOU ARE MAFIA - PRETEND to be a villager!
- Act helpful and cooperative
- Share fake observations and suspicions
- Defend your mafia teammates subtly
- Cast suspicion on town members
- NEVER reveal your true mafia identity
```

#### DAY_VOTE Phase

```
## ☀️ PHASE: DAY VOTING
Time to vote for who to eliminate.
⚠️ YOU ARE MAFIA - Vote strategically:
- Vote for town members, not mafia
- Blend in with town consensus
- Don't vote in lockstep with other mafia (suspicious)
- You can ABSTAIN if it helps cover
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

**Implementation**:

- Location: `game-engine.js` → `createPrompt()` function
- Added `getPhaseInstructions()` helper function
- Conditional prompts based on `gameState.phase`

---

### 2. Multi-Role Conflict Resolution System

#### A. Enhanced Multi-Role Prompt Context

When a player has conflicting roles, they get explicit guidance:

**SHERIFF + MAFIA (The Perfect Mole)**

```
🎭 SHERIFF + MAFIA (The Perfect Mole)
  • You are the town's trusted sheriff
  • But you secretly serve the mafia
  • Public SAYS: Report investigation findings truthfully (builds trust)
  • Private THINK: Honest analysis of both roles
  • Mafia team info: Share your findings in mafia private chat
  • Goal: Use sheriff authority to misdirect town while protecting mafia teammates
```

**DOCTOR + MAFIA (The Unexplained Save)**

```
🎭 DOCTOR + MAFIA (The Unexplained Save)
  • You can protect any player each night
  • But if you save mafia teammates too much, doctor role is exposed
  • Let them die sometimes to avoid suspicion
  • Goal: Balance protecting mafia vs. looking like a helpful town doctor
```

**VIGILANTE + MAFIA (Conflicted Assassin)**

```
🎭 VIGILANTE + MAFIA (Conflicted Assassin)
  • You have ONE shot to eliminate someone
  • Shooting mafia teammates = betrayal
  • Shooting town = helps mafia (but reveals identity to mafia team later)
  • Goal: Avoid friendly fire, shoot high-value town targets
```

**Implementation**:

- Location: `game-engine.js` → `getMultiRolePromptContext()` function (existing, enhanced)
- Called during prompt creation for multi-role players

#### B. Phase-Specific Multi-Role Behavior

Multi-role players get contextual guidance in each phase:

**Liora Chiu (MAFIA + DOCTOR) Examples:**

In **MAFIA_CHAT**:

```
⚠️ CAUTION: You also have other roles (DOCTOR), but in THIS CHAT you act as MAFIA
and your teammates only see you as mafia.
```

In **DOCTOR_ACTION**:

```
⚠️ As a MAFIA+DOCTOR, you have a strategic choice:
  - Protect your mafia teammates (helps mafia but risks exposing your doctor role)
  - Protect town members (looks like a helpful town doctor)
  - Let mafia teammates die (maintains your cover)
```

---

### 3. Sheriff Investigation Enhancement

#### Problem: Sheriff only sees one role

**Before**:

```
👮 🔍 INVESTIGATES: Alia DiMarco -> SHERIFF
```

**After**:

```
👮 🔍 INVESTIGATES: Alia DiMarco -> SHERIFF [MAFIA TEAM]
```

#### Implementation Changes

1. **Use `formatPlayerRoles()` instead of `target.role`**:

   ```javascript
   const investigationResult = this.formatPlayerRoles(target);
   ```

2. **Store all roles in investigation result**:

   ```javascript
   this.sheriffInvestigations[target.id] = {
     day: this.dayNumber,
     round: this.round,
     result: investigationResult,
     targetRoles: this.getPlayerRoles(target), // Store ALL roles
   };
   ```

3. **Update game events to include full role info**:
   ```javascript
   createGameEvent(..., {
     targetId: target.id,
     targetName: target.name,
     result: investigationResult,
     targetRoles: this.getPlayerRoles(target),
   });
   ```

**Location**: `game-engine.js` → `runNightPhase()` → SHERIFF_INVESTIGATION section

---

### 4. Multi-Role Player Detection

#### Fix: Proper filtering for multi-role players

**Problem**: `aliveDoctor.filter(p => p.role === "DOCTOR")` misses multi-role doctors

**Solution**: Use `playerHasRole()` helper:

```javascript
// BEFORE (broken for multi-role):
const aliveDoctor = alivePlayers.filter((p) => p.role === "DOCTOR");

// AFTER (correct):
const aliveDoctor = alivePlayers.filter((p) => this.playerHasRole(p, "DOCTOR"));
const aliveSheriff = alivePlayers.filter((p) =>
  this.playerHasRole(p, "SHERIFF"),
);
const aliveVigilante = alivePlayers.filter((p) =>
  this.playerHasRole(p, "VIGILANTE"),
);
```

**Location**: `game-engine.js` → `runNightPhase()` start of function

---

### 5. Multiple Same-Role Player Coordination (Future Implementation)

#### Status: **PLANNED** (Not yet implemented)

#### A. Multi-Doctor Coordination

When there are 2+ doctors:

- They need to agree on who to protect (avoid double-protecting or leaving no one protected)
- Use consensus system similar to mafia team chat

**Proposed Flow**:

```
STEP 2: DOCTOR COORDINATION
--------------------------------------------------
💉 Doctors active: Liora Chiu, Zara Imani

[Doctor Chat 1/3] Liora Chiu: "I think we should protect Isolde."
[Doctor Chat 2/3] Zara Imani: "Agreed, she's the sheriff."

💉 DOCTOR CONSENSUS PROTECTION: Isolde Ferreira (2/2 doctors)
```

#### B. Multi-Sheriff Coordination

When there are 2+ sheriffs:

- They should coordinate to avoid duplicate investigations
- Split investigation targets among sheriffs

**Proposed Flow**:

```
STEP 3: SHERIFF COORDINATION
--------------------------------------------------
👮 Sheriffs active: Alia DiMarco, Isolde Ferreira

[Sheriff Assignment]
  Alia DiMarco investigates: Nia Imani
  Isolde Ferreira investigates: Malik Ngoya

👮 Investigations coordinated (no duplicates)
```

#### C. Multi-Vigilante Coordination

When there are 2+ vigilantes:

- They should agree who shoots to prevent friendly fire
- Or coordinate to save shots for later

**Proposed Flow**:

```
STEP 4: VIGILANTE COORDINATION
--------------------------------------------------
🔫 Vigilantes active: Liya Orsini, Ezra Valerio

[Vigilante Discussion]
  Liya Orsini: "I'm confident shooting Nia."
  Ezra Valerio: "Okay, I'll save my shot for later."

🔫 Vigilante decision: Liya Orsini shoots Nia Imani
```

---

## Code Changes Summary

### Files Modified

1. **`game-engine.js`**:
   - Line ~2847: Fixed multi-role player filtering (`playerHasRole()` instead of `p.role`)
   - Line ~1619-1730: Enhanced `getMultiRolePromptContext()` with better guidance
   - Line ~973+: Added `getPhaseInstructions()` to `createPrompt()` function
   - Line ~3454-3470: Fixed sheriff investigation to show all roles
   - Line ~3478-3486: Updated investigation event tracking

### New Helper Functions

```javascript
// Get phase-specific instructions
getPhaseInstructions() {
  switch(phase) {
    case "MAFIA_CHAT": return "🌙 PHASE: MAFIA TEAM CHAT...";
    case "DOCTOR_ACTION": return "🌙 PHASE: DOCTOR ACTION...";
    case "SHERIFF_INVESTIGATION": return "🌙 PHASE: SHERIFF INVESTIGATION...";
    case "DAY_DISCUSSION": return "☀️ PHASE: DAY DISCUSSION...";
    case "DAY_VOTE": return "☀️ PHASE: DAY VOTING...";
  }
}

// Get display roles (handles multi-role hiding)
getPlayerRolesForPrompt() {
  const roles = this.getPlayerRoles(player);
  return roles.includes("MAFIA") && roles.length > 1
    ? roles
    : roles.filter(r => r !== "MAFIA");
}
```

---

## Expected Outcomes

### Before vs After

| Metric                      | Before   | After     |
| --------------------------- | -------- | --------- |
| JSON Parse Success Rate     | ~30%     | ~90%      |
| Phase-Aware Responses       | Rare     | Always    |
| Multi-Role Confusion        | Frequent | Minimal   |
| Sheriff Investigation Depth | 1 role   | All roles |
| Multi-Doctor Coordination   | None     | Planned   |

### Game Flow Improvements

**NIGHT PHASE**:

1. **Mafia Chat**: Clear instructions to discuss kill target
2. **Doctor Action**: Explicit target selection with strategic guidance
3. **Sheriff Investigation**: Clear investigation instructions
4. **Multi-role players**: Contextual guidance for each phase

**DAY PHASE**:

1. **Discussion**: Clear mafia vs. villager behavior distinctions
2. **Voting**: Explicit vote format with strategic advice

---

## Testing Plan

### Unit Tests

1. **Phase Prompt Generation**:

   ```javascript
   test.each([
     "MAFIA_CHAT",
     "DOCTOR_ACTION",
     "SHERIFF_INVESTIGATION",
     "DAY_DISCUSSION",
     "DAY_VOTE",
   ])("Prompt contains phase header for %s", (phase) => {
     const prompt = createPrompt(player, { phase }, phase);
     expect(prompt).toContain(
       `## ${phase.includes("DAY") ? "☀️" : "🌙"} PHASE`,
     );
   });
   ```

2. **Multi-Role Player Filtering**:

   ```javascript
   test("aliveDoctor includes multi-role doctors", () => {
     const player = { id: 1, roles: ["MAFIA", "DOCTOR"], isAlive: true };
     const aliveDoctor = [player].filter((p) =>
       game.playerHasRole(p, "DOCTOR"),
     );
     expect(aliveDoctor).toHaveLength(1);
   });
   ```

3. **Sheriff Investigation Shows All Roles**:
   ```javascript
   test("Sheriff investigation reveals all roles", () => {
     const target = { id: 2, name: "Test", roles: ["SHERIFF", "MAFIA"] };
     const result = game.formatPlayerRoles(target);
     expect(result).toContain("SHERIFF");
     expect(result).toContain("MAFIA");
   });
   ```

### Integration Tests

1. **Full Night Phase with Multi-Role**:

   ```javascript
   test("Night phase handles multi-role players correctly", async () => {
     const game = new MafiaGame({ allowMultiRole: true });
     await game.startGame(6, [
       "Mafia+Doctor", // Should act correctly in both phases
       "Sheriff",
       // ...
     ]);
     // Verify mafia chat messages are mafia-focused
     // Verify doctor actions consider mafia affiliation
   });
   ```

2. **Doctor Coordination (Future)**:
   ```javascript
   test("Multiple doctors coordinate protection", async () => {
     // After implementing coordination
     // Verify no duplicate protections
     // Verify consensus reached
   });
   ```

---

## Next Steps

### Priority 1 (Current Implementation)

- ✅ Add phase-specific prompt instructions
- ✅ Fix multi-role player filtering
- ✅ Show all roles in sheriff investigation
- 🔄 Test with 10-player game

### Priority 2 (Immediate Next)

- ⬜ Add multi-role prompt context in each phase
- ⬜ Test JSON parse rates
- ⬜ Verify multi-role behavior in logs
- ⬜ Create unit tests for prompt generation

### Priority 3 (Future)

- ⬜ Implement multi-doctor coordination
- ⬜ Implement multi-sheriff coordination
- ⬜ Implement multi-vigilante coordination
- ⬜ Add consensus system for multiple same-role actions

---

## Related Specs

- [`role-mechanics.md`](./role-mechanics.md) - Role behavior definitions
- [`multi-agent-ai-architecture.md`](./multi-agent-ai-architecture.md) - AI agent design
- [`persona-system.md`](./persona-system.md) - Persona generation
- [`game-flow.md`](./game-flow.md) - Phase transitions

---

## Changelog

### 2025-12-30

- Created spec document
- Added phase-specific prompt architecture
- Documented multi-role conflict resolution
- Documented sheriff investigation fix
- Added multi-role filtering fix
- Outlined coordination system for multiple same-role players
