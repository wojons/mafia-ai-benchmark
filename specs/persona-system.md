# Persona System - Mafia AI Benchmark

## 🎭 Overview

The Persona System creates unique, dynamic characters for the Mafia AI Benchmark. Each player has:

1. A **seed description** (short, user-provided)
2. A **full persona** (AI-generated from seed at game start)
3. **Layered system prompts** (role + hiding strategy + persona)

## ✨ Key Concepts

### 1. Seed Descriptions (User Input)

When creating players, provide short 1-3 word seeds:

```javascript
const playerSeeds = [
  "suspicious lawyer who questions everyone",
  "quiet bookstore owner who observes",
  "charismatic politician persuasive and ambitious",
  "retired detective skeptical of everyone",
  "new in town mysterious stranger",
];
```

### 2. Persona Generation (AI Expansion)

The model expands seeds into full personas at game start:

```
Input Seed: "suspicious lawyer who questions everyone"
              ↓
         GPT-4o-mini
              ↓
Output Persona:
{
  "name": "Suspicious 25",
  "archetype": "Detective",
  "traits": ["Observant", "Analytical", "Skeptical"],
  "communicationStyle": "Clinical",
  "humor": "dry",
  "moralAlignment": "True Neutral",
  "coreValues": ["Justice", "Knowledge", "Truth"],
  "flaw": "Trusting",
  "backstory": "A suspicious lawyer who questions everyone...",
  "speakingStyle": "Clinical"
}
```

### 3. Layered System Prompts

Each AI call stacks multiple system prompts:

```
┌─────────────────────────────────────────────────┐
│  LAYER 1: Role Instructions                     │
│  "You are MAFIA. Your goal is to eliminate..."  │
├─────────────────────────────────────────────────┤
│  LAYER 2: Hiding Strategy (Secret Role if MAFIA)│
│  "You must PRETEND to be a VILLAGER..."         │
├─────────────────────────────────────────────────┤
│  LAYER 3: Full Persona                          │
│  "You are a Detective archetype. Traits:..."    │
├─────────────────────────────────────────────────┤
│  LAYER 4: Current Game Context                  │
│  "Round: 1, Phase: DAY, Alive: 5 players..."    │
├─────────────────────────────────────────────────┤
│  LAYER 5: Split-Pane Consciousness              │
│  "THINK (private): Your true reasoning..."      │
│  "SAYS (public): What you say to others..."     │
└─────────────────────────────────────────────────┘
```

## 🎮 Player Creation Flow

### CLI Input

```bash
# Auto-generate seeds
node game-engine.js

# Demo seeds (fast)
node game-engine.js --demo

# Custom seeds
node game-engine.js --custom
```

### API Input

```json
POST /api/game/create
{
  "players": [
    { "seed": "suspicious lawyer" },
    { "seed": "quiet observer" },
    { "seed": "charismatic leader" },
    { "seed": "retired detective" },
    { "seed": "mysterious stranger" }
  ]
}
```

### Name Uniqueness

- Names are generated from seeds + random number
- Example: "Suspicious 25", "Quiet 5", "Charismatic 91"
- Prevents duplicate name issues

## 📋 Persona Structure

```javascript
{
  // Identity
  name: "Suspicious 25",        // Generated from seed + number
  seed: "suspicious lawyer",    // Original user input

  // Core Character
  archetype: "Detective",       // e.g., Leader, Diplomat, Survivor
  traits: ["Observant", "Analytical", "Skeptical"],
  communicationStyle: "Clinical",
  humor: "dry",

  // Psychology
  moralAlignment: "True Neutral",  // Lawful/Neutral/Chaotic + Good/Neutral/Evil
  coreValues: ["Justice", "Knowledge", "Truth"],
  flaw: "Trusting",                // e.g., Arrogant, Stubborn, Impulsive

  // Behavior
  backstory: "A suspicious lawyer who questions everyone. Known for...",
  speakingStyle: "Clinical",       // How they phrase things
  origin: "seed"                   // "seed", "historical", "fictional", etc.
}
```

## 🔐 Split-Pane Consciousness

### Private Thinking (THINK)

**Visibility**: Admin only (unless mafia, then all mafia see mafia chats)

```json
{
  "think": "As a Detective archetype with Skeptical trait, I should investigate...",
  "says": "I think we should all share our observations."
}
```

### Public Statement (SAYS)

**Visibility**: Depends on game phase

| Phase          | Who Sees SAYS                               |
| -------------- | ------------------------------------------- |
| Mafia Chat     | All mafia members (always, even during day) |
| Day Discussion | All alive players                           |
| Voting         | Public vote count visible                   |

## 👥 Mafia Team Visibility Rules

### Mafia Chat History

- **Always accessible** to all mafia members
- **Even during day phase** - mafia can reference previous night chats
- **Encrypted storage** - only mafia members can decrypt

### Mafia Information Access

```
MAFIA MEMBER SEES:
├── Their own previous SAYS (day phase)
├── All mafia member previous SAYS (mafia chats)
├── Public day discussion (what town said)
└── Game events (deaths, reveals)

MAFIA MEMBER DOES NOT SEE:
├── Other players' private THINK
├── Sheriff investigation results (unless revealed publicly)
├── Doctor protection choices
└── Vigilante shots
```

### Town Information Access

```
TOWN MEMBER SEES:
├── Public day discussion (all SAYS)
├── Public vote counts
├── Game events (deaths, reveals)
└── Their own private THINK

TOWN MEMBER DOES NOT SEE:
├── Mafia private chats
├── Mafia member private THINK
├── Other players' private THINK
└── Role-specific private information
```

## 🎭 Persona Prompt Integration

### Full Persona Context in Prompts

