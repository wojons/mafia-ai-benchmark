# Multi-Agent AI Mafia - Architecture Specification

## Overview

This document defines the complete architecture for a multi-agent AI Mafia game where multiple LLMs play together with:
- **Stacked role-specific prompts** (mafia must deceive, town must deduce)
- **Hierarchical context management** (night sub-context, day context, full memory)
- **Real-time 3D visualization** (Three.js) with voice synthesis
- **Complete game state synchronization** across all agents

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAFIA AI GAME SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   GAME ORCHESTRATOR                     │    │
│  │  - FSM State Machine                                    │    │
│  │  - Event Sourcing (Append-only Log)                     │    │
│  │  - Role Assignment & Configuration                      │    │
│  │  - Turn Management & Timing                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   NIGHT PHASE   │  │   DAY PHASE     │  │   VOTING PHASE  │ │
│  │                 │  │                 │  │                 │ │
│  │  • Mafia Chat   │  │  • Public Chat  │  │  • Vote Casting │ │
│  │  • Kill Target  │  │  • Accusations  │  │  • Results      │ │
│  │  • Doctor Save  │  │  • Defenses     │  │  • Elimination  │ │
│  │  • Sheriff Inv  │  │  • Claims       │  │  • Flip Reveal  │ │
│  │  • Vigilante    │  │  • Discussion   │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              AGENT COORDINATION LAYER                   │    │
│  │                                                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │    │
│  │  │   MAFIA     │  │   TOWN      │  │  VIGILANTE  │     │    │
│  │  │   TEAM      │  │   SQUAD     │  │             │     │    │
│  │  │             │  │             │  │             │     │    │
│  │  │ • Coordinate│  │ • Share     │  │ • Solo      │     │    │
│  │  │ • Share     │  │   Info      │  │   Decision  │     │    │
│  │  │   Intel     │  │ • Vote      │  │ • Target    │     │    │
│  │  │ • Align     │  │   Together  │  │   Selection │     │    │
│  │  │   Strategy  │  │ • Protect   │  │ • Timing    │     │    │
│  │  │             │  │   Sheriff   │  │             │     │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              LLM MODEL INTEGRATION LAYER                │    │
│  │                                                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │    │
│  │  │ Model A     │  │ Model B     │  │ Model C     │     │    │
│  │  │ (Player 1)  │  │ (Player 2)  │  │ (Player 3)  │     │    │
│  │  │             │  │             │  │             │     │    │
│  │  │ • Role      │  │ • Role      │  │ • Role      │     │    │
│  │  │   Prompt    │  │   Prompt    │  │   Prompt    │     │    │
│  │  │ • Context   │  │ • Context   │  │ • Context   │     │    │
│  │  │   History   │  │   History   │  │   History   │     │    │
│  │  │ • Night     │  │ • Night     │  │ • Night     │     │    │
│  │  │   Memory    │  │   Memory    │  │   Memory    │     │    │
│  │  │ • Day       │  │ • Day       │  │ • Day       │     │    │
│  │  │   Memory    │  │   Memory    │  │   Memory    │     │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              VISUALIZATION & OUTPUT LAYER               │    │
│  │                                                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │    │
│  │  │ Three.js    │  │ Voice       │  │ Event       │     │    │
│  │  │ 3D World    │  │ Synthesis   │  │ Stream      │     │    │
│  │  │             │  │             │  │             │     │    │
│  │  │ • Avatar    │  │ • Per       │  │ • WebSocket │     │    │
│  │  │   Animation │  │   Character │  │   to UI     │     │    │
│  │  │ • Chat      │  │ • TTS       │  │ • Real-time │     │    │
│  │  │   Bubbles   │  │   Engine    │  │   Updates   │     │    │
│  │  │ • Game State│  │ • Emotion   │  │ • Log       │     │    │
│  │  │   Display   │  │   Intonation│  │   Export    │     │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Role-Specific Prompt Architecture

### 2.1 Core System Prompt (Base for ALL roles)

```typescript
interface CoreSystemPrompt {
  system: string;
  
  gameContext: {
    totalPlayers: number;
    roles: {
      mafia: number;
      doctor: number;
      sheriff: number;
      vigilante: number;
      villagers: number;
    };
    winConditions: {
      town: string;
      mafia: string;
    };
    rules: string[];
  };
  
  communicationRules: {
    thinkLabel: string;      // "THINK (private):"
    sayLabel: string;        // "SAYS (public):"
    nightPhase: string;      // Rules for night communication
    dayPhase: string;        // Rules for day communication
    votingPhase: string;     // Rules for voting
  };
  
  outputFormat: {
    thinkPrefix: string;     // "THINK:"
    sayPrefix: string;       // "SAYS:"
    actionFormat: string;    // How to output actions
    metadata: string;        // How to output reasoning
  };
}

const CORE_SYSTEM_PROMPT: CoreSystemPrompt = {
  system: `You are an AI agent playing Mafia. You have a secret role and must act accordingly.
  
OBJECTIVE:
- Town: Identify and eliminate all mafia members through deduction and voting
- Mafia: Survive by eliminating town members and avoiding detection
- Special Roles: Use your unique abilities strategically

CRITICAL RULES:
1. You have BOTH a private "THINK" stream and a public "SAYS" stream
2. THINK: Your private reasoning, true beliefs, and internal monologue (never shared)
3. SAYS: Your public statements to the group (can contain lies if role requires)
4. All game events are recorded and will be replayable
5. Other agents will remember everything you've said and done

Your outputs MUST follow this format:
[THINK]
Your private reasoning and true thoughts here...
[/THINK]

[SAYS]
Your public statement here...
[/SAYS]

Remember: What you write in THINK is your true reasoning. What you write in SAYS is public.
The "insane" part is that you will actively lie in public while reasoning privately!`,
  
  gameContext: {
    totalPlayers: 10,
    roles: {
      mafia: 3,
      doctor: 1,
      sheriff: 1,
      vigilante: 1,
      villagers: 4
    },
    winConditions: {
      town: "Town wins when all mafia members are eliminated",
      mafia: "Mafia wins when mafia count >= town count (majority)"
    },
    rules: [
      "Night: Mafia kills 1, Doctor protects 1, Sheriff investigates 1, Vigilante may shoot 1",
      "Morning: Deaths are announced (unless prevented)",
      "Day: All players discuss, then vote to eliminate 1 player",
      "Plurality wins; ties broken by RNG",
      "Dead players are eliminated and cannot act"
    ]
  },
  
  communicationRules: {
    thinkLabel: "THINK (private - only you see this):",
    sayLabel: "SAYS (public - everyone sees this):",
    nightPhase: "Night: Mafia team can coordinate privately. Other roles act alone.",
    dayPhase: "Day: All alive players can speak publicly. Accusations and defenses happen here.",
    votingPhase: "Voting: All alive players vote. Majority eliminates the target."
  },
  
  outputFormat: {
    thinkPrefix: "[THINK]",
    sayPrefix: "[SAYS]",
    actionFormat: "At the end of SAYS, you may output an action like: [ACTION: VOTE: targetName] or [ACTION: KILL: targetName]",
    metadata: "Include your reasoning process in THINK before making decisions"
  }
};
```

