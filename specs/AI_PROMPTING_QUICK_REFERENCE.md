# AI Prompting Changes - Quick Reference

**Updated**: 2025-12-30
**Purpose**: Quick reference for all AI prompting changes

---

## Phase-Specific Prompts

### Night Phases

#### 🌙 MAFIA_CHAT

```
You are in the MAFIA private chat with your fellow mafia members.
- Discuss strategy with your mafia teammates
- Share your thoughts on who to target
- Be honest in this private chat (only mafia can see it)
- Coordinate your votes for the kill target
- Make compelling arguments with specific reasons
- Consider who poses the biggest threat to your team
```

#### 🌙 MAFIA_KILL_VOTE

```
Time to vote for your target.
- Vote for ONE town member to eliminate tonight
- Consider strategic priorities (shown below)
- Coordinate with your teammates to reach consensus
- Your vote should have a clear reason
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

#### 🌙 MAFIA_PERSUADE

```
Time to convince your mafia teammates.
- Convince other mafia to vote for your preferred target
- Use specific arguments about why that target is dangerous
- Counter-arguments for other targets
- Vote with persuasion to sway the consensus
```

#### 🌙 DOCTOR_ACTION

```
You are acting as a DOCTOR. Decide who to protect tonight.
⚠️ As a MAFIA+DOCTOR, you have a strategic choice:
  - Protect your mafia teammates (helps mafia but risks exposing your doctor role)
  - Protect town members (looks like a helpful town doctor)
  - Let mafia teammates die (maintains your cover)