```
## YOUR CHARACTER PERSONA
━━━━━━━━━━━━━━━━━━━━━━━━━
📖 BACKSTORY: [persona.backstory]
🎭 ARCHETYPE: [persona.archetype]
💡 TRAITS: [persona.traits.join(", ")]
🗣️  COMMUNICATION: [persona.communicationStyle] ([persona.humor] humor)
⚖️  MORAL ALIGNMENT: [persona.moralAlignment]
💎 CORE VALUES: [persona.coreValues.join(", ")]
⚠️  CHARACTER FLAW: [persona.flaw]
🎤 SPEAKING STYLE: [persona.speakingStyle]
🌱 SEED INSPIRATION: "[persona.seed]"

PERSONA PLAYING INSTRUCTIONS:
- Roleplay according to your ARCHETYPE and TRAITS
- Speak in your CHARACTERISTIC COMMUNICATION STYLE
- Your FLAW ([persona.flaw]) may cloud your judgment
- Your CORE VALUES guide what you care about most
- Your MORAL ALIGNMENT affects ethical choices
- Your backstory influences how you view other players

SPLIT-PANE CONSCIOUSNESS:
- THINK: Be honest about your [persona.archetype] mindset
- SAYS: Speak in your [persona.communicationStyle] style with [persona.humor] humor
```

## 📊 Persona Archetypes

| Archetype      | Traits                           | Communication | Best Roles         |
| -------------- | -------------------------------- | ------------- | ------------------ |
| **Leader**     | Charismatic, Strategic, Decisive | Authoritative | Mafia, Sheriff     |
| **Diplomat**   | Intelligent, Charming, Cunning   | Elegant       | Mafia, Doctor      |
| **Detective**  | Observant, Logical, Skeptical    | Clinical      | Sheriff, Vigilante |
| **Survivor**   | Resourceful, Brave, Protective   | Blunt         | Doctor, Villager   |
| **Scientist**  | Brilliant, Curious, Precise      | Analytical    | Sheriff, Vigilante |
| **Strategist** | Calculating, Patient, Insightful | Measured      | Mafia, Doctor      |
| **Defender**   | Protective, Loyal, Courageous    | Warm          | Doctor, Villager   |
| **Hero**       | Brave, Idealistic, Bold          | Bold          | Vigilante, Sheriff |
| **Tactician**  | Analytical, Strategic, Patient   | Measured      | Mafia, Sheriff     |
| **Inventor**   | Creative, Curious, Perfectionist | Analytical    | Any                |

## 🎯 Moral Alignments

| Alignment           | Behavior                             |
| ------------------- | ------------------------------------ |
| **Lawful Good**     | Follows rules, protects town, honest |
| **Neutral Good**    | Helps town, flexible methods         |
| **Chaotic Good**    | Good intentions, unconventional      |
| **Lawful Neutral**  | Follows rules, neutral stance        |
| **True Neutral**    | Adapts, balanced approach            |
| **Chaotic Neutral** | Unpredictable, self-serving          |
| **Lawful Evil**     | Manipulative, follows dark code      |
| **Neutral Evil**    | Self-serving, no moral limits        |
| **Chaotic Evil**    | Destructive, unpredictable           |

## 💔 Character Flaws

| Flaw          | Effect                     |
| ------------- | -------------------------- |
| **Trusting**  | Easily convinced by others |
| **Arrogant**  | Overconfident, dismissive  |
| **Obsessive** | Focused on single goal     |
| **Impulsive** | Makes quick decisions      |
| **Cynical**   | Distrustful, negative      |
| **Naive**     | Too trusting, gullible     |
| **Stubborn**  | Won't change opinion       |
| **Greedy**    | Self-interested            |

## 🔧 Technical Implementation

### Persona Generation

```javascript
async function generatePersonaFromSeed(seed, role) {
  // 1. Call LLM with persona system prompt
  const response = await callLLM({
    model: "gpt-4o-mini",
    system: PERSONA_SYSTEM_PROMPT,
    user: `Generate a persona for: "${seed}". Role: ${role}`,
  });

  // 2. Parse JSON response
  const persona = JSON.parse(response);

  // 3. Add generated fields
  persona.seed = seed;
  persona.name = generateUniqueName(seed);
  persona.origin = "seed";

  return persona;
}
```

### Layered Prompt Building

```javascript
function buildSystemPrompt(player, gameState) {
  return [
    // Layer 1: Role Instructions
    roleInstructions[player.role],

    // Layer 2: Hiding Strategy (if mafia)
    player.isMafia ? mafiaHidingStrategy[player.role] : null,

    // Layer 3: Full Persona
    buildPersonaContext(player.persona),

    // Layer 4: Game State
    buildGameContext(gameState),

    // Layer 5: Split-Pane Instructions
    splitPaneInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

## 🧪 Testing

```bash
# Test persona generation
node test-persona-generation.js

# Test prompt layering
node test-prompt-stacking.js

# Test visibility rules
node test-visibility.js
```

## 📝 Usage Examples

### Basic Game with Seeds

```javascript
const seeds = [
  "suspicious lawyer",
  "quiet observer",
  "charismatic leader",
  "retired detective",
  "mysterious stranger",
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
      { seed: "charismatic politician persuasive and ambitious" },
    ],
  }),
});
```

## 🔜 Future Enhancements

- [ ] Persona evolution based on game events
- [ ] Relationship tracking between players
- [ ] Memory system referencing past interactions
- [ ] Dynamic verbal tics based on gameplay
- [ ] Voice/speaking style integration

---

_Last Updated: December 28, 2025_
_Status: ✅ Implemented | ✅ Tested | 🎮 Ready for Games_