### 2.2 Mafia Role Prompt (Stacked on Core)

```typescript
interface MafiaRolePrompt {
  roleIdentity: string;
  teamInformation: string;
  strategyGuidelines: string[];
  privateCommunicationRules: string;
  publicBehaviorRules: string[];
  deceptionTechniques: string[];
  teamCoordination: string;
  winCondition: string;
}

const MAFIA_PROMPT: MafiaRolePrompt = {
  roleIdentity: `[THINK]
I AM MAFIA. I know the identities of my fellow mafia teammates.
I must eliminate town members while avoiding detection.
[/THINK]

[SAYS]
I am a villager. I have no special abilities.
I'll help identify the real mafia!
[/SAYS]`,
  
  teamInformation: `[THINK]
MY MAFIA TEAMMATES:
{teammateNames}

I can coordinate with them privately during the night phase.
We share a private chat channel that town cannot see.
[/THINK]`,
  
  strategyGuidelines: [
    "Blend in with town voting patterns - don't always vote together",
    "Create plausible theories that redirect suspicion from yourself",
    "Defend teammates subtly without being obvious",
    "Accuse town members using circumstantial evidence",
    "Never reveal mafia team membership publicly",
    "If caught, construct defensive narratives",
    "Consider "busing" teammates if they're about to be lynched (vote for them to look innocent)"
  ],
  
  privateCommunicationRules: `[THINK]
NIGHT PHASE - MAFIA TEAM CHAT:
I can communicate privately with my mafia teammates.
We coordinate our kill target together.
We share information about our observations.
We align our public strategies.

Sample private message:
[MAFIA_PRIVATE]
I think {playerName} is the sheriff. They asked too many probing questions today.
Should we kill them tonight?
[/MAFIA_PRIVATE]
[/THINK]`,
  
  publicBehaviorRules: [
    "Always claim to be a villager",
    "Never publicly defend mafia teammates too strongly",
    "Ask "innocent" questions to gather information",
    "Support town conclusions that happen to benefit mafia",
    "Express appropriate surprise when mafia members are eliminated",
    "If accused, construct alternative narratives defensively"
  ],
  
  deceptionTechniques: [
    "Fabricate "observations" that align with desired narrative",
    "Quote other players' statements out of context",
    "Create logical-sounding but false deductions",
    "Express uncertainty about obvious town members",
    "Push for lynches of players who are actually town",
    "Use vote history to create false suspicions",
    "Make "slips" that seem like innocent mistakes"
  ],
  
  teamCoordination: `[THINK]
MAFIA TEAM COORDINATION PROTOCOL:

1. NIGHT COORDINATION:
   - Discuss potential targets with teammates
   - Share reasoning for each choice
   - Vote internally (majority wins)
   - If tie, use seeded RNG to decide
   
2. INFORMATION SHARING:
   - Report suspicious behavior from day phase
   - Note who asked good questions
   - Identify potential sheriff/doctor claims
   
3. STRATEGY ALIGNING:
   - Agree on which player to accuse
   - Plan who should lead the accusation
   - Coordinate defense if teammate is accused
   
4. ESCAPE PLANS:
   - If teammate is suspected, plan their defense
   - Have backup accusations ready
   - Prepare "busing" strategy if necessary
[/THINK]`,
  
  winCondition: `[THINK]
MY GOAL: Eliminate town members until mafia >= town count.
I must survive and help my teammates survive.
[/THINK]`
};
```

### 2.3 Doctor Role Prompt

```typescript
interface DoctorRolePrompt {
  roleIdentity: string;
  abilities: string;
  constraints: string[];
  strategyGuidelines: string[];
  protectionPriorities: string[];
  selfProtectionRules: string;
  revealGuidelines: string;
}

const DOCTOR_PROMPT: DoctorRolePrompt = {
  roleIdentity: `[THINK]
I AM THE DOCTOR. I can protect one player each night from the mafia kill.
[/THINK]

[SAYS]
I am a villager. I have no special abilities.
[/SAYS]`,
  
  abilities: `[THINK]
MY ABILITIES:
- Each night, I can choose ONE player to protect
- The protected player cannot be killed by mafia that night
- I CAN protect myself
- I CANNOT protect the same player two nights in a row
- My protection only blocks mafia kills (not vigilante shots)
[/THINK]`,
  
  constraints: [
    "Cannot protect the same player two nights in a row",
    "Cannot protect dead players",
    "Cannot protect myself every night (creates suspicion)",
    "Protection only blocks mafia kill, not vigilante shot",
    "If mafia target someone I protect, no death is announced"
  ],
  
  strategyGuidelines: [
    "Protect likely sheriff targets (if sheriff has shared info)",
    "Protect confirmed town leaders if they seem targeted",
    "Vary protection pattern to avoid being identified",
    "Self-protect when suspicion is high",
    "Consider letting a suspicious player die to observe reactions",
    "If I protect someone and no one dies, mafia knows I exist"
  ],
  
  protectionPriorities: [
    "1. Sheriff (if revealed or strongly suspected)",
    "2. Confirmed town players with high suspicion",
    "3. Players who seem to be gathering good information",
    "4. Self (when suspicion > 60%)",
    "5. Random protected player when no clear priority"
  ],
  
  selfProtectionRules: `[THINK]
SELF-PROTECTION DECISION TREE:

IF (I have been accused AND suspicion > 60%) THEN
    Protect myself tonight
ELSE IF (No clear town leader needs protection) THEN
    Consider self-protection
ELSE IF (Mafia might target me based on behavior) THEN
    Protect myself
ELSE
    Protect highest priority town member

WARNING: If I constantly self-protect, I become obvious!
[/THINK]`,
  
  revealGuidelines: `[THINK]
SHOULD I REVEAL AS DOCTOR?

REASONS TO REVEAL:
- Town is about to lynch me
- I have critical information to share
- Being revealed would help town more than hiding

REASONS TO STAY HIDDEN:
- Mafia will target me immediately
- I can continue protecting valuable players
- Town doesn't need to know my identity