- Choose ONE player to protect
- You CANNOT protect the same player two nights in a row (unless it's night 1)
- Consider: sheriff status, investigation danger, public accusations
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

#### 🌙 SHERIFF_INVESTIGATION

```
You are acting as a SHERIFF. Choose a player to investigate tonight.
⚠️ As a MAFIA+SHERIFF, you:
  - Have access to sheriff investigations
  - Share findings with mafia team (makes you very valuable)
  - Report findings publicly to gain trust (builds your cover)
- Choose ONE player to investigate
- Investigation reveals ALL of their roles (including multi-role combinations)
- You cannot investigate yourself
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

#### 🌙 VIGILANTE_ACTION

```
You are acting as a VIGILANTE. Decide if you want to use your shot tonight.
⚠️ As a MAFIA+VIGILANTE, you:
  - Have one shot to use
  - Shooting mafia = betrayal your team
  - Shooting town = helps mafia (but may expose vigilante role to mafia team)
  Consider passing to avoid suspicion.
- You can shoot ONE player ONCE during the entire game
- If you shoot and kill a town member accidentally, it's bad
- Consider waiting for more information
- You can PASS and save your shot for later
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

### Day Phases

#### ☀️ DAY_DISCUSSION

```
You are participating in daytime discussion with ALL players.
⚠️ YOU ARE MAFIA - PRETEND to be a villager!
- Act helpful and cooperative
- Share fake observations and suspicions
- Defend your mafia teammates subtly
- Cast suspicion on town members
- NEVER reveal your true mafia identity
```

#### ☀️ DAY_VOTE

```
Time to vote for who to eliminate.
⚠️ YOU ARE MAFIA - Vote strategically:
- Vote for town members, not mafia
- Blend in with town consensus
- Don't vote in lockstep with other mafia (suspicious)
- You can ABSTAIN if it helps cover
- Output: {"action": {"target": "Player Name", "reasoning": "your reason"}}
```

---

## Multi-Role Conflict Context

### SHERIFF + MAFIA

```
🎭 SHERIFF + MAFIA (The Perfect Mole)
  • You are the town's trusted sheriff
  • But you secretly serve the mafia
  • Public SAYS: Report investigation findings truthfully (builds trust)
  • Private THINK: Honest analysis of both roles
  • Mafia team info: Share your findings in mafia private chat
  • Goal: Use sheriff authority to misdirect town while protecting mafia teammates
```

### DOCTOR + MAFIA

```
🎭 DOCTOR + MAFIA (The Unexplained Save)
  • You can protect any player each night
  • But if you save mafia teammates too much, doctor role is exposed
  • Let them die sometimes to avoid suspicion
  • Goal: Balance protecting mafia vs. looking like a helpful town doctor
```

### VIGILANTE + MAFIA

```
🎭 VIGILANTE + MAFIA (Conflicted Assassin)
  • You have ONE shot to eliminate someone
  • Shooting mafia teammates = betrayal
  • Shooting town = helps mafia (but reveals identity to mafia team later)
  • Goal: Avoid friendly fire, shoot high-value town targets
```

### SHERIFF + DOCTOR

```
🎭 SHERIFF + DOCTOR (Powerful Town Duo)
  • You can investigate AND protect
  • Can self-protect if needed (as doctor)
  • Sheriff info guides doctor decisions
  • Goal: Use both abilities strategically to protect town
```

---

## Coordination System (Planned)

### Multi-Doctor Coordination (Phase 2A + 2B)

```javascript
// Phase 2A: Doctor Team Chat (3 messages each)
DOCTOR_COORDINATION:
- Coordinate with other doctors on protection targets
- Discuss strategic priorities
- Try to reach consensus

// Phase 2B: Protection Vote
DOCTOR_PROTECTION_VOTE:
- Vote for consensus protection target
- Avoid double-protection
- Maximize strategic impact
```

### Multi-Sheriff Coordination (Phase 3A + 3B)

```javascript
// Phase 3A: Sheriff Coordination (2 messages each)
SHERIFF_COORDINATION:
- Coordinate to avoid duplicate investigations
- Share investigation history
- Split high-suspicion targets

// Phase 3B: Investigation Assignment
SHERIFF_INVESTIGATION_ASSIGNMENT:
- Choose from available (unassigned) targets
- Assign unique investigations
- Maximize coverage
```

### Multi-Vigilante Coordination (Phase 4A + 4B)

```javascript
// Phase 4A: Vigilante Discussion (2 messages each)
VIGILANTE_COORDINATION:
- Coordinate shooting decisions
- Avoid friendly fire
- Only ONE vigilante should shoot

// Phase 4B: Shot Decision
VIGILANTE_ACTION:
- Decide whether to shoot
- Coordinate with other vigilantes
- Save shot if no clear target
```

---

## Code Changes Summary

### In `createPrompt()` function (line ~973)

1. **Added `getPhaseInstructions()` helper**:

   ```javascript
   const getPhaseInstructions = () => {
     switch (phase) {
       case "MAFIA_CHAT":
         return `## 🌙 PHASE: MAFIA TEAM CHAT...`;
       case "DOCTOR_ACTION":
         return `## 🌙 PHASE: DOCTOR ACTION...`;
       // ... etc
     }
   };
   ```

2. **Added `getPlayerRolesForPrompt()` helper**:

   ```javascript
   const getPlayerRolesForPrompt = () => {
     const roles = this.getPlayerRoles(player);
     return roles.includes("MAFIA") && roles.length > 1
       ? roles // Show all roles if multi-role with mafia
       : roles.filter((r) => r !== "MAFIA"); // Hide mafia if single-role
   };
   ```

3. **Enhanced multi-role context in prompts**:

   ```javascript
   const displayRoles = getPlayerRolesForPrompt();
   const isMafia = displayRoles.includes("MAFIA") || player.isMafia;

   // Phase-specific guidance for multi-role players
   // e.g., "⚠️ As a MAFIA+DOCTOR, you have a strategic choice..."
   ```

### In `runNightPhase()` function (line ~2843)

1. **Fixed multi-role player filtering** (line ~2847):

   ```javascript
   // BEFORE: const aliveDoctor = alivePlayers.filter((p) => p.role === "DOCTOR");
   // AFTER:
   const aliveDoctor = alivePlayers.filter((p) =>
     this.playerHasRole(p, "DOCTOR"),
   );
   const aliveSheriff = alivePlayers.filter((p) =>
     this.playerHasRole(p, "SHERIFF"),
   );
   const aliveVigilante = alivePlayers.filter((p) =>
     this.playerHasRole(p, "VIGILANTE"),
   );
   ```

2. **Fixed sheriff investigation** (line ~3454):

   ```javascript
   // Show ALL roles for multi-role players
   const investigationResult = this.formatPlayerRoles(target);
   console.log(
     E.SHERIFF +
       " 🔍 INVESTIGATES: " +
       target.name +
       " -> " +
       investigationResult,
   );

   // Store all roles
   this.sheriffInvestigations[target.id] = {
     day: this.dayNumber,
     round: this.round,
     result: investigationResult,
     targetRoles: this.getPlayerRoles(target), // Store all roles
   };
   ```

---

## Expected Outcomes

| Metric                       | Before   | After                        |
| ---------------------------- | -------- | ---------------------------- |
| JSON Parse Success Rate      | ~30%     | ~90%                         |
| Phase-Aware Responses        | Rare     | Always                       |
| Multi-Role Confusion         | Frequent | Minimal                      |
| Sheriff Investigation Depth  | 1 role   | All roles                    |
| Multi-Doctor Coordination    | None     | Consensus (Planned)          |
| Multi-Sheriff Coordination   | None     | Unique assignments (Planned) |
| Multi-Vigilante Coordination | None     | Coordinated shots (Planned)  |

---

## Testing Commands

```bash
# Quick 5-player test
node -e "
const { MafiaGame } = require('./game-engine');
async function runQuickGame() {
  const game = new MafiaGame({ enableDatabase: false, allowMultiRole: false, maxRetries: 2 });
  await game.startGame(5, ['Alex', 'Morgan', 'Jordan', 'Casey', 'Taylor']);
}
runQuickGame();
"

# Full 10-player test with multi-role
node src/tests/unit/test-10player-game.js

# Check logs for phase awareness
grep "PHASE:" game.log
grep "MAFIA CHAT\|DOCTOR ACTION\|SHERIFF INVESTIGATION" game.log
```

---

## Related Documentation

- [`ai-prompting-enhancement.md`](./ai-prompting-enhancement.md) - Detailed implementation spec
- [`multi-role-coordination.md`](./multi-role-coordination.md) - Coordination system spec
- [`role-mechanics.md`](./role-mechanics.md) - Role behavior definitions
- [`game-flow.md`](./game-flow.md) - Phase flow overview

---

## Quick Checklist

Before testing:

- [ ] Phase instructions added to `getPhaseInstructions()`
- [ ] Multi-role filtering fixed with `playerHasRole()`
- [ ] Sheriff investigation shows all roles
- [ ] Phase-specific prompts include role-specific guidance

After testing:

- [ ] JSON parse rate improved to >80%
- [ ] Models respond appropriately for each phase
- [ ] Multi-role players show correct behavior
- [ ] Sheriff investigations reveal all roles

Future implementation:

- [ ] Multi-doctor coordination
- [ ] Multi-sheriff coordination
- [ ] Multi-vigilante coordination
