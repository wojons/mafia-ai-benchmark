# Session Summary: Learning from `game-explained.md`

**Date**: 2025-12-30
**Purpose**: Deep understanding of Mafia game mechanics for AI implementation
**Mode**: ULTRATHINK (comprehensive analysis and application)

---

## What We Learned

### 1. **Information Asymmetry is THE Core Mechanic**

**Fundamental Conflict**:

- **Mafia**: Informed minority with shared communication and complete knowledge
- **Town**: Uninformed majority with fragmented, noisy information

**Implication for AI**:

- Mafia AI must cooperate actively (we do this via MAFIA_CHAT and CONSENSUS)
- Town AI must aggregate noisy data (we do this via evidence system)
- Mafia AI should generate "noise" to hide signal
- Town AI should practice "signal extraction"

**Status**: ✅ Correctly implemented

---

### 2. **Game Theory: Square Root Rule**

**Mathematical Balance**:

- Optimal Mafia count: $M \approx \sqrt{R}$ (square root of total players)
- 12 players: 3 Mafia (community standard aligns with math)

**Our Current Implementation**:

```javascript
const totalMafia = Math.floor(numPlayers / 4); // Linear, not square root
```

**Comparison**:
| Players | Square Root | Current | Diff |
|---------|-------------|---------|------|
| 5 | 2 | 1 | -1 (⚠️) |
| 10 | 3 | 2-3 | ~0 (✅) |
| 12 | 3 | 3 | 0 (✅) |

**Recommendation**: Consider `Math.floor(Math.sqrt(numPlayers) + 0.5)` for better balance

---

### 3. **Information Roles Shift Equilibrium**

**Critical Insight**:

- Even a single Cop (Sheriff) dramatically changes game balance
- "Follow the Cop" + Doctor = deterministic Town win

**Game Designer Solution**:

- Sanity mechanics (Insane Cop, Naive Cop)
- Counter-roles (Godfather appears innocent)

**Our Status**:

- ✅ Sheriff + Doctor implemented
- ✅ Multi-role conflicts create non-deterministic play
- ⚠️ Sanity mechanics not yet implemented

---

### 4. **Win Conditions Drive Urgency**

**Mathematical Tipping Points**:

- **Town wins**: Eliminate ALL Mafia (absolute condition)
- **Mafia wins**: Achieve numerical parity (e.g., 2 Mafia vs 2 Town)

**Our Implementation**:

```javascript
if (aliveMafia.length === 0) {
  // TOWN WINS
}
if (aliveMafia.length >= aliveTown) {
  // MAFIA WINS
}
```

**Status**: ✅ Correctly implemented

---

### 5. **Psychological Dynamics**

### Paranoia and Erosion of Trust

- Game systematically dismantles trust
- Town suffers cognitive dissonance (constantly revising mental models)
- Mafia suffers less dissonance but must maintain fabrication

### Signal vs. Noise

- **Mafia**: Increase noise-to-signal ratio (fluffing, chaotic voting)
- **Town**: Improve sensitivity, filter for "hard tells" (voting patterns, contradictions)

**Our Implementation**:

- ✅ Evidence system filters meaningful data
- ✅ Strategic AI prioritizes targets
- ⚠️ Could add explicit "noise" tactics for Mafia

---

### 6. **Fun Factor Design Principles**

### Ludonarrative Harmony

**Definition**: Mechanics align with story

**Our Status**: ✅ Achieved - Mafia chat is strategic, investigations provide real info, voting has stakes

### "Sanctioned Psychopathy"

**Definition**: Safe space to experiment with lying, manipulation

**Our Status**: ✅ Multi-role conflicts create authentic betrayal scenarios

### "Losing is Fun"

**Insight**: Dramatic betrayals create memorable stories

**Our Status**: ✅ Bussing available via persuasion

---

### 7. **Advanced Mafia Tactics**

### Bussing (Strategic Sacrifice)

**Definition**: Mafia votes to kill teammate for social capital

**Cost**: Lose team member
**Benefit**: Survivor gains "Town Cred" and survives to endgame

**Our Status**: ⚠️ Available through persuasion, but not explicitly taught

### Vote Splitting

**Definition**: Split Town's suspicion to secure No Lynch

**Our Status**: ✅ Emergent behavior from independent voting

---

### 8. **Design Problems**

### Player Elimination (Spectator Sport)

**Problem**: Dead players must watch passively
**Modern Solutions**: Ghosts vote, ghosts do tasks

**Our Status**: ❌ Dead players are passive spectators

### "Solved" Game States

**Problem**: Cop + Doctor = deterministic Town win
**Solution**: Sanity mechanics, Godfather

**Our Status**: ⚠️ Multi-role conflicts help, but sanity mechanics not implemented

---

## What Did We Do Wrong

### 1. **Mafia Count Uses Linear Math Instead of Square Root**

**Problem**:

```javascript
const totalMafia = Math.floor(numPlayers / 4); // 10 players → 2 Mafia
// Math.sqrt(10) ≈ 3.2 → should be 3
```