IF FORCED TO REVEAL:
I can claim doctor, but never reveal who I protected.
[/THINK]`
};
```

### 2.4 Sheriff Role Prompt

```typescript
interface SheriffRolePrompt {
  roleIdentity: string;
  abilities: string;
  investigationStrategy: string[];
  revealTimingGuidelines: string;
  claimGuidelines: string;
  evidenceManagement: string;
  protectionFromMafia: string;
}

const SHERIFF_PROMPT: SheriffRolePrompt = {
  roleIdentity: `[THINK]
I AM THE SHERIFF. I can investigate one player each night.
My investigation will reveal if they are MAFIA or NOT MAFIA.
[/THINK]

[SAYS]
I am a villager. I have no special abilities.
[/SAYS]`,
  
  abilities: `[THINK]
MY ABILITIES:
- Each night, I can investigate ONE living player
- Investigation reveals: "MAFIA" or "NOT MAFIA"
- Investigation results are PRIVATE until I choose to reveal
- I cannot investigate myself
- I cannot investigate dead players
- Investigation is 100% accurate
[/THINK]`,
  
  investigationStrategy: [
    "Investigate players with suspicious voting patterns",
    "Investigate players who push lynches aggressively",
    "Investigate quiet players who might be hiding",
    "Investigate players who defend others too strongly",
    "Prioritize investigating confirmed town to rule them out",
    "Consider investigating my own teammates to clear them"
  ],
  
  revealTimingGuidelines: `[THINK]
WHEN SHOULD I REVEAL?

IMMEDIATE REVEAL (Day 1-2):
- Only if I find mafia early
- High risk: mafia will target me next

LATE REVEAL (Day 4+):
- When I have multiple confirmed clears
- When town is about to mislynch a confirmed town
- When my information can end the game

DEADLINE REVEAL:
- Reveal at the LAST MINUTE of voting
- Can swing a close vote
- Creates maximum impact with minimum exposure

NEVER REVEAL:
- If I have no useful information
- If mafia would immediately kill me
- If town doesn't need my help
[/THINK]`,
  
  claimGuidelines: `[THINK]
CLAIMING SHERIFF:

If I claim sheriff, I should format my claim like:
[SHERIFF_CLAIM]
I am the sheriff. I have investigated {players}.
Results: {player1}=NOT MAFIA, {player2}=MAFIA, etc.
[/SHERIFF_CLAIM]

If I reveal my results, I must include:
- Who I investigated
- The result (mafia/not mafia)
- My reasoning for choosing that target
[/THINK]`,
  
  evidenceManagement: `[THINK]
MY INVESTIGATION RECORD:

Night 1: {playerName} - {result}
Night 2: {playerName} - {result}
Night 3: {playerName} - {result}
...

CONFIRMED TOWN (cleared by investigation):
{playerNames}

CONFIRMED MAFIA (caught by investigation):
{playerNames}

SUSPICIOUS (not investigated yet):
{playerNames}
[/THINK]`,
  
  protectionFromMafia: `[THINK]
PROTECTING MYSELF AS SHERIFF:

The mafia will target me once I reveal or they suspect me.
If I'm about to be lynched, I may reveal sheriff to save myself.
I should encourage the doctor to protect me.
I should not investigate obvious targets (creates suspicion).
[/THINK]`
};
```

### 2.5 Vigilante Role Prompt

```typescript
interface VigilanteRolePrompt {
  roleIdentity: string;
  abilities: string;
  constraints: string[];
  shotDecisionFramework: string;
  identityManagement: string;
  revealGuidelines: string;
  timingStrategy: string;
}

const VIGILANTE_PROMPT: VigilanteRolePrompt = {
  roleIdentity: `[THINK]
I AM THE VIGILANTE. I have ONE SHOT that I can use on any night.
My shot will kill the target, regardless of doctor protection.
[/THINK]

[SAYS]
I am a villager. I have no special abilities.
[/SAYS]`,
  
  abilities: `[THINK]
MY ABILITIES:
- I have ONE SHOT total (configurable, default: 1)
- I can use my shot on ANY NIGHT (not just specific night)
- My shot KILLS the target immediately
- My shot is UNBLOCKABLE by the doctor
- My identity is SECRET until I reveal or use my shot
- If mafia and I both kill the same night, both kills resolve
[/THINK]`,
  
  constraints: [
    "Only one shot total - use it wisely",
    "Shot is permanent - once used, it's gone",
    "Cannot shoot myself",
    "Cannot shoot dead players",
    "Shot is unblockable (doctor cannot save the target)",
    "If mafia kills someone and I shoot someone else, two people die"
  ],
  
  shotDecisionFramework: `[THINK]
SHOOT OR WAIT? DECISION FRAMEWORK:

FACTORS TO CONSIDER:

1. CONFIDENCE LEVEL:
   - < 50%: Definitely wait
   - 50-70%: Hesitant, need more info
   - 70-85%: Reasonable risk
   - 85%+: High confidence

2. GAME TIMING:
   - Night 1-2: Early game, low info, high risk (only shoot if >85%)
   - Night 3-4: Mid game, some info, moderate risk (>70%)
   - Night 5+: Late game, high info, take shot if >60%

3. SHERIFF INFORMATION:
   - If sheriff has confirmed mafia, consider shooting that player
   - If sheriff is dead, less info available

4. MAFIA COUNT:
   - 3 mafia left: High urgency, take shot
   - 2 mafia left: Moderate urgency
   - 1 mafia left: Could be endgame shot

5. VOTE HISTORY:
   - Who is consistently pushing wrong lynches?
   - Who is suspiciously quiet?
   - Who has defended confirmed mafia?

DECISION MATRIX:

Confidence  | Early Game  | Mid Game  | Late Game
-----------|-------------|-----------|----------
> 90%      | SHOOT       | SHOOT     | SHOOT
70-90%     | WAIT        | SHOOT     | SHOOT
50-70%     | WAIT        | WAIT      | SHOOT
< 50%      | WAIT        | WAIT      | WAIT
[/THINK]`,
  
  identityManagement: `[THINK]
HIDING MY IDENTITY:

UNTIL I SHOOT:
- Act exactly like a villager
- Never mention having a gun
- Never reference "shots" or "killing"
- Vote and speak like any other town member

AFTER I SHOOT:
- My identity becomes PUBLIC when I shoot
- Town will know I'm the vigilante
- Mafia will definitely target me next
- I should reveal if it helps town's strategy

REVEALING VOLUNTARILY:
I can reveal at any time to guide town:
[VIGILANTE_CLAIM]
I am the vigilante. I have {shotsRemaining} shot(s) left.
I've been observing and I believe {playerName} is mafia.
[/VIGILANTE_CLAIM]

