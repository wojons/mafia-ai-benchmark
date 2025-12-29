# Multiple Same-Role Player Coordination Spec

**Status**: PLANNED
**Created**: 2025-12-30
**Priority**: Medium
**Dependencies**: Phase-specific prompts (in progress)

---

## Overview

When multiple players have the same role (e.g., 2 doctors, 2 sheriffs, 2+ vigilantes), they should coordinate their actions to:

1. Avoid redundant actions (duplicate investigations/protections)
2. Maximize strategic impact
3. Prevent friendly fire (especially for vigilantes)
4. Enhance role-based gameplay depth

---

## Problem Statement

### Current Behavior

```javascript
// Each doctor acts independently
if (aliveDoctor.length > 0) {
  for (const doctor of aliveDoctor) {
    // Each doctor makes independent decision
    const gameState = { phase: "DOCTOR_ACTION", ... };
    const response = await this.getAIResponse(doctor, gameState);
    // May result in double-protection or no protection
  }
}
```

### Issues

1. **Double Protection**: Two doctors might protect the same player (wasted action)
2. **No Coverage**: Both doctors might protect different but low-priority players
3. **Duplicate Investigation**: Two sheriffs investigating the same target
4. **Friendly Fire**: Two vigilantes shooting each other's targets chaotically

---

## Solution Architecture

### General Coordination Pattern

For each multi-role action:

1. **Step 1**: Coordination Chat (role-specific private discussion)
2. **Step 2**: Consensus/Assignment (agree on targets/actions)
3. **Step 3**: Execute (all players perform agreed-upon actions)

---

## 1. Multi-Doctor Coordination

### Current Implementation

```javascript
// Each doctor acts independently (line 3228-3372)
if (aliveDoctor.length > 0) {
  for (const doctor of aliveDoctor) {
    const response = await this.getAIResponse(doctor, gameState);
    doctor.nightTarget = target;
  }
  this.lastDoctorProtection = aliveDoctor[0]?.nightTarget?.id;
}
```

### Proposed Implementation

```javascript
// Coordination-based implementation
if (aliveDoctor.length > 1) {
  console.log(E.DOCTOR + "STEP 2: DOCTOR COORDINATION");
  console.log("-".repeat(50));
  console.log(`💉 Doctors active: ${aliveDoctor.map(d => d.name).join(", ")}`);

  // STEP 2A: Doctor Team Chat (3 messages)
  const doctorMessages = [];
  for (let msg = 0; msg < 3; msg++) {
    for (const doctor of aliveDoctor) {
      const gameState = {
        round: this.round,
        phase: "DOCTOR_COORDINATION",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData:
          `Doctor discussion so far:\n` +
          doctorMessages.map(m => `  - ${m.player}: ${m.says}`).join("\n"),
        coordinationTeam: aliveDoctor.map(d => ({
          id: d.id,
          name: d.name,
          roles: this.getPlayerRoles(d),
        })),
        protectionPriorities: /* calculate shared priorities */,
      };

      const response = await this.getAIResponse(doctor, gameState);
      console.log(`[Doctor Chat ${msg + 1}/3] ${doctor.name}:`);
      console.log(`  ${E.THINK} THINK: ${response.think}`);
      console.log(`  ${E.SAYS} SAYS: "${response.says}"`);

      doctorMessages.push({ player: doctor.name, says: response.says });
      // Add delay
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // STEP 2B: Doctor Consensus/Assignment
  const protectionVotes = {};
  for (const doctor of aliveDoctor) {
    const gameState = {
      round: this.round,
      phase: "DOCTOR_PROTECTION_VOTE",
      alivePlayers,
      deadPlayers: this.deadPlayers,
      previousPhaseData:
        `Doctor chat complete. Time to agree on protection targets.\n\n` +
        `CURRENT VOTES: ${Object.entries(protectionVotes).map(([id, count]) => {
          const p = alivePlayers.find(ap => ap.id === id);
          return `${p?.name}: ${count}`;
        }).join(", ")}`,
    };

    const response = await this.getAIResponse(doctor, gameState);
    const targetName = response.action?.target || /* fallback */;
    const target = alivePlayers.find(p =>
      p.name.toLowerCase().includes(targetName.toLowerCase())
    );

    protectionVotes[target.id] = (protectionVotes[target.id] || 0) + 1;
    doctor.nightTarget = target;

    console.log(`${doctor.name} proposes to protect: ${target.name}`);
  }

  // STEP 2C: Resolve Consensus (majority wins)
  let maxVotes = 0;
  let consensusTarget = null;
  for (const [targetId, votes] of Object.entries(protectionVotes)) {
    if (votes > maxVotes) {
      maxVotes = votes;
      consensusTarget = alivePlayers.find(p => p.id === targetId);
    }
  }

  console.log(
    E.DOCTOR + ` DOCTOR CONSENSUS: Protect ${consensusTarget.name} (${maxVotes}/${aliveDoctor.length} votes)\n`
  );

  // All doctors use consensus target
  for (const doctor of aliveDoctor) {
    doctor.nightTarget = consensusTarget;

    this.gameEvents.push(
      createGameEvent(
        gameId,
        this.round,
        "DOCTOR_ACTION",
        doctor,
        "ACTION",
        "ADMIN_ONLY",
        {
          targetId: consensusTarget.id,
          targetName: consensusTarget.name,
          coordination: true,
          consensusVotes: protectionVotes,
        },
      ),
    );
  }

  this.lastDoctorProtection = consensusTarget?.id;

} else if (aliveDoctor.length === 1) {
  // Single doctor acts alone (existing code)
  const doctor = aliveDoctor[0];
  // ... existing single-doctor logic
}
```