**Impact**: 10-player games may be slightly Mafia-weak

**Fix**: Consider `Math.floor(Math.sqrt(numPlayers) + 0.5)`

---

### 2. **Dead Players Are Passive**

**Problem**: Once a player is killed, they can't do anything

**Design Flaw**: Creates boring "spectator sport"

**Modern Standards**: Ghosts vote (Blood on the Clocktower), ghosts do tasks (Among Us)

**Potential Fix**: Allow dead players to observe and vote (limited or advisory)

---

### 3. **Mafia Deception Too "Clean"**

**Problem**: Mafia AI focuses on efficient kill targeting

**Missing Tactics**:

- "Fluffing": High-volume, low-content chat
- "Appeal to Emotion": Deflect accusations with emotional manipulation
- "Vote Splitting": Deliberately split town's suspicion

**Opportunity**: Enhance Mafia prompts to include these tactics

---

## What Did We Do Right

### 1. **Phase Structure is Sacred**

**Night Phase**: ✅ Perfect information execution for Mafia

- Mafia Team Chat (coordination)
- Mafia Consensus (target selection)
- Doctor Action (intervention)
- Sheriff Investigation (information)
- Vigilante Action (town power)

**Day Phase**: ✅ Information processing and social negotiation

- Discussion (data generation)
- Voting (democratic action)

---

### 2. **Information Asymmetry Preserved**

- ✅ Mafia has private communication channel
- ✅ Town has fragmented evidence system
- ✅ Sheriff generates information
- ✅ Multi-role conflicts create authentic tension

---

### 3. **Strategic Priorities Align with Game Theory**

**Current Priority Calculations**:

- Sheriff investigating Mafia: Score 100
- Doctor protecting Sheriff: Score 99
- Mafia killing Sheriff: Score 98

This aligns with game theory: eliminating information roles is highest priority

---

### 4. **Multi-Role Conflicts Create Non-Deterministic Play**

**Conflicts Implemented**:

- ✅ Sheriff + Mafia (the mole)
- ✅ Doctor + Mafia (unexplained save)
- ✅ Vigilante + Mafia (conflicted assassin)
- ✅ Sheriff + Doctor (powerful town duo)

These conflicts break "solved" game states like "Follow the Cop"

---

### 5. **Structured Outputs & Configurable Models**

**Just Completed**:

- ✅ PlayerModelConfig integration
- ✅ JSON schema system per phase
- ✅ OpenAI structured outputs
- ✅ Environment variable configuration
- ✅ Increased max_tokens to 800
- ✅ Removed hardcoded models

This aligns with the goal of creating a flexible, maintainable system

---

## Action Items

### Priority 1 (Immediate)

1. **Read `game-explained.md` thoroughly** ✅ COMPLETE
2. **Update memory bank with game theory insights**
3. **Spec out role count adjustment** (square root rule)
4. **Enhance Mafia prompts** with "noise" tactics

### Priority 2 (Short-Term)

5. **Specify ghost interactivity**: Allow dead players to observe and vote
6. **Teach bussing tactic**: Add explicit guidance in Mafia prompts
7. **Add sanity mechanics** for advanced modes

### Priority 3 (Long-Term)

8. **Implement narrative quality metrics**: Track dramatic moments
9. **Personality-driven deception**: Different personas = different styles
10. **Dynamic difficulty**: Adjust role counts based on performance

---

## Files Created

1. **`specs/game-explained-insights.md`** - Comprehensive analysis and implementation checklist

---

## Recommended Reading

For future implementation work, always reference `specs/game-explained.md` to ensure alignment with:

- **Core mechanics** (information asymmetry, phase structure)
- **Game theory** (square root rule, role impact)
- **Psychological dynamics** (paranoia, signal detection)
- **Fun factor principles** (ludonarrative harmony, sanctioned psychopathy)
- **Design problems** (elimination, solved states)

---

## Final Assessment

**Strengths**:

- ✅ Core mechanics correctly implemented
- ✅ Phase structure sacred and preserved
- ✅ Information asymmetry via role mechanics
- ✅ Multi-role conflicts create authentic tension
- ✅ Flexible configuration via environment variables
- ✅ Structured outputs ensure reliable AI responses

**Opportunities**:

- ⚠️ Fine-tune Mafia count (square root rule)
- ⚠️ Enhance Mafia "noise" tactics
- ⚠️ Add ghost interactivity
- ⚠️ Add sanity mechanics

**Avoid**:

- ❌ Don't break phase structure for convenience
- ❌ Don't remove information asymmetry (gives Town too much power)
- ❌ Don't make win conditions too easy (removes tension)
- ❌ Don't eliminate "fun frustration" (some stress is good)

---

## Next Steps

1. **Continue testing** structured outputs implementation
2. **Apply game theory insights** to AI behavior tuning
3. **Consider role count adjustment** for better balance
4. **Document** what was learned in memory bank

---

**Previous Session**: "Structured Output & Configurable Models"
**Next Session**: "Apply Game Theory Insights to AI Behavior"
