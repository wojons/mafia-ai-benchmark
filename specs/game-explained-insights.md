# Mafia Game Insights from `game-explained.md`

**Summary**: Key insights for AI-driven Mafia game implementation
**Source**: `specs/game-explained.md` - "The Architecture of Deception: A Comprehensive Analysis of the Social Deduction Game 'Mafia'"

---

## Core Game Principles (Must Preserve)

### 1. Information Asymmetry is THE Core Mechanic

**Fundamental Conflict**:

- **Informed Minority (Mafia)**: Shared private communication, complete roster awareness
- **Uninformed Majority (Town)**: Atomized isolation, only knows own role

**Strategic Resources**:
| Faction | Strategic Resource | Disadvantage |
|---------|-------------------|--------------|
| Mafia | Coordination and knowledge | Voting minority |
| Town | Voting sovereignty (majority) | Lack of accurate data |

**AI Implementation Implications**:

- ✅ Mafia AI must work as a cooperative team (we do this with MAFIA chat and CONSENSUS)
- ✅ Town AI must aggregate fragmented, noisy data (we do this with evidence system)
- ✅ Mafia generates "noise" to hide signal (AI randomness in chat helps)
- ✅ Town practices "signal extraction" (investigation, pattern recognition)

---

### 2. Phase Structure is Sacred