### Coordination Prompts

**DOCTOR_COORDINATION Phase**:

```javascript
case "DOCTOR_COORDINATION":
  return `
## 🌙 PHASE: DOCTOR COORDINATION
You are in a PRIVATE CHAT with other doctors.

- You are a DOCTOR with the ability to protect players
- Coordinate with your fellow doctors on who to protect tonight
- Discuss strategic priorities (shared below)
- Try to reach consensus on protection targets
- You can each only protect ONE player, so coordinate wisely

DOCTOR TEAM: ${coordinationTeam.map(d => d.name).join(", ")}

SHARED PROTECTION PRIORITIES:
${protectionPriorities.map((p, i) =>
  `${i + 1}. ${p.player.name} (${p.player.role}) - Score: ${p.score}
  Reasons: ${p.reasons.join(", ")}`
).join("\n")}

Output: {"think": "your reasoning", "says": "your message to the team"}
`.trim();
```

**DOCTOR_PROTECTION_VOTE Phase**:

```javascript
case "DOCTOR_PROTECTION_VOTE":
  return `
## 🌙 PHASE: DOCTOR PROTECTION VOTE
Time to vote for who to protect.

PROTECTION CONSTRAINTS:
- You CANNOT protect the same player two nights in a row (unless night 1)
- Multiple doctors should coordinate (ideally agree on target)
${coordinationMessage ? `\n${coordinationMessage}` : ""}

PRIORITIES: ${protectionPriorities.map(p => p.player.name).join(", ")}

Output: {"action": {"target": "Player Name", "reasoning": "your reason"}, "think": "...", "says": "..."}
`.trim();
```

---

## 2. Multi-Sheriff Coordination

### Proposed Implementation