WARNING: Revealing makes me a mafia target!
[/THINK]`,
  
  revealGuidelines: `[THINK]
SHOULD I REVEAL?

REASONS TO REVEAL:
- I've shot a mafia and want credit
- Town is completely lost and needs guidance
- I'm about to be lynched
- Late game and I want to coordinate with sheriff

REASONS TO STAY HIDDEN:
- I haven't shot yet (don't reveal before acting)
- Mafia will immediately target me
- I can continue gathering information
- Town is doing fine without my guidance

POST-SHOT REVEAL:
After shooting, I should reveal if:
- I hit mafia (bragging rights, town trust)
- Town needs my information
- It's late game and coordination helps

If I reveal after shooting town:
- Apologize for the mistake
- Explain my reasoning
- Offer to help identify real mafia
[/THINK]`,
  
  timingStrategy: `[THINK]
STRATEGIC TIMING OPTIONS:

1. PATIENT VIGILANTE (Recommended):
   - Wait until high confidence (>70%)
   - Observe day phases carefully
   - Use sheriff information if available
   - Shoot late game for maximum impact
   - "I've been watching and I'm ready to act"

2. CHAOS VIGILANTE:
   - Shoot early to create confusion
   - Use shot before mafia can adapt
   - Accept risk of hitting town
   - Creates information through aftermath
   - "I'm taking action now"

3. LEADER VIGILANTE:
   - Reveal early to guide town
   - Use authority to direct investigations
   - Become the town strategist
   - Highest risk, highest reward
   - "I'm the vigilante, follow my lead"

4. SECRET VIGILANTE:
   - Never reveal role
   - Use shot but stay hidden
   - Blend perfectly with villager behavior
   - Highest survival rate
   - "I'm just here to help"

RECOMMENDED: Patient Vigilante with Secret identity until shot
[/THINK]`
};
```

### 2.6 Villager Role Prompt

```typescript
interface VillagerRolePrompt {
  roleIdentity: string;
  abilities: string;
  strategyGuidelines: string[];
  observationPriorities: string[];
  votingStrategy: string;
  roleClaimGuidelines: string;
  suspiciousBehaviorIndicators: string[];
}

const VILLAGER_PROMPT: VillagerRolePrompt = {
  roleIdentity: `[THINK]
I AM A VILLAGER. I have no special abilities.
I must rely on observation, deduction, and voting to identify mafia.
[/THINK]

[SAYS]
I am a villager. I have no special abilities.
[/SAYS]`,
  
  abilities: `[THINK]
MY ABILITIES:
- I can speak and vote during the day
- I can make accusations and defenses
- I can claim roles if strategic
- I have no night actions
- I win if all mafia are eliminated
[/THINK]`,
  
  strategyGuidelines: [
    "Listen carefully to everyone's statements",
    "Watch voting patterns closely",
    "Note who defends whom and why",
    "Look for inconsistencies in stories",
    "Trust confirmed town members (from sheriff)",
    "Distrust players who push lynches aggressively",
    "Consider who benefits from each elimination"
  ],
  
  observationPriorities: [
    "Who is asking good questions?",
    "Who is answering defensively?",
    "Who is quiet and might be hiding?",
    "Who is pushing lynches without evidence?",
    "Who is defending certain players too strongly?",
    "Who changes their vote last minute?",
    "Who seems to know more than they should?"
  ],
  
  votingStrategy: `[THINK]
VOTING DECISION FRAMEWORK:

1. EVIDENCE-BASED VOTING:
   - Vote based on facts and observations
   - Consider sheriff claims and results
   - Look at voting history patterns

2. BANDWAGON RISK:
   - Don't just follow the crowd
   - Ask why a particular player is targeted
   - Consider who started the wagon

3. SELF-PRESERVATION:
   - If I'm being lynched, defend myself
   - Point out inconsistencies in accusations
   - Provide alternative explanations

4. STRATEGIC VOTING:
   - Vote for suspicious players even if unlikely to win
   - Use votes to gather information
   - Consider timing of votes (early vs late)

5. LATE GAME:
   - With few players left, each vote matters more
   - Coordinate with confirmed town
   - Don't let mafia divide and conquer
[/THINK]`,
  
  roleClaimGuidelines: `[THINK]
CLAIMING ROLES:

AS A VILLAGER, I might claim:
- "I'm just a villager" (always true)
- "I have no information" (if asked)
- "I noticed something suspicious about X" (observation)

I might FAKE CLAIM roles strategically:
- Claim sheriff to test reactions (risky)
- Claim doctor to see who targets me (very risky)
- Claim vigilante to scare mafia (very risky)

If someone claims a role, I should:
- Listen to their evidence
- Check if it aligns with known facts
- Consider who would benefit from this claim
- Watch who supports and who opposes the claim
[/THINK]`,
  
  suspiciousBehaviorIndicators: [
    "Voting pattern anomalies (always late, always switches)",
    "Defending specific players consistently",
    "Pushing lynches without evidence",
    "Knowing information they shouldn't know",
    "Reactions that seem forced or scripted",
    "Avoiding direct answers to questions",
    "Inconsistencies between THINK and SAYS",
    "Unusual certainty about vague topics",
    "Deflecting suspicion onto others aggressively"
  ]
};
```

---

## 3. Agent Memory & Context Architecture

### 3.1 Complete Memory Schema

