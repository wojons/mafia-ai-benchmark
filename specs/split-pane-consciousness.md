# Split-Pane Consciousness System
## Core Architecture for Private Reasoning and Public Statements

## Overview

This document defines the **split-pane consciousness** architecture that enables AI agents to have:
- **Private reasoning** (THINK) - Internal monologue visible only to admin/observers
- **Public statements** (SAYS) - External statements visible to all players
- **Strategic deception** - Agents can lie in SAYS while reasoning truthfully in THINK
- **Evidence accumulation** - Agents build cases through observation and analysis
- **Behavioral tracking** - System tracks voting patterns, accusations, and defenses

---

## 1. Core Concept: Dual-Stream Architecture

### 1.1 Think Stream (Private)

The **THINK** stream represents an agent's true reasoning process. It's visible only to:
- Admin/observers
- Players in "postmortem" mode (after game ends)

**Think Stream Properties:**
```
VISIBILITY: Admin only (or postmortem)
CONTENT: True beliefs, private knowledge, reasoning
TIMING: Updated before actions and during analysis
STORAGE: Permanent record for replay
PURPOSE: Understand agent's actual decision-making
```

### 1.2 Says Stream (Public)

The **SAYS** stream represents what an agent communicates to other players. It can contain:
- Truthful information (for town)
- Deliberate lies (for mafia)
- Strategic ambiguity
- Role claims (true or false)

**Say Stream Properties:**
```
VISIBILITY: All players during game
CONTENT: Public statements, accusations, defenses
TIMING: During discussion phases
STORAGE: Permanent record for replay
PURPOSE: Enable social deduction gameplay
```

### 1.3 The "Insane" Part

The unique mechanic is that agents will **actively lie in public while reasoning privately**. This creates:

```
Agent: "I think Player X is suspicious"  (SAYS - to the group)
Agent: "Actually, I think Player X is town, but I want to redirect suspicion"  (THINK - private)
```

This split enables:
- Mafia deception without breaking character
- Town deduction from inconsistencies
- Deep strategic gameplay

---

## 2. Think Stream Specifications

### 2.1 Think Content Types

Agents generate different types of private thoughts:

```typescript
interface ThinkContent {
  type: 'observation' | 'deduction' | 'strategy' | 'fear' | 'plan';
  target?: string;  // Player being analyzed
  confidence: number;  // 0-100%
  evidence: string[];
  reasoning: string;
  timestamp: number;
}
```

**Observation Thoughts:**
```
"I notice Player X voted late and changed their vote at the last minute"
"Player Y defended Player Z very aggressively"
"Player W has been quiet for 2 rounds"
"Player V asked probing questions about night actions"
```

**Deduction Thoughts:**
```
"If Player X is mafia, then Player Y must be town (they accused each other)"
"The sheriff's claim checks out with the voting patterns"
"Player Z's defense doesn't match what we know"
"Someone is lying about their night alibi"
```

**Strategy Thoughts:**
"I should vote for Player X to appear active without being too aggressive"
"If I defend my teammate too strongly, it will look suspicious"
"I need to create doubt about Player Y without directly accusing them"
"The doctor is likely protecting Player Z based on the targeting pattern"

**Fear Thoughts:**
"If Player X is the sheriff, I'm in trouble"
"Mafia might target me next if I keep pushing this accusation"
"I need to be careful not to reveal too much"
"Player Y is getting too close to the truth"

**Plan Thoughts:**
"Tonight, we should kill Player X and protect Player Y"
"I'll wait until the last minute to reveal my sheriff results"
"I'll create a distraction by accusing Player W"
"I should abstain from this vote to see how others react"

### 2.2 Think Stream Timing

THINK updates occur at these points:

1. **Before Night Actions**
   - Mafia: Coordinate kill target
   - Doctor: Decide protection target
   - Sheriff: Decide investigation target
   - Vigilante: Decide whether/when to shoot

2. **Before Public Statements**
   - Plan what to say
   - Consider how to frame statements
   - Decide what to reveal/hide

