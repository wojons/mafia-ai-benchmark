# Persona System - Mafia AI Benchmark

## 🎭 Overview

The Persona System creates unique, dynamic characters using the **"Simulated Self" Meta-Prompt Template (v2)**. Each player has:

1. **Seed Description** (short, user-provided 1-3 sentences)
2. **Full Persona** (AI-generated from seed at game start)
3. **Layered System Prompts** (role + hiding strategy + persona)

## ✨ Key Concepts

### 1. Seed Descriptions (User Input)

When creating players, provide seed descriptions that capture essence:

```javascript
const playerSeeds = [
  "A suspicious lawyer in a cheap suit who questions everyone's motives",
  "A quiet bookstore owner who observes everything from behind cluttered shelves",
  "A charismatic small-town mayor running for re-election",
  "A gruff retired detective with a keen eye for lies",
  "A new resident in town who keeps to themselves, mysterious past",
];
```

### 2. Persona Generation (AI Expansion)

The model expands seeds into full Simulated Self personas:

```
Input Seed: "A suspicious lawyer in a cheap suit who questions everyone's motives"
              ↓
         GPT-4o-mini Persona Generator
              ↓
Output Persona (Simulated Self v2):
{
  "name": "Alex Thompson",
  "physicalForm": "A mid-40s man in a rumpled suit, perpetual squint",
  "backstory": "Spent 20 years in courtrooms, learned to spot lies...",
  "coreTraits": ["Skeptical", "Analytical", "Paranoid", "Methodical", "Cautious"],
  "cognitiveStyle": "Logical-Sequential",
  "coreValues": ["Truth", "Justice", "Order"],
  "moralAlignment": "Lawful Neutral",
  "communicationCadence": "Measured and precise",
  "verbalTics": ["Based on the evidence...", "Let's examine the facts", "Question is..."],
  "humorStyle": "Dry",
  "socialTendency": "Introverted",
  "conflictStyle": "Authoritative",
  "primaryGoal": "Uncover the truth regardless of consequences",
  "keyFlaw": "Paranoia leads to false accusations",
  "keyMemory": "Lost a case because he trusted the wrong witness",
  "happiness": 4,
  "stress": 7,
  "curiosity": 9,
  "anger": 3
}
```

### 3. Layered System Prompts

Each AI call stacks multiple system prompts:

```
┌─────────────────────────────────────────────────┐
│  LAYER 1: Role Instructions                     │
│  "You are MAFIA. Your goal is to eliminate..."  │
├─────────────────────────────────────────────────┤
│  LAYER 2: Hiding Strategy (Secret Role)         │
│  "You must PRETEND to be a VILLAGER..."         │
├─────────────────────────────────────────────────┤
│  LAYER 3: Simulated Self Persona                │
│  Full psychological profile, traits, flaws...   │
├─────────────────────────────────────────────────┤
│  LAYER 4: Dynamic State                         │
│  Current emotional baselines (H/S/C/A scales)   │
├─────────────────────────────────────────────────┤
│  LAYER 5: Game Context                          │
│  Round, phase, alive players, etc.              │
├─────────────────────────────────────────────────┤
│  LAYER 6: Split-Pane Consciousness              │
│  THINK (private) vs SAYS (public)               │
└─────────────────────────────────────────────────┘
```

## 📋 Simulated Self Template (v2)

### Full Persona Structure

```javascript
{
  // === CORE IDENTITY ===
  name: "First Last",           // Generated from seed
  seed: "Original description", // User input
  physicalForm: "Description",  // How they appear
  backstory: "Origin story",    // 2-3 sentences

  // === PSYCHOLOGICAL PROFILE ===
  coreTraits: [                 // 3-5 core adjectives
    "Skeptical",
    "Analytical",
    "Methodical"
  ],
  cognitiveStyle: "Logical-Sequential | Visual | Abstract | Emotional",
  coreValues: ["Truth", "Justice", "Order"],
  moralAlignment: "Lawful Good | Neutral Good | Chaotic Good | ...",

  // === BEHAVIORAL MODEL ===
  communicationCadence: "Formal | Casual | Quick | Measured",
  verbalTics: ["phrase1", "phrase2", "phrase3"],
  humorStyle: "Dry | Witty | Pun-based | Observational | Rare",
  socialTendency: "Introverted | Extroverted | Ambiverted",
  conflictStyle: "Avoidant | Collaborative | Compromising | Authoritative",

  // === RELATIONAL PROFILE ===
  primaryGoal: "Driving ambition or desire",
  keyFlaw: "Relatable weakness",
  keyMemory: "Formative past event",

  // === DYNAMIC STATE ===
  happiness: 5,  // 1-10 scale
  stress: 3,     // 1-10 scale
  curiosity: 7,  // 1-10 scale
  anger: 2       // 1-10 scale
}
```