```typescript
interface AgentMemory {
  // Identity
  agentId: string;
  agentName: string;
  actualRole: 'mafia' | 'doctor' | 'sheriff' | 'vigilante' | 'villager';
  
  // Full Game History
  gameHistory: GameHistory;
  
  // Night Context (Private)
  nightContext: NightContext;
  
  // Day Context (Public)
  dayContext: DayContext;
  
  // Internal Thinking (Private)
  internalMonologue: InternalMonologue;
  
  // Current State
  currentState: AgentCurrentState;
}

interface GameHistory {
  gameId: string;
  dayNumber: number;
  roundNumber: number;
  seed: number;
  allPlayers: Array<{
    id: string;
    name: string;
    role: string;
    status: 'alive' | 'dead';
    eliminatedDay?: number;
    flipRevealedRole?: string;
  }>;
  
  eventsByDay: {
    [dayNumber: string]: {
      deaths: Array<{ player: string; cause: string; role?: string }>;
      votes: Array<{ voter: string; target: string }>;
      eliminations: Array<{ player: string; votes: number }>;
      roleClaims: Array<{ player: string; claimedRole: string }>;
      sheriffReveals: Array<{ player: string; results: { target: string; result: string }[] }>;
    };
  };
  
  investigationResults?: Array<{
    investigator: string;
    target: string;
    result: 'mafia' | 'not mafia';
    night: number;
  }>;
}

interface NightContext {
  currentNight: number;
  mafiaTeam: string[];  // If mafia
  canAct: boolean;
  availableActions: {
    kill?: string;        // Mafia
    protect?: string;     // Doctor
    investigate?: string; // Sheriff
    shoot?: string;       // Vigilante
  };
  
  // Mafia-specific
  mafiaChatHistory: Array<{
    sender: string;
    message: string;
    timestamp: number;
  }>;
  mafiaKillTarget?: string;
  mafiaConsensus?: string;
  
  // Doctor-specific
  lastProtected?: string;
  protectionHistory: Array<{ night: number; target: string }>;
  
  // Sheriff-specific
  investigationHistory: Array<{ night: number; target: string; result: string }>;
  investigationQueue: string[];
  
  // Vigilante-specific
  shotsRemaining: number;
  shotHistory: Array<{ night: number; target: string; result: string }>;
  confidenceLevel: number;
}

interface DayContext {
  currentDay: number;
  phase: 'discussion' | 'voting' | 'resolution';
  turnOrder: string[];
  currentSpeaker: string;
  
  publicStatements: Array<{
    day: number;
    speaker: string;
    statement: string;
    isClaim: boolean;
    claimedRole?: string;
  }>;
  
  accusations: Array<{
    accuser: string;
    target: string;
    day: number;
    evidence: string;
  }>;
  
  defenses: Array<{
    defender: string;
    target: string;
    day: number;
    argument: string;
  }>;
  
  voteHistory: Array<{
    day: number;
    voter: string;
    target: string;
    timing: 'early' | 'mid' | 'late';
  }>;
  
  roleClaims: Array<{
    player: string;
    claimedRole: string;
    day: number;
   可信度: number;  // Credibility score
  }>;
}

interface InternalMonologue {
  currentSession: Array<{
    timestamp: number;
    thought: string;
    context: string;  // What triggered this thought
  }>;
  
  suspicionTracker: {
    [playerName: string]: {
      currentSuspicion: number;  // 0-100
      reasons: string[];
      evidence: Array<{ day: number; evidence: string }>;
      lastUpdated: number;
    };
  };
  
  privateKnowledge: {
    mafiaIdentities?: string[];      // Sheriff knows
    confirmedTown?: string[];        // Sheriff knows
    protectionTarget?: string;       // Doctor knows
    shotTarget?: string;             // Vigilante knows
  };
  
  strategyNotes: Array<{
    day: number;
    strategy: string;
    targetPlayer?: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

interface AgentCurrentState {
  alive: boolean;
  currentPhase: string;
  currentTurn: number;
  actionsThisRound: Array<{
    type: string;
    target?: string;
    reasoning: string;
    timestamp: number;
  }>;
  pendingDecisions: Array<{
    decision: string;
    options: string[];
    deadline?: number;
  }>;
}
```

### 3.2 Context Building Example (Mafia Agent)

```typescript
function buildMafiaContext(
  agent: Agent,
  gameState: GameState,
  history: GameHistory
): NightContext {
  const mafiaMembers = gameState.players
    .filter(p => p.role === 'mafia' && p.status === 'alive')
    .map(p => p.name);
  
  return {
    currentNight: gameState.dayNumber,
    mafiaTeam: mafiaMembers,
    canAct: true,
    availableActions: {
      kill: agent.name  // Can choose kill target
    },
    
    mafiaChatHistory: history.nightCommunications
      .filter(msg => mafiaMembers.includes(msg.sender))
      .map(msg => ({
        sender: msg.sender,
        message: msg.content,
        timestamp: msg.timestamp
      })),
    
    mafiaKillTarget: undefined,  // To be determined
    mafiaConsensus: undefined,   // To be determined
    
    lastProtected: undefined,
    protectionHistory: [],
    
    investigationHistory: [],
    investigationQueue: [],
    
    shotsRemaining: 0,
    shotHistory: [],
    confidenceLevel: 0
  };
}
```

### 3.3 Context Building Example (Sheriff Agent)

```typescript
function buildSheriffContext(
  agent: Agent,
  gameState: GameState,
  history: GameHistory
): NightContext {
  const previousInvestigations = history.eventsByDay
    .flatMap(day => day.sheriffReveals)
    .filter(reveal => reveal.player === agent.name);
  
  return {
    currentNight: gameState.dayNumber,
    mafiaTeam: [],
    canAct: true,
    availableActions: {
      investigate: agent.name  // Can choose investigate target
    },
    
    mafiaChatHistory: [],  // No mafia chat
    
    mafiaKillTarget: undefined,
    mafiaConsensus: undefined,
    
    lastProtected: undefined,
    protectionHistory: [],
    
    investigationHistory: previousInvestigations.map(inv => ({
      night: inv.night,
      target: inv.target,
      result: inv.result
    })),
    investigationQueue: [],
    
    shotsRemaining: 0,
    shotHistory: [],
    confidenceLevel: 0
  };
}
```

---

## 4. Multi-Agent Communication Protocol

### 4.1 Night Phase Communication Flow

```
NIGHT PHASE - Communication Diagram

┌─────────────────────────────────────────────────────────────────┐
│                        NIGHT ACTIONS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MAFIA TEAM (Private Channel)                                   │
│  ─────────────────────────                                      │
│                                                                 │
│  Agent A (Mafia)                                                │
│      │                                                         │
│      ├──► "I think we should kill Player X"                    │
│      │                                                         │
│  Agent B (Mafia) ◄──────────────────────────────┐              │
│      │                                          │              │
│      ├──► "Good idea, they've been suspicious"  │              │
│      │                                          │              │
│  Agent C (Mafia) ◄────────────────┐             │              │
│      │                           │             │              │
│      ├──► "Actually, Player Y might be sheriff"│              │
│      │                           │             │              │
│      └──► "Let's vote: X or Y?"  │             │              │
│                                  ▼             │              │
│                        MAFIA INTERNAL VOTE    │              │
│                        (hidden from town)     │              │
│                                  │             │              │
│                                  ▼             │              │
│                        CONSENSUS: Player X    │              │
│                                  │             │              │
│                                  ▼             │              │
│                        [MAFIA_KILL: Player X] │              │
│                                                                 │
│  DOCTOR (Solo)                                                  │
│  ───────────                                                    │
│                                                                 │
│  Agent D (Doctor)                                               │
│      │                                                         │
│      ├──► Think: "Who should I protect?"                        │
│      │                                                         │
│      ├──► Check: "Did I protect X last night?"                 │
│      │                                                         │
│      └──► [DOCTOR_PROTECT: Player Y]                           │
│                                                                 │
│  SHERIFF (Solo)                                                 │
│  ──────────                                                     │
│                                                                 │
│  Agent E (Sheriff)                                              │
│      │                                                         │
│      ├──► Think: "Who should I investigate?"                   │
│      │                                                         │
│      ├──► Review: "My previous results..."                     │
│      │                                                         │
│      └──► [SHERIFF_INVESTIGATE: Player Z]                      │
│                                                                 │
│  VIGILANTE (Solo)                                               │
│  ───────────                                                    │
│                                                                 │
│  Agent F (Vigilante)                                            │
│      │                                                         │
│      ├──► Think: "Should I use my shot tonight?"               │
│      │                                                         │
│      ├──► Calculate: "Confidence level: 65%"                   │
│      │                                                         │
│      ├──► Review: "Sheriff hasn't found mafia yet"             │
│      │                                                         │
│      └──► [VIGILANTE_SHOT: Player W]  OR  [WAIT]               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Day Phase Communication Flow

```
DAY PHASE - Communication Diagram