3. **After Major Events**
   - Reactions to deaths
   - Responses to accusations
   - Analysis of voting results

4. **Before Voting**
   - Decide vote target
   - Consider abstention strategy
   - Plan vote timing

### 2.3 Think Stream Example (Mafia Agent)

```json
{
  "agentId": "player-2",
  "role": "mafia",
  "thinkStream": [
    {
      "type": "observation",
      "content": "Player 5 (sheriff) asked very specific questions about night actions",
      "target": "player-5",
      "confidence": 75,
      "evidence": ["Detailed questions about timing", "Asked about protection targets"],
      "reasoning": "Sheriffs typically investigate through questioning"
    },
    {
      "type": "strategy",
      "content": "We need to kill the sheriff tonight. Player 5 is too dangerous.",
      "target": "player-5",
      "confidence": 90,
      "reasoning": "Sheriff's questioning pattern suggests investigation"
    },
    {
      "type": "plan",
      "content": "In my public statement, I'll redirect suspicion onto Player 7 instead",
      "confidence": 100,
      "reasoning": "Player 7 has been quiet, good target for false accusation"
    }
  ]
}
```

---

## 3. Say Stream Specifications

### 3.1 Say Content Types

Agents generate public statements in these categories:

```typescript
interface SayContent {
  type: 'general' | 'accusation' | 'defense' | 'claim' | 'question' | 'analysis';
  targets?: string[];  // Players mentioned
  evidence?: string;  // Basis for statement
  confidence: number;  // 0-100% (internal only)
  isRoleClaim: boolean;
  claimedRole?: string;
}
```

**General Statements:**
"I've been watching everyone carefully"
"I haven't seen anything conclusive yet"
"We need more information before making decisions"

**Accusations:**
"Player X has been acting suspicious"
"I think Player Y might be mafia"
"Player Z's defense doesn't add up"

**Defenses:**
"I'm just a villager trying to help"
"Why are you targeting me? I have no information"
"I've been consistent in my voting"

**Role Claims:**
"I'm the sheriff" (could be true or false)
"I protected Player X last night" (could be true or false)
"I'm the vigilante and I have a shot" (could be true or false)

**Questions:**
"Why did Player X vote that way?"
"Can anyone confirm where Player Y was during night?"
"What's your reasoning for that accusation?"

**Analysis:**
"The voting patterns suggest Player X is coordinating with someone"
"The timing of that accusation is suspicious"
"Someone is trying to create a bandwagon"

### 3.2 Say Stream Constraints

```typescript
interface SayConstraints {
  minLength: string;  // "1 sentence"
  maxLength: string;  // "5 sentences"  
  target: string;  // "2-3 sentences"
  statementsPerTurn: number;  // 1
  claimsAllowed: boolean;  // true
  maxRoleClaims: number;  // 1 per game (unless revealed)
}
```

### 3.3 Say Stream Example (Mafia Agent)

```json
{
  "agentId": "player-2",
  "role": "mafia",
  "sayStream": [
    {
      "type": "accusation",
      "content": "I've been watching Player 7 closely and they've been very quiet. That feels suspicious to me.",
      "targets": ["player-7"],
      "confidence": 0,  // Public shows no confidence
      "isRoleClaim": false
    },
    {
      "type": "defense", 
      "content": "I think we should focus on Player 7. I've been trying to gather information but haven't found anything conclusive on anyone else.",
      "targets": ["player-7"],
      "confidence": 0,
      "isRoleClaim": false
    }
  ]
}
```

---

## 4. Evidence and Case Building System

### 4.1 Evidence Types

Agents collect different types of evidence:

```typescript
interface Evidence {
  id: string;
  type: 'voting' | 'statement' | 'behavior' | 'timing' | 'investigation' | 'reveal';
  source: string;  // Who provided this evidence
  target: string;  // Who the evidence is about
  content: string;  // What the evidence shows
  timestamp: number;
  confidence: number;  // How reliable is this evidence
  verifiable: boolean;  // Can this be independently verified?
}
```