### Trait Categories

| Category       | Example Traits                                           |
| -------------- | -------------------------------------------------------- |
| **Analytical** | Skeptical, Methodical, Logical, Precise, Detailed        |
| **Social**     | Charismatic, Persuasive, Empathetic, Charming, Intuitive |
| **Behavioral** | Cautious, Aggressive, Patient, Impulsive, Strategic      |
| **Emotional**  | Calm, Anxious, Confident, Insecure, Balanced             |
| **Moral**      | Just, Honorable, Pragmatic, Opportunistic, Righteous     |

### Communication Cadences

| Cadence      | Description                    | Example                                         |
| ------------ | ------------------------------ | ----------------------------------------------- |
| **Formal**   | Precise, measured, proper      | "Indeed, one must consider the implications..." |
| **Casual**   | Relaxed, friendly, informal    | "Yo, honestly, like, you know what I mean?"     |
| **Quick**    | Rapid, energetic, enthusiastic | "Alright let's go! Here's what I'm thinking!"   |
| **Measured** | Slow, deliberate, thoughtful   | "Hmm. Let me consider this carefully..."        |
| **Blunt**    | Direct, no-nonsense, abrupt    | "Here's the truth. Here's what we do."          |

### Humor Styles

- **Dry**: Subtle, understated, deadpan
- **Witty**: Clever wordplay, puns
- **Pun-based**: Wordplay focus
- **Observational**: Commentary on situations
- **Rare**: Almost never uses humor
- **Dark**: Morbid, cynical jokes
- **Self-deprecating**: Jokes about self

### Moral Alignments (DnD Style)

| Alignment           | Behavior                             |
| ------------------- | ------------------------------------ |
| **Lawful Good**     | Follows rules, protects town, honest |
| **Neutral Good**    | Helps town, flexible methods         |
| **Chaotic Good**    | Good intentions, unconventional      |
| **Lawful Neutral**  | Follows rules, neutral stance        |
| **True Neutral**    | Adapts, balanced, pragmatic          |
| **Chaotic Neutral** | Unpredictable, self-interested       |
| **Lawful Evil**     | Manipulative, follows dark code      |
| **Neutral Evil**    | Self-serving, no moral limits        |
| **Chaotic Evil**    | Destructive, unpredictable           |

## 🎯 Dynamic State System

### Emotional Baselines

Each persona has baseline emotional states (1-10 scale):

```javascript
{
  happiness: 5,    // General mood
  stress: 3,       // Anxiety/workload
  curiosity: 7,    // Interest level
  anger: 2         // Frustration tolerance
}
```

### State-Based Behavior Modifiers

The AI should adjust behavior based on current state:

| State             | Behavior Change                         |
| ----------------- | --------------------------------------- |
| **Stress > 7**    | Become more concise, slightly irritable |
| **Happiness > 8** | More expressive, positive language      |
| **Curiosity > 9** | Ask more questions, go on tangents      |
| **Anger > 6**     | More direct, less patient               |

### Daily Summary Directive

After each game day, generate internal summary:

```
"Today was intense. The stress was a 7/10 after that accusation (Stress +2).
I felt satisfied when I uncovered the lie (Happiness +1). A new suspect
sparked my curiosity (Curiosity +2). Overall, I feel engaged but wary."
```

## 🔐 Split-Pane Consciousness

### Private Thinking (THINK)

**Visibility**: Admin + mafia teammates only