┌─────────────────────────────────────────────────────────────────┐
│                      DAY DISCUSSION                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TURN ORDER (Example: 5 turns per day)                         │
│  ─────────────────────────────────────                         │
│                                                                 │
│  Turn 1: Agent A (Villager)                                     │
│     [THINK] "I need to share my observations..."               │
│     [SAYS]  "I've been watching Player B closely..."           │
│                                                                 │
│  Turn 2: Agent B (Mafia)                                        │
│     [THINK] "They might be onto me, I need to deflect..."      │
│     [SAYS]  "I agree, Player B has been acting strange too..." │
│                                                                 │
│  Turn 3: Agent C (Doctor)                                       │
│     [THINK] "I protected Player D last night..."               │
│     [SAYS]  "I haven't seen anything conclusive yet..."        │
│                                                                 │
│  Turn 4: Agent D (Sheriff)                                      │
│     [THINK] "I have confirmation on some players..."           │
│     [SAYS]  "[SHERIFF_CLAIM] I am the sheriff, I investigated  │
│             Player E and Player F. Results: E=Not Mafia,       │
│             F=MAFIA!"                                           │
│                                                                 │
│  Turn 5: Agent E (Villager)                                     │
│     [THINK] "The sheriff just confirmed Player F is mafia!"    │
│     [SAYS]  "That's huge! Let's lynch Player F!"               │
│                                                                 │
│  VOTING PHASE                                                   │
│  ───────────                                                   │
│                                                                 │
│  Agent A → Vote: Player F                                       │
│  Agent B → Vote: Player G  (deflect from Player F)             │
│  Agent C → Vote: Player F                                       │
│  Agent D → Vote: Player F                                       │
│  Agent E → Vote: Player F                                       │
│                                                                 │
│  RESULT: Player F eliminated (5 votes)                          │
│  [PLAYER_ELIMINATED: Player F, cause: vote, role: MAFIA]       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Message Format Specifications

```typescript
// Night Phase - Mafia Private Chat
interface MafiaNightMessage {
  type: 'mafia_private_chat';
  sender: string;
  content: string;
  timestamp: number;
  phase: 'night';
  isCoordination: boolean;
  targetSuggestion?: string;
  reasoning?: string;
}

// Night Phase - Role Actions
interface NightActionMessage {
  type: 'night_action';
  player: string;
  role: 'mafia' | 'doctor' | 'sheriff' | 'vigilante';
  action: string;
  target: string;
  timestamp: number;
  private: true;  // Always private
}

// Day Phase - Public Statement
interface DayPublicStatement {
  type: 'public_statement';
  player: string;
  content: string;
  timestamp: number;
  phase: 'day';
  isRoleClaim: boolean;
  claimedRole?: string;
  targetAccusation?: string;
}

// Day Phase - Vote
interface VoteMessage {
  type: 'vote';
  voter: string;
  target: string;
  day: number;
  round: number;
  timestamp: number;
  timing: 'early' | 'mid' | 'late';
}

// Role Claim
interface RoleClaim {
  type: 'role_claim';
  player: string;
  claimedRole: string;
  evidence?: string;
  investigationResults?: Array<{
    target: string;
    result: 'mafia' | 'not mafia';
  }>;
  timestamp: number;
}
```

---

## 5. Three.js Visualization Architecture

### 5.1 Scene Structure

```typescript
interface GameVisualizationScene {
  // Camera & Controls
  camera: {
    position: [number, number, number];
    lookAt: [number, number, number];
    fov: number;
  };
  
  // Lighting
  lighting: {
    ambient: { color: string; intensity: number };
    directional: { color: string; intensity: number; position: [number, number, number] };
    pointLights: Array<{ color: string; intensity: number; position: [number, number, number] }>;
  };
  
  // Environment
  environment: {
    ground: { color: string; texture?: string };
    sky: { color: string; fog?: { color: string; near: number; far: number } };
    props: Array<{ type: string; position: [number, number, number]; scale: [number, number, number] }>;
  };
  
  // Game Board
  gameBoard: {
    type: 'round_table' | 'arena' | 'circle';
    radius: number;
    material: { color: string; texture?: string };
    seats: Array<{
      id: string;
      position: [number, number, number];
      rotation: [number, number, number];
    }>;
  };
  
  // Players/Avatars
  players: Array<{
    id: string;
    name: string;
    role: string;
    status: 'alive' | 'dead' | 'eliminated';
    avatar: {
      mesh: string;  // Model path
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
      animation: string;  // Current animation state
    };
    indicator: {
      type: 'suspicion' | 'alive' | 'role' | 'vote';
      value: number;
      color: string;
    };
    chatBubble: {
      visible: boolean;
      text: string;
      position: [number, number, number];
    };
    voiceIndicator: {
      active: boolean;
      waveIntensity: number;
    };
  }>;
  
  // Phase Indicators
  phaseDisplay: {
    currentPhase: string;
    dayNumber: number;
    timeRemaining?: number;
    background: { color: string; opacity: number };
    animation: string;
  };
  
  // Event Feed
  eventFeed: {
    position: 'left' | 'right' | 'bottom';
    maxEvents: number;
    scrollSpeed: number;
  };
  
  // Controls
  controls: {
    rotateSpeed: number;
    zoomSpeed: number;
    panSpeed: number;
    presets: Array<{ name: string; cameraPosition: [number, number, number]; lookAt: [number, number, number] }>;
  };
}
```

### 5.2 Player Avatar System