**Voting Evidence:**
```
"Player X voted for Player Y on Day 2"
"Player X changed their vote at the last minute"
"Player X voted early and consistently"
"Player X abstained when the wagon was forming"
```

**Statement Evidence:**
```
"Player X said Player Y is suspicious but provided no evidence"
"Player X's story about their night activities changed"
"Player X made a claim they couldn't have known"
"Player X contradicted their earlier statement"
```

**Behavior Evidence:**
```
"Player X defended Player Y very aggressively"
"Player X asked very specific questions about night actions"
"Player X has been quiet and might be hiding"
"Player X is trying to create a bandwagon on Player Y"
```

**Timing Evidence:**
```
"Player X made their accusation right after Player Y defended themselves"
"Player X waited until the last minute to vote"
"Player X revealed their role at a suspiciously convenient time"
"Player X pushed for a quick lynch without discussion"
```

**Investigation Evidence:**
```
"Sheriff investigated Player X: MAFIA"
"Sheriff investigated Player X: NOT MAFIA"
"Sheriff's investigation results align with voting patterns"
"Sheriff's claims don't match known facts"
```

### 4.2 Case Building

Agents build "cases" against players:

```typescript
interface Case {
  target: string;
  prosecutor: string;
  evidence: string[];  // Evidence IDs
  narrative: string;  // Story connecting the evidence
  confidence: number;  // 0-100%
  status: 'building' | 'presented' | 'validated' | 'refuted';
  createdAt: number;
  updatedAt: number;
}
```

**Case Example:**
```json
{
  "target": "player-5",
  "prosecutor": "player-2",
  "evidence": ["vote-15", "statement-23", "timing-7"],
  "narrative": "Player 5 has been aggressively pushing to lynch Player 7 without evidence. Their voting pattern shows they consistently target quiet players. The timing of their accusation right after Player 7 defended themselves suggests they're trying to eliminate a potential sheriff. This pattern is consistent with mafia behavior.",
  "confidence": 65,
  "status": "presented"
}
```

### 4.3 Evidence Analysis

Agents analyze evidence to form conclusions:

```typescript
interface EvidenceAnalysis {
  player: string;
  suspicionScore: number;  // 0-100
  townLikelihood: number;  // 0-100
  mafiaLikelihood: number;  // 0-100
  keyEvidence: string[];  // Most important evidence
  contradictions: string[];  // Evidence that doesn't fit
  recommendations: string[];  // Suggested actions
}
```

---

## 5. Behavioral Analysis System

### 5.1 Behavior Tracking

The system tracks player behaviors:

```typescript
interface BehaviorProfile {
  playerId: string;
  
  votingBehavior: {
    averageVoteTime: number;  // Early/mid/late
    voteChanges: number;  // How often they change votes
    targetPatterns: string[];  // Who they vote for
    bandwagoning: number;  // 0-100 (tendency to join wagons)
    leadership: number;  // 0-100 (tendency to start wagons)
  };
  
  communicationBehavior: {
    statementFrequency: number;  // Statements per turn
    accusationRate: number;  // Accusations per statement
    defenseRate: number;  // Defenses per accusation received
    questionAsking: number;  // Questions asked
    informationSharing: number;  // Helpful info provided
  };
  
  roleBehavior: {
    claimTiming: number;  // When they claim (early/mid/late)
    claimAccuracy: number;  // 0-100 (if claims are true)
    protectionSeeking: number;  // 0-100 (seeks protection)
    leadershipEmergence: number;  // 0-100 (takes charge)
  };
  
  consistencyScore: number;  // 0-100 (consistency over time)
  reliabilityScore: number;  // 0-100 (reliability of statements)
}
```

### 5.2 Behavior Patterns

The system identifies behavior patterns:

```typescript
interface BehaviorPattern {
  name: string;
  description: string;
  indicators: string[];
  mafiaIndicators: string[];
  townIndicators: string[];
}
```

**Example Patterns:**