```javascript
if (aliveSheriff.length > 1) {
  console.log(E.SHERIFF + "STEP 3: SHERIFF COORDINATION");
  console.log("-".repeat(50));
  console.log(
    `👮 Sheriffs active: ${aliveSheriff.map((s) => s.name).join(", ")}`,
  );

  // STEP 3A: Sheriff Coordination (brief)
  const sheriffMessages = [];
  for (let msg = 0; msg < 2; msg++) {
    for (const sheriff of aliveSheriff) {
      const gameState = {
        round: this.round,
        phase: "SHERIFF_COORDINATION",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData:
          `Sheriff discussion:\n` +
          sheriffMessages.map((m) => `  - ${m.player}: ${m.says}`).join("\n"),
        coordinationTeam: aliveSheriff.map((s) => ({
          id: s.id,
          name: s.name,
          roles: this.getPlayerRoles(s),
        })),
        investigationHistory: this.sheriffInvestigations || {},
      };

      const response = await this.getAIResponse(sheriff, gameState);
      console.log(`[Sheriff Chat ${msg + 1}/2] ${sheriff.name}:`);
      console.log(`  ${E.THINK} THINK: ${response.think}`);
      console.log(`  ${E.SAYS} SAYS: "${response.says}"`);

      sheriffMessages.push({ player: sheriff.name, says: response.says });
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // STEP 3B: Assign Investigation Targets (avoid duplicates)
  const assignedTargets = new Set();
  for (const sheriff of aliveSheriff) {
    // Calculate priorities excluding already-assigned targets
    const investigationPriorities = this.calculateSheriffInvestigationPriority(
      alivePlayers.filter((p) => !assignedTargets.has(p.id)),
      sheriff.id,
      { votingHistory: this.votingHistory || [] },
    );

    const gameState = {
      round: this.round,
      phase: "SHERIFF_INVESTIGATION_ASSIGNMENT",
      alivePlayers,
      deadPlayers: this.deadPlayers,
      previousPhaseData:
        `Sheriff coordination complete.\n\n` +
        `ALREADY ASSIGNED: ${
          Array.from(assignedTargets)
            .map((id) => alivePlayers.find((p) => p.id === id)?.name)
            .filter(Boolean)
            .join(", ") || "None"
        }\n\n` +
        `CHOOSE FROM: ${investigationPriorities
          .slice(0, 3)
          .map((p) => p.player.name)
          .join(", ")}`,
      assignedTargets: Array.from(assignedTargets),
    };

    const response = await this.getAIResponse(sheriff, gameState);
    const targetName =
      response.action?.target || investigationPriorities[0]?.player?.name;
    const target = alivePlayers.find((p) =>
      p.name.toLowerCase().includes(targetName.toLowerCase()),
    );

    assignedTargets.add(target.id);

    console.log(
      `${sheriff.emoji} ${sheriff.name} assigns investigation: ${target.name}`,
    );

    const investigationResult = this.formatPlayerRoles(target);
    console.log(
      `  ${E.SHERIFF} 🔍 INVESTIGATES: ${target.name} -> ${investigationResult}\n`,
    );

    if (!this.sheriffInvestigations) {
      this.sheriffInvestigations = {};
    }
    this.sheriffInvestigations[target.id] = {
      day: this.dayNumber,
      round: this.round,
      result: investigationResult,
      targetRoles: this.getPlayerRoles(target),
      investigator: sheriff.name,
    };

    this.gameEvents.push(
      createGameEvent(
        gameId,
        this.round,
        "SHERIFF_INVESTIGATION",
        sheriff,
        "ACTION",
        "ADMIN_ONLY",
        {
          targetId: target.id,
          targetName: target.name,
          result: investigationResult,
          targetRoles: this.getPlayerRoles(target),
          coordination: true,
        },
      ),
    );

    sheriff.nightTarget = target;
  }

  console.log(
    E.SHERIFF +
      ` Investigations coordinated (${assignedTargets.size} unique targets)\n`,
  );
} else if (aliveSheriff.length === 1) {
  // Single sheriff investigates alone (existing code)
}
```

### Coordination Prompts

**SHERIFF_COORDINATION Phase**:

```javascript
case "SHERIFF_COORDINATION":
  return `
## 🌙 PHASE: SHERIFF COORDINATION
You are in a PRIVATE CHAT with other sheriffs.

- Coordinate investigations to avoid duplicates
- Split high-suspicion targets between sheriffs
- Share investigation history (some targets already investigated)

SHERIFF TEAM: ${coordinationTeam.map(s => s.name).join(", ")}

INVESTIGATION HISTORY:
${Object.entries(investigationHistory).map(([id, info]) => {
  const target = alivePlayers.find(p => p.id === id);
  return `  ${target?.name || "Unknown"}: ${info.result} (Round ${info.round})`;
}).join("\n")}

Output: {"think": "your reasoning", "says": "your message to the team"}
`.trim();
```

**SHERIFF_INVESTIGATION_ASSIGNMENT Phase**:

```javascript
case "SHERIFF_INVESTIGATION_ASSIGNMENT":
  return `
## 🌙 PHASE: SHERIFF INVESTIGATION ASSIGNMENT
Choose a target to investigate.

ALREADY ASSIGNED: ${assignedTargets.map(id =>
  alivePlayers.find(p => p.id === id)?.name
).join(", ") || "None"}

AVAILABLE TARGETS: ${availableTargets.length} players

INVESTIGATION PRIORITIES:
${investigationPriorities.slice(0, 3).map((p, i) =>
  `${i + 1}. ${p.player.name} (${p.player.role}) - Score: ${p.score}
  Reasons: ${p.reasons.join(", ")}`
).join("\n")}

Output: {"action": {"target": "Player Name", "reasoning": "your reason"}, "think": "...", "says": "..."}
`.trim();
```

---

## 3. Multi-Vigilante Coordination

### Proposed Implementation