**Night Phase (Minority's Turn)**:

- Perfect information execution for Mafia
- Town is "asleep" (blind)
- Mafia selects deterministic kill target
- Creates pressure and generates data point (victim identity)

**Day Phase (Majority's Turn)**:

- Information processing, social negotiation, democratic action
- All players participate (including deceivers)
- Transforms social behavior into game data
- Lynch is Town's only weapon

**AI Status**:

- ✅ NIGHT 1: Mafia Team Chat (coordination)
- ✅ NIGHT 1: Mafia Consensus (target selection)
- ✅ NIGHT 2: Doctor Action (intervention)
- ✅ NIGHT 3: Sheriff Investigation (information gathering)
- ✅ NIGHT 4: Vigilante Action (town-aligned power)
- ✅ DAY 1: Discussion (data generation)
- ✅ DAY 2: Voting (democratic action)

**Assessment**: ✅ Phase structure implemented correctly per specs

---

### 3. Win Conditions Drive Urgency

**Mathematical Tipping Points**:

- **Town Victory**: Eliminate ALL Mafia members (absolute condition)
- **Mafia Victory**: Achieve numerical parity (e.g., 2 Mafia vs 2 Town)

**Game Theory Insight**:

- In a 10-player game (3 Mafia, 7 Town), Town has limited "mistakes" before parity
- Every mis-lynch accelerates Town toward defeat
- This mathematical reality underpins tension of every decision

**AI Implementation**:

```javascript
// Our win condition checks (correctly implemented):
if (aliveMafia.length === 0) {
  console.log("TOWN WINS! All mafia eliminated!");
}

if (aliveMafia.length >= aliveTown) {
  console.log("MAFIA WINS! Mafia controls the town!");
}
```

**Strategic AI Priority Calculations**:

- ✅ Sheriff prioritizes investigating Mafia (score: 100)
- ✅ Doctor prioritizes protecting Sheriff (score: 99)
- ✅ Mafia prioritizes killing Sheriff (score: 98)

**Assessment**: ✅ Win conditions and strategic priorities align with game theory

---

### 4. The "Square Root Rule" (Game Theory)

**Mathematical Balance**:

- Optimal Mafia count: $M \approx \sqrt{R}$ (square root of total players)
- For 12 players: $\sqrt{12} \approx 3.46$ → 3 Mafia members

**Implications**:
| Scenario | Probability |
|----------|-------------|
| $M > \sqrt{R}$ | Mafia likely to win even with random play |
| $M < \sqrt{R}$ | Town statistically favored |

**Our Role Distribution**:

```javascript
// From game-engine.js calculateRoles():
const roles = [];
roles.push("MAFIA", "DOCTOR", "SHERIFF"); // Base: 1 Mafia, 2 specials

if (numPlayers >= 6) {
  roles.push("VIGILANTE");
}

// Add more mafia: roughly 1 mafia per 4 players
const totalMafia = Math.floor(numPlayers / 4);
while (roles.filter((r) => r === "MAFIA").length < totalMafia) {
  roles.push("MAFIA");
}
```

**Comparison**:
| Players | Square Root Rule | Our Implementation | Match? |
|---------|------------------|-------------------|--------|
| 5 | $\sqrt{5} \approx 2.2$ → 2 Mafia | 1 Mafia | No (⚠️) |
| 10 | $\sqrt{10} \approx 3.2$ → 3 Mafia | 2-3 Mafia | ✅ (close) |
| 12 | $\sqrt{12} \approx 3.5$ → 3 Mafia | 3 Mafia | ✅ |

**Note**: We use `numPlayers / 4` which is close to square root. For 10 players: $10/4 = 2.5$ vs $\sqrt{10} = 3.2$.

**Potential Adjustment**: Consider using `Math.floor(Math.sqrt(numPlayers) + 0.5)` instead.

---

### 5. Information Roles Shift Equilibrium

**Critical Insight**: Even a single Cop (Sheriff) changes game so dramatically that Mafia needs linear count (not $\sqrt{R}$) to maintain fairness.

**Dominant Strategy**: "Follow the Cop" with Doctor protection creates deterministic Town win.

**Game Designer Solution**: Introduce "sanity" mechanics to reintroduce noise:

- Insane Cop (reversed results)
- Naive Cop (finds everyone innocent)
- Godfather (appears innocent to Cop)

**Our Implementation**:

- ✅ Sheriff (Cop) with investigation ability
- ✅ Doctor (Protector) for Sheriff
- ✅ Multi-role support (Sheriff + Mafia conflicts)

**Status**: ⚠️ We should consider adding sanity mechanics or other counter-roles for advanced play.

---

## Psychological Dynamics (AI Behavior Guidance)

### 1. Paranoia and Erosion of Trust

**Mechanic**: Game systematically dismantles social trust by incentivizing deception

**AI Manifestation**:

- Mafia AI: Create paranoia by accusing random targets, flooding with noise
- Town AI: Constantly re-evaluate mental models based on new evidence (cognitive dissonance)

**Current Implementation**:

- ✅ Evidence system tracks suspects for each player
- ✅ AI players update beliefs during day discussion
- ⚠️ Could enhance with explicit paranoia modeling

---

### 2. Signal vs. Noise

**Town's Goal**: Improve sensitivity ($d'$), filter for "hard tells" (voting patterns, timing, contradictions)

**Mafia's Goal**: Increase noise-to-signal ratio (fluffing, chaotic voting, random accusations)

**Current AI Behavior**:

- ✅ Mafia chat creates strategic discussion (signal)
- ✅ Strategic AI calculates priorities (reduces noise)
- ✅ Evidence system filters meaningful data

**Opportunity**: Add "fluffing" as a deliberate Mafia tactic in prompts

---

### 3. Deception Styles

### The "Fluffer" (High-Volume, Low-Content)

**In Mafia Chat**:

```javascript
// Current: Strategic discussion
// Future: Add occasional fluff for noise
if (Math.random() > 0.8) {
  // Fluffing: "I think we need to be careful..."
}
```

### The "Appeal to Emotion" (AtE)

**In Day/Voting Phase**:

```javascript
// Could add to prompts: "You can express emotion (concern, frustration) deflect accusations"
```

---

## Fun Factor Design Principles

### 1. Ludonarrative Harmony

**Definition**: Gameplay mechanics align with story

**Application**:

- ✅ Mafia chat is genuinely strategic
- ✅ Sheriff investigations provide real information
- ✅ Voting has real stakes
- ✅ Role conflicts create genuine tension

**Assessment**: ✅ Achieved through authentic mechanics

---

### 2. "Sanctioned Psychopathy"

**Definition**: Safe space to experiment with lying, manipulation, betrayal

**AI Implementation**:

- ✅ Multi-role conflicts (Sheriff + Mafia, Doctor + Mafia) create authentic betrayal scenarios
- ✅ Mafia team coordination enables strategic deception
- ✅ Day discussion allows social engineering

**Design Goal**: AI deception should feel clever, not malicious or toxic

---

### 3. "Losing is Fun"

**Paradox**: Players enjoy being eliminated dramatic betrayals

**Implication for AI**:

- Mafia AI should aim for dramatic moments (not just efficient kills)
- Betrayals should be memorable
- Stories should emerge naturally

**Current Status**:

- ✅ Bussing mechanic (Mafia voting for teammates) available via persuasion
- ⚠️ Could enhance "narrative quality" of AI behavior

---

## Advanced Mafia Tactics (AI Should Learn)

### 1. Bussing (Strategic Sacrifice)

**Definition**: Mafia deliberately votes to kill teammate for social capital

**Current Implementation**:

```javascript
// In NIGHT phase - Mafia Persuasion:
const gameState = {
  phase: "MAFIA_PERSUADE",
  previousPhaseData: `Mafia votes so far: ${votes}. ${persuader.name} is trying to convince others...`,
};

// AI MIGHT argue for bussing teammates
// However, our strategic AI prioritizes strategic targets
```

**Status**: ⚠️ Available through persuasion, but not explicitly taught to AI

---

### 2. Vote Splitting (Prevent Consensus)

**Definition**: Mafia splits Town's suspicion between innocent targets to secure No Lynch

**Our Implementation**:

```javascript
// In DAY voting phase, players vote independently
// This NATURALLY creates vote splitting
```

**Status**: ✅ Emergent behavior from independent voting

---

## Design Flaws to Avoid

### 1. Player Elimination (Spectator Sport)

**Problem**: Classic Mafia eliminates players who must watch passively

**Modern Solutions**:

- Blood on the Clocktower (ghosts vote)
- Among Us (ghosts do tasks)

**Our Implementation**:

- ❌ Dead players are fully eliminated (spectator sport)
- ✅ Dead players can still read game logs
- ⚠️ Could consider "ghost chat" or "spectator voting"

---

### 2. "Solved" Game States

**Problem**: Cop + Doctor = deterministic Town win

**Our Counter-Measures**:

- ✅ Multi-role conflicts (Sheriff + Mafia breaks deterministic detection)
- ✅ Vigilante adds chaos
- ✅ Mafia consensus creates uncertainty

**Status**: ❌ Could add sanity mechanics (insane sheriff, godfather) for advanced modes

---

## Implementation Checklist

Based on `game-explained.md`, our implementation status:

| Core Principle            | Status | Notes                            |
| ------------------------- | ------ | -------------------------------- |
| Information Asymmetry     | ✅     | Mafia chat, evidence system      |
| Night Phase Structure     | ✅     | All roles implemented            |
| Day Phase Structure       | ✅     | Discussion + Voting              |
| Win Conditions (parity)   | ✅     | Correctly implemented            |
| Square Root Balance       | ⚠️     | Close, but could be closer to √n |
| Cop (Sheriff) Role        | ✅     | Implemented                      |
| Protector (Doctor) Role   | ✅     | Implemented                      |
| Strategic Priorities      | ✅     | AI calculates priorities         |
| Multi-Role Support        | ✅     | Creates conflicts                |
| Ludonarrative Harmony     | ✅     | Mechanics match story            |
| "Sanctioned Psychopathy"  | ✅     | Deception enabled                |
| Bussing Tactic            | ⚠️     | Emergent, not taught             |
| Vote Splitting            | ✅     | Emergent from voting             |
| Ghost/Death Interactivity | ❌     | Dead players passive             |
| Sanity Mechanics          | ❌     | Not yet implemented              |

---

## Recommendations

### Priority 1 (Immediate)

1. **Consider role count adjustment**: Use `Math.floor(Math.sqrt(numPlayers) + 0.5)` for Mafia balance
2. **Enhance Mafia prompts**: Add explicit encouragement of "noise" tactics and emotional manipulation
3. **Add "fluffing" mechanic**: 20% chance of Mafia using high-volume, low-content chat

### Priority 2 (Short-Term)

4. **Consider ghost interactivity**: Allow dead players to observe and potentially influence (limited)
5. **Add sanity mechanics**: Insane Sheriff, Godfather that appears innocent
6. **Teach bussing tactic**: Add specific prompt guidance for strategic sacrifice

### Priority 3 (Long-Term)

7. **Narrative quality metrics**: Track interesting moments / dramatic reversals
8. **Personality-driven deception**: Different personas use different deception styles
9. **Dynamic difficulty**: Adjust role counts based on player performance

---

## Conclusion

Our current implementation **strongly aligns** with the core principles outlined in `game-explained.md`:

✅ **Correctly Implemented**:

- Information asymmetry via role mechanics and private communication
- Phase structure (Night: perfect info, Day: social negotiation)
- Win conditions (elimination vs parity)
- Strategic priorities based on role importance
- Multi-role conflicts creating authentic tension
- Ludonarrative harmony (mechanics = story)

⚠️ **Opportunities**:

- Fine-tune Mafia count (closer to square root rule)
- Enhance Mafia "noise" tactics (fluffing, emotional manipulation)
- Teach advanced tactics (bussing)
- Add ghost interactivity
- Add sanity mechanics for replayability

❌ **Missing**:

- Ghost/spectator interactivity
- Sanity roles (advanced variants)
- Narrative quality tracking

Overall, our implementation **respects the fundamental mechanics** of Mafia as a "simulation of information warfare" between an informed minority and uninformed majority. The game should feel authentic and provide the core "social deduction" experience described in the research.