1. **"Voting with the Wagon"**
   ```
   Indicators: Consistently votes with majority, rarely initiates
   Mafia Indicator: High (blending in)
   Town Indicator: Medium (following consensus)
   ```

2. **"Aggressive Accuser"**
   ```
   Indicators: Frequently accuses others, pushes for lynches
   Mafia Indicator: Medium (trying to eliminate town)
   Town Indicator: High (trying to find mafia)
   ```

3. **"Quiet but Deadly"**
   ```
   Indicators: Speaks rarely, votes strategically
   Mafia Indicator: High (hiding in plain sight)
   Town Indicator: Medium (cautious player)
   ```

4. **"Role Claim Specialist"**
   ```
   Indicators: Frequently claims roles, timing is convenient
   Mafia Indicator: High (fake claims)
   Town Indicator: Low (town rarely claims falsely)
   ```

### 5.3 Suspicion Scoring

The system calculates suspicion scores:

```typescript
interface SuspicionScore {
  playerId: string;
  score: number;  // 0-100
  breakdown: {
    votingAnomalies: number;
    statementInconsistencies: number;
    behaviorPatterns: number;
    timingRedFlags: number;
    evidenceAgainst: number;
  };
  trend: 'increasing' | 'stable' | 'decreasing';
  lastUpdated: number;
}
```

---

## 6. Mafia Coordination System

### 6.1 Private Mafia Chat

Mafia agents have a private communication channel:

```typescript
interface MafiaPrivateChat {
  gameId: string;
  mafiaTeam: string[];  // Mafia player IDs
  messages: Array<{
    sender: string;
    content: string;
    timestamp: number;
    type: 'coordination' | 'information' | 'strategy' | 'emergency';
  }>;
}
```

**Mafia Message Types:**

**Coordination:**
```
"Let's target Player X tonight"
"Who should we kill? I think Player Y is dangerous"
"We need to align our public statements"
"Should we bus one of our teammates?"
```

**Information:**
```
"Player X asked probing questions about night actions"
"Player Y defended Player Z very strongly"
"Player W is acting like the sheriff"
"The sheriff is investigating someone tonight"
```

**Strategy:**
"Let's create confusion by accusing Player X"
"We should all vote for Player Y to look innocent"
"I'll lead the accusation, you all follow"
"Let's wait before making any moves"
```

**Emergency:**
"We're about to be caught, need to act fast"
"Player X is about to be lynched, should we defend?"
"Sheriff just revealed, we need to eliminate them"
"Hold off on the kill, I'm creating a distraction"

### 6.2 Mafia Decision Making

Mafia teams make decisions through discussion:

```typescript
interface MafiaDecision {
  type: 'kill' | 'protect' | 'defend' | 'discredit' | 'bus';
  target: string;
  reasoning: string;
  votes: Map<string, boolean>;  // Team member votes
  consensus: boolean;
  timeline: 'immediate' | 'tonight' | 'tomorrow';
}
```

**Example Mafia Decision:**
```json
{
  "type": "kill",
  "target": "player-5",
  "reasoning": "Player 5 is acting like sheriff - asking specific questions, pushing for information. Too dangerous to leave alive.",
  "votes": {
    "player-2": true,
    "player-7": true,
    "player-9": true
  },
  "consensus": true,
  "timeline": "tonight"
}
```

### 6.3 Mafia Busing Strategy

Mafia may sacrifice teammates strategically:

```typescript
interface MafiaBusingStrategy {
  teammateToBus: string;
  reason: string;
  timing: string;
  publicNarrative: string;
  teamVote: Map<string, boolean>;
}
```

**Busing Considerations:**
- Is the teammate about to be lynched anyway?
- Will bussing build credibility?
- Is the teammate expendable?
- Does this help redirect suspicion?

---

## 7. Special Role Mechanics

### 7.1 Doctor Strategy System

Doctors make protection decisions:

```typescript
interface DoctorDecision {
  target: string;
  reasoning: string;
  selfProtectionRisk: number;  // 0-100
  priorityTarget: boolean;
  protectionHistory: string[];  // Players protected before
}
```

**Doctor Decision Factors:**
```
1. Sheriff Protection
   - If sheriff has revealed, protect them
   - If sheriff is suspected, protect them
   