```javascript
if (aliveVigilante.length > 1 || aliveVigilante.length === 1) {
  console.log(E.VIGILANTE + "STEP 4: VIGILANTE COORDINATION");
  console.log("-".repeat(50));
  console.log(
    `🔫 Vigilantes active: ${aliveVigilante.map((v) => v.name).join(", ")}`,
  );

  // STEP 4A: Vigilante Team Discussion
  const vigilanteMessages = [];
  if (aliveVigilante.length > 1) {
    for (let msg = 0; msg < 2; msg++) {
      for (const vig of aliveVigilante) {
        const gameState = {
          round: this.round,
          phase: "VIGILANTE_COORDINATION",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            `Vigilante discussion:\n` +
            vigilanteMessages
              .map((m) => `  - ${m.player}: ${m.says}`)
              .join("\n"),
          coordinationTeam: aliveVigilante.map((v) => ({
            id: v.id,
            name: v.name,
            roles: this.getPlayerRoles(v),
            shotAvailable:
              !this.vigilanteShotUsed || vig.id !== this.vigilanteFirstShot,
          })),
          sheriffInvestigations: this.sheriffInvestigations || {},
        };

        const response = await this.getAIResponse(vig, gameState);
        console.log(`[Vigilante Chat ${msg + 1}/2] ${vig.name}:`);
        console.log(`  ${E.THINK} THINK: ${response.think}`);
        console.log(`  ${E.SAYS} SAYS: "${response.says}"`);

        vigilanteMessages.push({ player: vig.name, says: response.says });
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  // STEP 4B: Vigilante Shot Decision
  for (const vig of aliveVigilante) {
    // Check if this vigilante still has their shot
    const hasShot =
      !this.vigilanteShotUsed || vig.id !== this.vigilanteFirstShot;

    if (!hasShot) {
      console.log(`${vig.emoji} ${vig.name} (VIGILANTE):`);
      console.log("  " + E.THINK + " THINK: I've already used my shot.");
      console.log("  " + E.SAYS + ' SAYS: "I cannot shoot again."');
      console.log("  " + E.VIGILANTE + " 🚫 PASSES - Shot already used\n");
      continue;
    }

    const gameState = {
      round: this.round,
      phase: "VIGILANTE_ACTION",
      alivePlayers,
      deadPlayers: this.deadPlayers,
      previousPhaseData:
        (aliveVigilante.length > 1
          ? `Vigilante discussion complete.${coordinationMessage ? "\n" + coordinationMessage : ""}`
          : "") +
        "\n\n" +
        "STRATEGIC SHOT DECISION:\n" +
        `${shotDecision.shouldShoot ? "RECOMMENDED: YES" : "RECOMMENDED: NO"}\n` +
        (shotDecision.shouldShoot
          ? `Target: ${shotDecision.target} - Confidence: ${shotDecision.confidence}%`
          : `Reason: ${shotDecision.reasons?.join(", ") || "Insufficient information"}`),
      messageNumber: 1,
      totalMessages: 1,
      shotDecision,
    };

    const response = await this.getAIResponse(vig, gameState);

    const targetName = response.action?.target;
    const shouldShoot = response.action?.shouldShoot && targetName;

    console.log(`${vig.emoji} ${vig.name} (VIGILANTE):`);
    console.log("  " + E.THINK + " THINK: " + response.think);
    console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"');

    if (shouldShoot) {
      const target =
        alivePlayers.find((p) =>
          p.name.toLowerCase().includes(targetName?.toLowerCase()),
        ) || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

      console.log("  " + E.VIGILANTE + " 🔫 SHOOTS: " + target.name + "\n");

      this.vigilanteShotTarget = target;
      this.vigilanteShotUsed = true;
      this.vigilanteFirstShot = vig.id; // Track who shot first

      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "VIGILANTE_ACTION",
          vig,
          "ACTION",
          "ADMIN_ONLY",
          {
            targetId: target.id,
            targetName: target.name,
            coordination: aliveVigilante.length > 1,
          },
        ),
      );
    } else {
      console.log("  " + E.VIGILANTE + " 🚫 PASSES - No shot this night\n");
    }
  }
}
```

### Coordination Prompts

**VIGILANTE_COORDINATION Phase**:

```javascript
case "VIGILANTE_COORDINATION":
  return `
## 🌙 PHASE: VIGILANTE COORDINATION
You are in a PRIVATE CHAT with other vigilantes.