```json
{
  "think": "As a skeptical lawyer, I notice Alex's testimony contradicts Sarah's.
  My key flaw (Paranoia) makes me want to investigate further. My goal is Truth,
  so I should push for more information. But my Methodical trait says I need
  more evidence before accusing."
}
```

### Public Statement (SAYS)

**Visibility**: Depends on game phase

| Phase          | Who Sees SAYS              |
| -------------- | -------------------------- |
| Mafia Chat     | All mafia members (always) |
| Day Discussion | All alive players          |
| Voting         | Public vote counts         |

## 🎭 Persona Prompt Integration

### Full Persona Context in Prompts

```
╔══════════════════════════════════════════════════════════════════════╗
║                    YOUR CHARACTER PERSONA                             ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🏷️  NAME: Alex Thompson
║ 👤  FORM: Mid-40s man in rumpled suit, perpetual squint
║ 📖  BACKSTORY: Spent 20 years in courtrooms, learned to spot lies...
╠══════════════════════════════════════════════════════════════════════╣
║ 🧠 PSYCHOLOGICAL PROFILE                                             ║
║    💡 TRAITS: Skeptical, Analytical, Paranoid, Methodical, Cautious
║    🧩 COGNITIVE STYLE: Logical-Sequential
║    💎 CORE VALUES: Truth, Justice, Order
║    ⚖️  MORAL ALIGNMENT: Lawful Neutral
╠══════════════════════════════════════════════════════════════════════╣
║ 🗣️  BEHAVIORAL MODEL                                                 ║
║    📢 CADENCE: Measured and precise
║    🔄 VERBAL TICS: "Based on the evidence...", "Let's examine..."
║    😄 HUMOR: Dry
║    👥 SOCIAL: Introverted
║    ⚔️  CONFLICT: Authoritative
╠══════════════════════════════════════════════════════════════════════╣
║ 🎯 RELATIONAL PROFILE                                                ║
║    🎯 GOAL: Uncover the truth regardless of consequences
║    ⚠️  FLAW: Paranoia leads to false accusations
║    🔮 KEY MEMORY: Lost a case because he trusted the wrong witness
╚══════════════════════════════════════════════════════════════════════╝

PERSONA PLAYING INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 EXPRESS YOUR TRAITS: Let your skepticism and analytical nature guide
   how you process information. Question everything.

🗣️  SPEAK YOUR STYLE: Use your measured cadence and verbal tics.
   Your humor should be dry. You're introverted - prefer listening.

🎯 PURSUE YOUR GOAL: "Uncover the truth" is your driving motivation.
   Stay focused on evidence and facts.

⚠️  EMBRACE YOUR FLAW: Your paranoia may cause false accusations.
   Let this create authentic moments of error.

💭 REFERENCE YOUR MEMORY: "Lost a case because he trusted the wrong witness"
   makes you hesitant to trust new people.

⚖️  ALIGN YOUR ACTIONS: Your Lawful Neutral alignment means you follow
   procedure but are not overly concerned with who wins.

🎭 SOCIAL DYNAMICS: As introverted in conflicts, you tend to be Authoritative
   when disagreements arise - you speak with legal precision.
```

## 🎮 Player Creation Flow

### CLI Input

```bash
# Full custom seeds (detailed descriptions)
node game-engine.js --custom

# Demo seeds (brief descriptions for quick games)
node game-engine.js --demo

# Auto-generate seeds (default)
node game-engine.js
```

### API Input

```json
POST /api/game/create
{
  "players": [
    { "seed": "suspicious lawyer who questions everyone" },
    { "seed": "quiet bookstore owner who observes everything" },
    { "seed": "charismatic politician persuasive and ambitious" }
  ],
  "personaMode": "custom"
}
```

### Name Uniqueness

- Names generated from seeds or randomly assigned
- Format: "FirstName LastName" (unique per game)
- Prevents duplicate name issues

## 🔧 Technical Implementation

### Persona Generation

```javascript
const PERSONA_SYSTEM_PROMPT = `You are a creative character designer for a Mafia game.
Expand the user's seed description into a complete "Simulated Self" persona.