2. Town Leader Protection  
   - Protect players who are gathering good information
   - Protect players who are coordinating town well
   
3. Self Protection
   - Protect self if suspicion > 60%
   - Protect self if about to be lynched
   
4. Pattern Variation
   - Don't protect same player twice in a row
   - Vary protection to avoid being identified
```

### 7.2 Sheriff Investigation System

Sheriffs investigate and reveal strategically:

```typescript
interface SheriffDecision {
  target: string;
  reasoning: string;
  revealTiming: 'immediate' | 'late' | 'last_minute' | 'never';
  claimTiming: 'immediate' | 'delayed' | 'forced';
  evidenceToShare: string[];
}
```

**Sheriff Investigation Factors:**
```
1. Investigation Priority
   - Investigate suspicious voting patterns
   - Investigate aggressive accusers
   - Investigate quiet players
   - Investigate those defending mafia
   
2. Revelation Strategy
   - Immediate: Found mafia early, high impact
   - Late: Have multiple confirmed clears
   - Last Minute: Swing close votes
   - Never: No useful information, or too risky
   
3. Claim Considerations
   - Claim if about to be lynched
   - Claim if information can end game
   - Claim to protect confirmed town
   - Don't claim if mafia would target immediately
```

### 7.3 Vigilante Shot System

Vigilantes decide when to shoot:

```typescript
interface VigilanteDecision {
  action: 'shoot' | 'wait';
  target?: string;
  confidence: number;  // 0-100%
  reasoning: string;
  shotHistory: Array<{
    night: number;
    target: string;
    result: string;
  }>;
}
```

**Vigilante Decision Framework:**

```
FACTORS TO CONSIDER:

1. Confidence Level:
   < 50%: Definitely wait
   50-70%: Need more information
   70-85%: Reasonable risk
   85%+: High confidence

2. Game Timing:
   Night 1-2: Early game, low info, high risk (>85% only)
   Night 3-4: Mid game, some info, moderate risk (>70%)
   Night 5+: Late game, high info, take shot if >60%

3. Sheriff Information:
   - Sheriff confirmed mafia? Consider shooting them
   - Sheriff dead? Less information available
   
4. Mafia Count:
   - 3 mafia left: High urgency
   - 2 mafia left: Moderate urgency
   - 1 mafia left: Endgame shot

DECISION MATRIX:

Confidence  | Early Game  | Mid Game  | Late Game
> 90%      | SHOOT       | SHOOT     | SHOOT
70-90%     | WAIT        | SHOOT     | SHOOT
50-70%     | WAIT        | WAIT      | SHOOT
< 50%      | WAIT        | WAIT      | WAIT
```

---

## 8. Public Statement Generation

### 8.1 Statement Planning

Agents plan public statements based on their private reasoning:

```typescript
interface StatementPlan {
  content: string;
  type: 'general' | 'accusation' | 'defense' | 'claim' | 'question';
  targets: string[];
  evidenceToReference: string[];
  liesToTell: string[];  // For mafia
  truthsToReveal: string[];
  alignmentWithThink: boolean;  // Does SAYS align with THINK?
  riskLevel: 'low' | 'medium' | 'high';
  expectedReaction: string;
}
```

### 8.2 Statement Examples

**Mafia Statement (Public):**
```json
{
  "type": "accusation",
  "content": "I've been watching Player X closely and their behavior seems off. They asked very specific questions about night actions and their voting pattern is suspicious.",
  "targets": ["player-x"],
  "alignmentWithThink": false,  // Private reasoning says Player X is town
  "riskLevel": "medium"
}
```

**Mafia Private Reasoning (THINK):**
```json
{
  "type": "deduction",
  "content": "Player X is actually town - they defended me earlier. But accusing them creates confusion and redirects suspicion from our team.",
  "confidence": 100
}
```

**Town Statement (Public):**
```json
{
  "type": "analysis",
  "content": "The voting patterns are interesting. Player X and Player Y always seem to vote together, which could mean they're coordinating or just agreeing.",
  "targets": ["player-x", "player-y"],
  "alignmentWithThink": true,  // Private reasoning matches public statement
  "riskLevel": "low"
}
```

---

## 9. Vote Strategy System

### 9.1 Vote Decision Factors

Agents consider multiple factors when voting:

```typescript
interface VoteDecision {
  target: string | null;  // null = abstain
  reasoning: string;
  confidence: number;  // 0-100%
  evidence: string[];
  caseBuilt: string;  // Case ID if they've built one
  timing: 'early' | 'mid' | 'late';
  bandwagonRisk: number;  // Risk of following crowd
}