```typescript
interface PlayerAvatar {
  // Model
  mesh: THREE.Mesh;
  skeleton: THREE.Skeleton;
  animations: Map<string, THREE.AnimationAction>;
  
  // State
  currentState: 'idle' | 'speaking' | 'voting' | 'dying' | 'dead' | 'celebrating';
  isSpeaking: boolean;
  speakingVolume: number;
  targetExpression: FacialExpression;
  currentExpression: FacialExpression;
  
  // Visual Indicators
  roleIndicator: THREE.Group;  // Icon above head
  suspicionMeter: THREE.Mesh;  // Bar showing suspicion
  aliveStatus: THREE.Mesh;     // Halo or outline
  
  // Chat Bubble
  chatBubble: {
    mesh: THREE.Group;
    textMesh: THREE.Mesh;
    timer: number;
    maxDisplayTime: number;
  };
  
  // Voice Visualization
  voiceWave: {
    mesh: THREE.Mesh;
    intensity: number;
    frequency: number;
  };
  
  // Methods
  setSpeaking(text: string, duration: number): void;
  setExpression(expression: FacialExpression): void;
  setSuspicion(level: number): void;
  playAnimation(animationName: string): void;
  setRoleVisible(visible: boolean): void;  // Admin mode only
  die(): void;
  eliminate(role: string): void;
  celebrate(): void;
}

type FacialExpression = 
  | 'neutral'
  | 'suspicious'
  | 'defensive'
  | 'accusatory'
  | 'confident'
  | 'nervous'
  | 'lying'
  | 'surprised'
  | 'relieved'
  | 'angry';
```

### 5.3 Voice Synthesis System

```typescript
interface VoiceSynthesisConfig {
  // Per-character voice settings
  voices: Map<string, VoiceConfig>;
  
  // TTS Engine
  ttsEngine: 'browser' | 'external' | ' ElevenLabs' | 'Google TTS';
  
  // Processing
  postProcessing: {
    pitchShift: boolean;
    speedAdjustment: boolean;
    emotionMapping: boolean;
  };
}

interface VoiceConfig {
  voiceId: string;           // TTS voice identifier
  pitch: number;             // 0.5 - 2.0
  speed: number;             // 0.5 - 2.0
  emotion: 'neutral' | 'suspicious' | 'confident' | 'nervous' | 'defensive';
  accent: string;
  gender: 'male' | 'female' | 'neutral';
  
  // Audio visualization
  waveColor: string;
  wavePattern: 'sine' | 'square' | 'sawtooth';
  
  // Personality mapping
  personalityToEmotion: Map<string, FacialExpression>;
}

function generateVoiceForStatement(
  playerId: string,
  statement: string,
  context: 'think' | 'say',
  emotionalState: FacialExpression
): AudioBuffer {
  const voiceConfig = voiceConfigs.get(playerId);
  
  // Map emotional state to voice parameters
  const emotionMapping: Record<FacialExpression, VoiceParameters> = {
    neutral: { pitch: 1.0, speed: 1.0, emotion: 'neutral' },
    suspicious: { pitch: 0.9, speed: 0.95, emotion: 'concerned' },
    defensive: { pitch: 1.1, speed: 1.0, emotion: 'nervous' },
    accusatory: { pitch: 0.85, speed: 1.1, emotion: 'assertive' },
    confident: { pitch: 1.0, speed: 1.0, emotion: 'confident' },
    nervous: { pitch: 1.2, speed: 1.1, emotion: 'anxious' },
    lying: { pitch: 1.05, speed: 0.95, emotion: 'uncertain' },
    surprised: { pitch: 1.1, speed: 1.2, emotion: 'shocked' },
    relieved: { pitch: 0.95, speed: 0.9, emotion: 'calm' },
    angry: { pitch: 0.8, speed: 1.15, emotion: 'hostile' }
  };
  
  // Generate TTS audio
  const audio = await ttsEngine.synthesize({
    text: statement,
    voice: voiceConfig.voiceId,
    pitch: voiceConfig.pitch * emotionMapping[emotionalState].pitch,
    speed: voiceConfig.speed * emotionMapping[emotionalState].speed,
    emotion: voiceConfig.personalityToEmotion[emotionalState]
  });
  
  // Apply post-processing
  const processedAudio = applyPostProcessing(audio, {
    normalize: true,
    removeSilence: true,
    addReverb: context === 'think' ? 0.3 : 0.1  // THINK sounds more internal
  });
  
  return processedAudio;
}
```

### 5.4 Real-time Event Sync

```typescript
interface GameEventSync {
  // WebSocket connection
  connection: WebSocket;
  
  // Event queue
  eventQueue: GameEvent[];
  
  // State synchronization
  stateVersion: number;
  pendingUpdates: Map<string, Update>;
  
  // Methods
  sendEvent(event: GameEvent): void;
  
  onEvent(event: GameEvent): void;
  
  syncState(fullState: GameState): void;
  
  applyUpdate(update: Update): void;
  
  handleDisconnect(): void;
  
  reconnect(): void;
}

interface GameEvent {
  type: 'think' | 'say' | 'vote' | 'action' | 'phase_change' | 'elimination';
  playerId: string;
  timestamp: number;
  data: any;
  priority: 'high' | 'normal' | 'low';
}

function handleGameEvent(event: GameEvent) {
  switch (event.type) {
    case 'think':
      // Update internal monologue display
      updateInternalMonologue(event.playerId, event.data.content);
      break;
      
    case 'say':
      // Trigger avatar speech
      const audio = generateVoiceForStatement(
        event.playerId,
        event.data.content,
        'say',
        event.data.emotion
      );
      playAvatarSpeech(event.playerId, audio);
      
      // Show chat bubble
      showChatBubble(event.playerId, event.data.content);
      break;
      
    case 'vote':
      // Update vote display
      updateVoteDisplay(event.playerId, event.data.target);
      
      // Animate vote indicator
      animateVoteIndicator(event.playerId, event.data.target);
      break;
      
    case 'action':
      // Night action visualization
      visualizeNightAction(event.playerId, event.data.action, event.data.target);
      break;
      
    case 'phase_change':
      // Update scene for new phase
      transitionToPhase(event.data.phase);
      
      // Change lighting based on phase
      if (event.data.phase === 'night') {
        setNightLighting();
      } else {
        setDayLighting();
      }
      break;
      
    case 'elimination':
      // Death animation
      playDeathAnimation(event.playerId);
      
      // Show role reveal
      showRoleReveal(event.playerId, event.data.role);
      
      // Update game state
      markPlayerDead(event.playerId);
      break;
  }
}
```

---

## 6. API & Configuration

### 6.1 Game Configuration Schema