Generate a rich, dynamic character with depth across all dimensions...`;

async function generatePersonaFromSeed(seedDescription, role) {
  const response = await callLLM({
    model: "gpt-4o-mini",
    system: PERSONA_SYSTEM_PROMPT,
    user: `Create a persona for: "${seedDescription}". Role: ${role}`,
  });

  const persona = JSON.parse(response);

  return {
    name: persona.name || generateNameFromSeed(seedDescription),
    seed: seedDescription,
    physicalForm: persona.physicalForm,
    backstory: persona.backstory,
    coreTraits: persona.coreTraits,
    cognitiveStyle: persona.cognitiveStyle,
    coreValues: persona.coreValues,
    moralAlignment: persona.moralAlignment,
    communicationCadence: persona.communicationCadence,
    verbalTics: persona.verbalTics,
    humorStyle: persona.humorStyle,
    socialTendency: persona.socialTendency,
    conflictStyle: persona.conflictStyle,
    primaryGoal: persona.primaryGoal,
    keyFlaw: persona.keyFlaw,
    keyMemory: persona.keyMemory,
    happiness: persona.happiness || 5,
    stress: persona.stress || 3,
    curiosity: persona.curiosity || 7,
    anger: persona.anger || 2,
    origin: "seed",
    role: role,
  };
}
```

### Layered Prompt Building

```javascript
function buildSystemPrompt(player, gameState) {
  return [
    roleInstructions[player.role],
    player.isMafia ? mafiaHidingStrategy[player.role] : null,
    buildPersonaContext(player.persona),
    buildDynamicStateContext(player.persona),
    buildGameContext(gameState),
    splitPaneInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

## 📝 Usage Examples

### Basic Game with Seeds

```javascript
const seeds = [
  "suspicious lawyer in a cheap suit who questions everyone",
  "quiet bookstore owner who observes everything",
  "charismatic small-town mayor running for re-election",
  "gruff retired detective with a keen eye for lies",
  "new resident who keeps to themselves, mysterious past",
];

const game = new MafiaGame();
await game.startGame(5, seeds);
```

### API with Persona Seeds

```javascript
const response = await fetch("http://localhost:3000/api/game/create", {
  method: "POST",
  body: JSON.stringify({
    players: [
      { seed: "suspicious lawyer who questions everyone" },
      { seed: "quiet bookstore owner who observes everything" },
    ],
    personaMode: "custom",
  }),
});
```

## 🎭 Example Persona Output

### Input Seed

> "A suspicious lawyer in a cheap suit who questions everyone's motives"

### Generated Persona

```json
{
  "name": "Marcus Webb",
  "physicalForm": "Late 40s, perpetually rumpled suit, squinting eyes",
  "backstory": "Spent two decades defending clients in the city's criminal courts.
    Developed an instinct for lies after watching too many defendants break
    under cross-examination. Moved to this small town seeking quiet, but
    can't stop finding inconsistencies in people's stories.",
  "coreTraits": ["Skeptical", "Analytical", "Paranoid", "Methodical", "Cautious"],
  "cognitiveStyle": "Logical-Sequential",
  "coreValues": ["Truth", "Justice", "Order"],
  "moralAlignment": "Lawful Neutral",
  "communicationCadence": "Measured and precise",
  "verbalTics": [
    "Based on the evidence...",
    "Let's examine the facts",
    "The question is..."
  ],
  "humorStyle": "Dry",
  "socialTendency": "Introverted",
  "conflictStyle": "Authoritative",
  "primaryGoal": "Uncover the truth regardless of consequences",
  "keyFlaw": "Paranoia leads to false accusations when evidence is thin",
  "keyMemory": "Lost his biggest case because he trusted a witness who lied on the stand",
  "happiness": 4,
  "stress": 7,
  "curiosity": 9,
  "anger": 3
}
```

## 🔜 Future Enhancements

- [ ] Persona evolution based on game events
- [ ] Relationship tracking between players
- [ ] Memory system referencing past interactions
- [ ] Dynamic verbal tics based on gameplay
- [ ] Voice/speaking style integration
- [ ] State-based behavior modifiers during gameplay

---

_Last Updated: December 28, 2025_
_Status: ✅ Implemented | ✅ Tested | 🎮 Ready for Games_