- Coordinate shooting decisions to avoid friendly fire
- Discuss targets and evidence
- Only ONE vigilante should shoot (to save shots for later)
- Agree on who shoots, or all pass

VIGILANTE TEAM: ${coordinationTeam.map(v =>
  `${v.name}${v.shotAvailable ? " (shot available)" : " (shot used)"}`
).join(", ")}

SHERIFF INVESTIGATIONS:
${Object.entries(sheriffInvestigations).map(([id, info]) => {
  const target = alivePlayers.find(p => p.id === id);
  return `  ${target?.name || "Unknown"}: ${info.result} (Round ${info.round})`;
}).join("\n") || "  No investigations yet"}

Output: {"think": "your reasoning", "says": "your message to the team"}
`.trim();
```

---

## Implementation Priority

### Phase 1: Doctor Coordination (Highest Priority)

- Most impactful (prevents waste of protection)
- Relatively simple to implement
- Clear benefit to gameplay

### Phase 2: Sheriff Coordination (Medium Priority)

- Prevents duplicate investigations
- Enhances strategic depth
- Moderate complexity (assign targets rather than vote)

### Phase 3: Vigilante Coordination (Lower Priority)

- Less common (multiple vigilantes rare)
- Higher complexity (track shot usage per vigilante)
- Still valuable for edge cases

---

## Testing Strategy

### Unit Tests

```javascript
describe("Multi-Doctor Coordination", () => {
  test("Doctors reach consensus on protection target", async () => {
    const game = new MafiaGame({ allowMultiRole: true });
    const doctors = [
      { id: "d1", name: "Doc1", roles: ["DOCTOR"] },
      { id: "d2", name: "Doc2", roles: ["DOCTOR"] },
    ];
    const gameState = { phase: "DOCTOR_COORDINATION", ... };

    await game.runDoctorCoordination(doctors, gameState);

    // Both doctors should have same target
    expect(doctors[0].nightTarget.id).toBe(doctors[1].nightTarget.id);
  });

  test("Doctors cannot protect same player twice in a row", async () => {
    // Implementation test
  });
});

describe("Multi-Sheriff Coordination", () => {
  test("Sheriffs split investigation targets", async () => {
    const game = new MafiaGame({ allowMultiRole: true });
    const sheriffs = [
      { id: "s1", name: "Sheriff1", roles: ["SHERIFF"] },
      { id: "s2", name: "Sheriff2", roles: ["SHERIFF"] },
    ];

    await game.runSheriffCoordination(sheriffs, gameState);

    // Different targets
    expect(sheriffs[0].nightTarget.id).not.toBe(sheriffs[1].nightTarget.id);
  });
});
```

### Integration Tests

```javascript
test("Night phase with 2 doctors, 2 sheriffs", async () => {
  const game = new MafiaGame({ allowMultiRole: true });
  await game.startGame(8, [
    "Doc1",
    "Doc2",
    "Sheriff1",
    "Sheriff2",
    "Mafia1",
    "Mafia2",
    "Villager1",
    "Villager2",
  ]);

  // Run night phase
  await game.runNightPhase(game.gameId);

  // Verify coordination results
  // - Doctors have same protection target
  // - Sheriffs have different investigation targets
  // - No duplicates
});
```

---

## Future Enhancements

1. **Adaptive Coordination**:
   - Skip coordination if only 1 player with role
   - Scale conversation length based on team size (2 vs 3+ players)

2. **Strategic Priority Sharing**:
   - Doctors see merged priority lists from all doctors
   - Sheriffs see consolidated suspicious player list

3. **Historical Tracking**:
   - Track coordination success/failure
   - Learn which coordination patterns work best

4. **Multi-Role Special Cases**:
   - Doctor+Mafia in coordination chat needs special handling
   - Sheriff+Mafia sharing information strategically

---

## Related Specs

- [`ai-prompting-enhancement.md`](./ai-prompting-enhancement.md) - Phase-specific prompts
- [`role-mechanics.md`](./role-mechanics.md) - Role behavior definitions
- [`game-flow.md`](./game-flow.md) - Night phase flow
- [`multi-agent-ai-architecture.md`](./multi-agent-ai-architecture.md) - AI agent design

---

## Changelog

### 2025-12-30

- Created spec document
- Defined coordination pattern for multi-doctor
- Defined coordination pattern for multi-sheriff
- Defined coordination pattern for multi-vigilante
- Added implementation priority ordering
- Outlined testing strategy