interface VoteDecisionFactors {
  evidenceStrength: number;  // How strong is the case?
  sheriffInformation: number;  // Does sheriff's info support this?
  behavioralAnalysis: number;  // Does behavior support this?
  voteHistory: number;  // Is this consistent with history?
  consensusTiming: number;  // Is everyone voting for this person?
  selfPreservation: number;  // Am I at risk if I vote differently?
}
```

### 9.2 Vote Timing Strategy

**Early Voting:**
```
Advantages:
- Shows leadership
- Sets the agenda
- Can start a wagon

Disadvantages:
- Less information
- Can't read the room
- Might be wrong
```

**Mid Voting:**
```
Advantages:
- Some information available
- Can adjust based on others
- Still has impact

Disadvantages:
- Might seem wishy-washy
- Could miss the window
```

**Late Voting:**
```
Advantages:
- Maximum information
- Can swing close votes
- Last-minute reveals available

Disadvantages:
- Might look suspicious
- Could run out of time
- Missed opportunity for leadership
```

### 9.3 Abstention Strategy

Agents may abstain from voting:

```typescript
interface AbstentionDecision {
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  expectedPerception: string;
  strategy: string;
}
```

**Abstention Reasons:**
```
1. No clear target
   - "I don't have enough information to vote confidently"
   
2. Protecting self
   - "If I vote for the wrong person, I'll be targeted next"
   
3. Gathering information
   - "I want to see how others vote before deciding"
   
4. Strategic positioning
   - "If I abstain, I can see who the real targets are"
```

---

## 10. Integration with FSM

### 10.1 State Machine Events

The split-pane consciousness integrates with the FSM:

```typescript
interface SplitPaneFSMEvents {
  // Night Phase
  NIGHT_START: {
    trigger: FSM transition to NIGHT_ACTIONS
    agentAction: Generate THINK about night strategy
    mafiaAction: Begin private coordination
  };
  
  NIGHT_ACTION: {
    trigger: Agent submits action
    agentAction: Generate THINK + SAYS (if claiming role)
    systemAction: Record action in event log
  };
  
  // Day Phase  
  DAY_START: {
    trigger: FSM transition to DAY_DISCUSSION
    agentAction: Generate THINK about public strategy
    systemAction: Enable public statements
  };
  
  PUBLIC_STATEMENT: {
    trigger: Agent submits statement
    agentAction: Generate THINK (planning) + SAYS (public)
    systemAction: Broadcast to all players
  };
  
  VOTE_START: {
    trigger: FSM transition to DAY_VOTING
    agentAction: Generate THINK about vote decision
    systemAction: Enable voting
  };
  