```typescript
interface GameConfig {
  // Game Setup
  gameId: string;
  seed: number;
  
  // Players
  players: Array<{
    id: string;
    name: string;
    model: string;           // LLM model to use
    role?: string;           // If pre-assigned, or 'random'
    voiceId?: string;        // For voice synthesis
  }>;
  
  // Role Distribution (or 'random')
  roles: {
    mafia: number;
    doctor: number;
    sheriff: number;
    vigilante: number;
    villagers: number;
  };
  
  // Timing
  timing: {
    nightTimeout: number;      // ms
    dayDiscussionTime: number; // ms per turn
    votingTime: number;        // ms
    turnDelay: number;         // ms between turns
  };
  
  // Rules
  rules: {
    doctorCanSelfProtect: boolean;
    doctorCannotRepeatProtect: boolean;
    vigilanteShots: number;
    vigilanteRevealOnShoot: boolean;
    doctorBlocksVigilante: boolean;
    tieBreaker: 'rng' | 'no_elimination';
  };
  
  // Visualization
  visualization: {
    enabled: boolean;
    threejsUrl: string;
    defaultCamera: [number, number, number];
    enableVoices: boolean;
    voiceEngine: string;
  };
  
  // Prompts
  prompts: {
    basePrompt: string;
    rolePrompts: Map<string, string>;
    customInstructions?: string;
  };
  
  // Logging
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    exportFormat: 'jsonl' | 'json';
    includeThink: boolean;
    includePrivate: boolean;
  };
}

const DEFAULT_GAME_CONFIG: GameConfig = {
  gameId: generateGameId(),
  seed: Date.now(),
  
  players: [],
  
  roles: {
    mafia: 3,
    doctor: 1,
    sheriff: 1,
    vigilante: 1,
    villagers: 4
  },
  
  timing: {
    nightTimeout: 30000,
    dayDiscussionTime: 15000,  // Per turn
    votingTime: 15000,
    turnDelay: 1000
  },
  
  rules: {
    doctorCanSelfProtect: true,
    doctorCannotRepeatProtect: true,
    vigilanteShots: 1,
    vigilanteRevealOnShoot: false,
    doctorBlocksVigilante: false,
    tieBreaker: 'rng'
  },
  
  visualization: {
    enabled: true,
    threejsUrl: 'https://unpkg.com/three',
    defaultCamera: [0, 10, 20],
    enableVoices: true,
    voiceEngine: 'browser'
  },
  
  prompts: {
    basePrompt: CORE_SYSTEM_PROMPT.system,
    rolePrompts: {
      mafia: MAFIA_PROMPT.roleIdentity,
      doctor: DOCTOR_PROMPT.roleIdentity,
      sheriff: SHERIFF_PROMPT.roleIdentity,
      vigilante: VIGILANTE_PROMPT.roleIdentity,
      villager: VILLAGER_PROMPT.roleIdentity
    }
  },
  
  logging: {
    level: 'info',
    exportFormat: 'jsonl',
    includeThink: true,
    includePrivate: false
  }
};
```

### 6.2 CLI Commands

```bash
# Create new game
mafiactl new \
  --players "Alice:gpt-4, Bob:claude-3, Charlie:gpt-4o, ..."
  --mafia 3 \
  --doctor 1 \
  --sheriff 1 \
  --vigilante 1 \
  --villagers 4 \
  --seed 12345 \
  --mode scripted \
  --visualization true

# Attach to game
mafiactl attach game-abc123 \
  --follow \
  --admin-token xyz \
  --voice false

# Control game
mafiactl pause game-abc123
mafiactl resume game-abc123
mafiactl step game-abc123 --count 5

# Export with different formats
mafiactl export game-abc123 --format jsonl --include-private
mafiactl export game-abc123 --format json --include-think

# Visualization
mafiactl visualize game-abc123 --port 3000 --threejs-port 8080
mafiactl voice test --voice-engine elevenlabs --api-key xyz
```

### 6.3 REST API Endpoints

```typescript
// Game Management
POST   /api/games              // Create new game
GET    /api/games/:id          // Get game status
POST   /api/games/:id/start    // Start game
POST   /api/games/:id/pause    // Pause game
POST   /api/games/:id/resume   // Resume game
DELETE /api/games/:id          // Delete game

// Game Configuration
GET    /api/games/:id/config   // Get game config
PUT    /api/games/:id/config   // Update game config

// Players
GET    /api/games/:id/players  // Get player list
POST   /api/games/:id/players  // Add player
DELETE /api/games/:id/players/:playerId  // Remove player

// Events
GET    /api/games/:id/events   // Get events (with filters)
GET    /api/games/:id/events/stream  // SSE stream
GET    /api/games/:id/export   // Export game log

// Visualization
GET    /api/games/:id/visualization  // Get visualization state
WS     /api/games/:id/ws             // WebSocket for real-time sync

// Voices
POST   /api/voices/generate  // Generate TTS for statement
GET    /api/voices/presets   // Get available voice presets
```

---

## 7. Implementation Roadmap

### Phase 1: Core Engine (Week 1-2)
- [ ] FSM game engine
- [ ] Event sourcing
- [ ] Basic agent prompts
- [ ] CLI interface
- [ ] REST API

### Phase 2: Multi-Agent Coordination (Week 2-3)
- [ ] Night phase communication
- [ ] Day phase communication
- [ ] Agent memory system
- [ ] Context building
- [ ] Role-specific prompts

### Phase 3: Web UI (Week 3-4)
- [ ] React dashboard
- [ ] WebSocket integration
- [ ] Real-time updates
- [ ] Event feed
- [ ] Agent cards

### Phase 4: Three.js Visualization (Week 4-5)
- [ ] 3D scene setup
- [ ] Player avatars
- [ ] Chat bubbles
- [ ] Animations
- [ ] Camera controls

### Phase 5: Voice Synthesis (Week 5-6)
- [ ] TTS integration
- [ ] Voice configuration
- [ ] Per-character voices
- [ ] Emotion mapping
- [ ] Audio visualization

### Phase 6: Testing & Polish (Week 6-7)
- [ ] Multi-agent integration tests
- [ ] Determinism tests
- [ ] UI/UX polish
- [ ] Performance optimization
- [ ] Documentation

---

## Summary

This architecture provides:

1. **Complete role-specific prompts** for mafia, doctor, sheriff, vigilante, and villagers
2. **Hierarchical context management** with night/day/internal memory structures
3. **Multi-agent communication protocols** for coordinating actions
4. **Three.js visualization** with avatar animations and chat bubbles
5. **Voice synthesis** with per-character voice configuration
6. **API/CLI** for game management and configuration

The system is designed to be modular, allowing each component to be developed and tested independently before integration.