  VOTE_SUBMIT: {
    trigger: Agent submits vote
    agentAction: Generate THINK + VOTE action
    systemAction: Record vote, update counts
  };
}
```

### 10.2 Event Logging

All split-pane content is logged:

```typescript
interface SplitPaneEventLog {
  gameId: string;
  events: Array<{
    sequence: number;
    timestamp: number;
    phase: string;
    playerId: string;
    thinkContent?: string;  // Private, admin only
    sayContent?: string;    // Public
    action?: string;        // Night action or vote
    evidence?: string[];    // Evidence referenced
    caseId?: string;        // Case built
  }>;
}
```

---

## 11. Implementation Requirements

### 11.1 Data Structures

**Agent Memory:**
```
- Think stream history (private)
- Say stream history (public)  
- Evidence collected
- Cases built
- Behavior profiles
- Suspicion scores
```

**Game State:**
```
- Split-pane enabled: boolean
- Admin view mode: 'think' | 'say' | 'both'
- Public view permissions
- Evidence database
- Case database
- Behavior profiles
```

### 11.2 API Endpoints

```
GET  /api/games/:id/think-stream      // Admin only
GET  /api/games/:id/say-stream        // Public
GET  /api/games/:id/evidence          // Public
GET  /api/games/:id/cases             // Public
GET  /api/games/:id/behavior/:player  // Public
GET  /api/games/:id/suspicion/:player // Public
```

### 11.3 WebSocket Events

```
EVENT: AGENT_THINK_STREAM  // Admin only
EVENT: AGENT_SAY_STREAM    // Public
EVENT: EVIDENCE_COLLECTED  // Public
EVENT: CASE_BUILT          // Public
EVENT: BEHAVIOR_UPDATE     // Public
EVENT: SUSPICION_UPDATE    // Public
```

---

## 12. Example Game Flow

### 12.1 Night Phase with Split-Pane

```
NIGHT 1:

Mafia Team (Private Chat):
├── Player 2: "I think we should target Player X. They were vocal yesterday."
├── Player 7: "Good idea. Player X could lead town against us."
├── Player 9: "Agreed. Let's lock it in."
└── [MAFIA_KILL: Player X]

Doctor (Private Reasoning):
├── THINK: "Who should I protect? No one died last night, so no clear target. 
│          Player Y seems to be gathering information - could be sheriff. 
│          But protecting them might be too obvious. 
│          Maybe protect myself to seem like a regular villager."
└── [DOCTOR_PROTECT: Player Y]

Sheriff (Private Reasoning):
├── THINK: "Who should I investigate? Player Z has been quiet - might be hiding.
│          But quiet players could also just be cautious. 
│          Player W asked good questions about voting patterns - suspicious.
│          Let's investigate Player W."
└── [SHERIFF_INVESTIGATE: Player W]
```

### 12.2 Day Phase with Split-Pane

```
DAY 1 - Player 5 (Sheriff) Public Statement:

THINK (Private):
"Sheriff investigated Player W: NOT MAFIA. That's useful information. 
Should I reveal now? The timing might be suspicious if I reveal immediately. 
Maybe wait until there's an accusation against someone I can counter."

SAYS (Public):
"I've been observing everyone's behavior carefully. The voting patterns 
are telling - some people are very quick to push lynches without evidence. 
We need to be careful about following bandwagons too quickly."

[SAYS broadcast to all players]
```

### 12.3 Vote Phase with Split-Pane

```
DAY 1 - Voting:

Player 2 (Mafia) Vote Decision:

THINK (Private):
"I need to vote for someone. Player X is dead, so can't vote for them. 
Player Y might be sheriff (defended me too strongly). 
Player Z has been quiet. Let's vote for Player Z to blend in, 
but not too enthusiastically."

SAYS (Public):
"Voting for Player Z. They've been quiet and might be hiding something."

VOTE: Player Z
```

---

## 13. Summary

The **split-pane consciousness system** creates sophisticated AI behavior by:

1. **Separating private reasoning from public statements**
2. **Enabling strategic deception for mafia**
3. **Allowing town to build cases through evidence**
4. **Tracking behavioral patterns**
5. **Coordinating mafia strategy privately**
6. **Making voting strategic based on analysis**
7. **Creating depth through dual-stream architecture**

This system enables the complex social dynamics seen in the YouTube video - agents that:
- Think privately while speaking publicly
- Build cases and present evidence
- Coordinate strategies without being detected
- Defend themselves when accused
- Reveal roles at strategic moments
- Create confusion and misdirection
- Make strategic voting decisions

The result is a deeply engaging social deduction game where AI agents demonstrate genuine strategic depth.
