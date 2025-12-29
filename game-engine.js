// ============================================
// LOAD ENVIRONMENT VARIABLES
// ============================================
require("dotenv").config();

// ============================================
// STATISTICS & SCORING SYSTEM
// ============================================
const {
  TokenTracker,
  APITracker,
  RealtimeDashboard,
  initializeStatisticsSchema,
} = require("./statistics-system");

// ============================================
// EVIDENCE & CASE BUILDING SYSTEM
// ============================================
const { EvidenceManager, SuspectMeter } = require("./evidence-system");

// ============================================
// COST TRACKING & BUDGET ENFORCEMENT
// ============================================
const {
  CostTracker,
  ContextCompressor,
  EventReplay,
  initializeSupportingSchema,
} = require("./cost-tracking");

// ============================================
// NAME DATABASE
// ============================================
const { getRandomName, resetUsedNames } = require("./name-database");

// ============================================
// GAME ENGINE MODULES (REFACTORED)
// ============================================

const {
  calculateRoles,
  assignRolesWithMultiRole,
  playerHasRole,
  getPlayerRoles,
  formatPlayerRoles,
  hasRoleConflict,
  resolveSheriffMafiaConflict,
  resolveDoctorMafiaConflict,
  calculateMafiaDoctorSavePattern,
  shouldMafiaDoctorSaveTeammate,
  isMafiaTeammate,
  resolveVigilanteMafiaConflict,
  getMultiRolePromptContext,
} = require("./game-engine/index");

// ============================================
// ENHANCED PERSONA GENERATION SYSTEM
// ============================================

const PERSONA_SYSTEM_PROMPT = `You are a creative character designer for a Mafia game.
Expand the user's name seed into a complete "Simulated Self" persona.

IMPORTANT: When creating the character's name, use the seed name ONLY as INSPIRATION.
- Analyze the cultural origin of the seed name
- Create a NEW, UNIQUE name with similar cultural origins or naming conventions
- DO NOT simply copy the seed name - be creative and original
- If the seed is "Wei Chen", you might create "Chen Wei", "Lin Wei", "Wei Lin", "Zheng Chen", etc.
- If the seed is "Amara Okonkwo", you might create "Adaobi Okeke", "Chidera Nnamdi", "Obioma Amadi", etc.

Generate a rich, dynamic character with depth across all these dimensions:

## Core Identity
- Name (a NEW, UNIQUE name inspired by the seed's cultural origins)
- Physical form/avatar description
- Backstory (2-3 sentences about origin)

## Psychological Profile
- Core traits (3-5 adjectives) - VARY these! Use unique, descriptive words instead of generic ones like "Strategic", "Cautious", "Smart"
- Cognitive style (how they think) - VARY between Logical, Visual, Intuitive, Emotional, Abstract, Reflective, Analytical, Creative, etc.
- Core values (what matters most) - VARY these!
- Moral alignment (DnD style)

## Behavioral Model
- Communication cadence (how they speak) - VARY between Formal, Casual, Quick, Measured, Diplomatic, Eloquent, Direct, Wittty, etc.
- Verbal tics (common phrases, if any)
- Humor style - VARY between Dry, Witty, Observational, Dark, Pun-based, Awkward, Rare, Sarcasm, etc.
- Social tendencies - VARY between Introverted, Extroverted, Ambivert
- Conflict resolution style - VARY between Avoidant, Collaborative, Compromising, Authoritative, Assertive

## Relational Profile
- Primary goal/motivation
- Key flaw/insecurity
- A key formative memory

## Dynamic State
- Current emotional baseline (happiness, stress, curiosity, anger scales 1-10)
- State-based behavior modifiers

CRITICAL: Each persona must be UNIQUE and DIFFERENT from all others. Avoid repetitive patterns.

Return ONLY valid JSON matching this structure:
{
  "name": "First Last",
  "physicalForm": "Description of how they appear",
  "backstory": "Origin story paragraph",
  "coreTraits": ["trait1", "trait2", "trait3", "trait4", "trait5"],
  "cognitiveStyle": "Logical-Sequential | Visual | Abstract | Emotional",
  "coreValues": ["value1", "value2", "value3"],
  "moralAlignment": "Lawful Good | Neutral Good | Chaotic Good | etc.",
  "communicationCadence": "Formal | Casual | Quick | Measured | etc.",
  "verbalTics": ["phrase1", "phrase2", "phrase3"],
  "humorStyle": "Dry | Witty | Pun-based | Observational | Rare",
  "socialTendency": "Introverted | Extroverted | Ambiverted",
  "conflictStyle": "Avoidant | Collaborative | Compromising | Authoritative",
  "primaryGoal": "Their driving ambition or desire",
  "keyFlaw": "A relatable weakness",
  "keyMemory": "A formative past event that shapes them",
  "happiness": 5,
  "stress": 3,
  "curiosity": 7,
  "anger": 2
}

The character should feel authentic and consistent. Use the seed name as cultural inspiration to create a unique persona.`;

// ============================================
// PERSONA GENERATION FROM SEED
// ============================================

async function generatePersona(seed = undefined, temperature = 1.0) {
  if (!API_KEY) {
    // Fallback to procedural generation if no API key
    return generateProceduralPersona(seed);
  }

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + API_KEY,
          "HTTP-Referer": "http://mafia-ai-benchmark.local",
          "X-Title": "Mafia AI Benchmark",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: PERSONA_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: seed
                ? `${seed}\n\nUse this name as INSPIRATION to create a unique personality and a NEW, similar-but-different name with the same cultural origins. Do not copy the seed name exactly - be creative! Generate a unique persona with distinct traits, cognitive style, communication patterns, and characteristics that are different from typical mafia game personas.`
                : "Generate a unique, diverse persona for me. The more distinct and interesting, the better! Use varied traits, cognitive styles, communication patterns, and cultural backgrounds. Avoid repetitive or stereotypical personalities.",
            },
          ],
          temperature: temperature,
          max_tokens: 600,
          response_format: { type: "json_object" },
        }),
      },
    );

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const persona = JSON.parse(jsonMatch[0]);

      // Generate unique name if not provided
      const name =
        persona.name ||
        require("./game-engine/index").generateNameFromSeed(seed);

      return {
        // Core Identity
        name: name,
        seed: seed,
        physicalForm: persona.physicalForm || "A person in town",
        backstory: persona.backstory || seed,

        // Psychological Profile
        coreTraits: persona.coreTraits || ["Strategic", "Cautious"],
        cognitiveStyle: persona.cognitiveStyle || "Logical-Sequential",
        coreValues: persona.coreValues || ["Survival"],
        moralAlignment: persona.moralAlignment || "True Neutral",

        // Behavioral Model
        communicationCadence: persona.communicationCadence || "Direct",
        verbalTics: persona.verbalTics || [],
        humorStyle: persona.humorStyle || "dry",
        socialTendency: persona.socialTendency || "Ambivert",
        conflictStyle: persona.conflictStyle || "Collaborative",

        // Relational Profile
        primaryGoal: persona.primaryGoal || "Survive and win",
        keyFlaw: persona.keyFlaw || "Trusting",
        keyMemory: persona.keyMemory || "First game of Mafia",

        // Dynamic State (baseline)
        happiness: persona.happiness || 5,
        stress: persona.stress || 3,
        curiosity: persona.curiosity || 7,
        anger: persona.anger || 2,

        // Metadata
        origin: seed ? "seed" : "ai-generated",
      };
    }
  } catch (error) {
    console.error("[WARN] Persona generation failed:", error.message);
  }

  // Fallback to procedural
  return generateProceduralPersona(seed);
}

// ============================================
// NAME GENERATOR FROM SEED
// ============================================

// ============================================
// PROCEDURAL PERSONA FALLBACK
// ============================================

function generateProceduralPersona(seed = undefined) {
  // Parse seed for hints (if provided)
  const seedLower = seed ? seed.toLowerCase() : "";

  // Extract potential name from seed if it looks like a name
  const nameMatch = seed ? seed.match(/^([A-Z][a-z]+)/) : null;
  const baseName = nameMatch
    ? nameMatch[1]
    : ["Alex", "Morgan", "Jordan", "Casey", "Taylor"][
        Math.floor(Math.random() * 5)
      ];

  // Determine archetype hints from seed
  let archetypeHints = [];
  if (seedLower.includes("leader") || seedLower.includes("boss"))
    archetypeHints.push("Leader");
  if (
    seedLower.includes("detective") ||
    seedLower.includes("investigate") ||
    seedLower.includes("question")
  )
    archetypeHints.push("Detective");
  if (
    seedLower.includes("doctor") ||
    seedLower.includes("heal") ||
    seedLower.includes("help")
  )
    archetypeHints.push("Healer");
  if (
    seedLower.includes("quiet") ||
    seedLower.includes("shy") ||
    seedLower.includes("observe")
  )
    archetypeHints.push("Observer");
  if (
    seedLower.includes("loud") ||
    seedLower.includes("aggressive") ||
    seedLower.includes("attack")
  )
    archetypeHints.push("Conqueror");
  if (
    seedLower.includes("smart") ||
    seedLower.includes("clever") ||
    seedLower.includes("think")
  )
    archetypeHints.push("Scientist");
  if (
    seedLower.includes("charm") ||
    seedLower.includes("persuade") ||
    seedLower.includes("convince")
  )
    archetypeHints.push("Diplomat");

  // Select archetype
  const allArchetypes = [
    "Leader",
    "Diplomat",
    "Detective",
    "Survivor",
    "Scientist",
    "Strategist",
    "Defender",
    "Hero",
    "Tactician",
  ];
  const archetype =
    archetypeHints.length > 0
      ? archetypeHints[Math.floor(Math.random() * archetypeHints.length)]
      : allArchetypes[Math.floor(Math.random() * allArchetypes.length)];

  // Generate traits based on seed and archetype
  const traitPool = {
    Leader: ["Charismatic", "Strategic", "Decisive", "Confident", "Ambitious"],
    Diplomat: ["Charming", "Cunning", "Persuasive", "Tactical", "Eloquent"],
    Detective: [
      "Observant",
      "Analytical",
      "Skeptical",
      "Methodical",
      "Intuitive",
    ],
    Survivor: [
      "Resourceful",
      "Cautious",
      "Adaptable",
      "Resilient",
      "Protective",
    ],
    Scientist: ["Brilliant", "Logical", "Curious", "Precise", "Objective"],
    Strategist: [
      "Calculating",
      "Patient",
      "Methodical",
      "Insightful",
      "Calculating",
    ],
    Defender: ["Protective", "Loyal", "Courageous", "Principled", "Empathetic"],
    Hero: ["Brave", "Idealistic", "Altruistic", "Bold", "Inspiring"],
    Tactician: ["Strategic", "Analytical", "Patient", "Measured", "Observant"],
  };

  const traits = traitPool[archetype] || traitPool["Survivor"];
  const selectedTraits = traits.slice(0, 3 + Math.floor(Math.random() * 2));

  // Communication style based on archetype
  const commStyles = {
    Leader: ["Authoritative", "Bold", "Direct"],
    Diplomat: ["Elegant", "Tactful", "Charming"],
    Detective: ["Clinical", "Questioning", "Analytical"],
    Survivor: ["Cautious", "Direct", "Blunt"],
    Scientist: ["Precise", "Analytical", "Technical"],
    Strategist: ["Measured", "Calculated", "Strategic"],
    Defender: ["Warm", "Protective", "Reassuring"],
    Hero: ["Bold", "Inspiring", "Enthusiastic"],
    Tactician: ["Measured", "Thoughtful", "Strategic"],
  };

  const communicationStyle = commStyles[archetype]?.[0] || "Direct";

  // Humor based on seed hints
  let humor = "dry";
  if (
    seedLower.includes("funny") ||
    seedLower.includes("joke") ||
    seedLower.includes("humor")
  )
    humor = "witty";
  else if (
    seedLower.includes("serious") ||
    seedLower.includes("sad") ||
    seedLower.includes("dark")
  )
    humor = "dark";
  else if (seedLower.includes("happy") || seedLower.includes("optimistic"))
    humor = "warm";
  else if (seedLower.includes("awkward") || seedLower.includes("weird"))
    humor = "awkward";
  else
    humor = ["dry", "witty", "quiet", "serious"][Math.floor(Math.random() * 4)];

  // Moral alignment based on role hints
  let alignment = "True Neutral";
  if (
    seedLower.includes("good") ||
    seedLower.includes("hero") ||
    seedLower.includes("justice")
  )
    alignment = "Neutral Good";
  else if (
    seedLower.includes("evil") ||
    seedLower.includes("bad") ||
    seedLower.includes("villain")
  )
    alignment = "Neutral Evil";
  else if (
    seedLower.includes("chaos") ||
    seedLower.includes("random") ||
    seedLower.includes("wild")
  )
    alignment = "Chaotic Neutral";
  else if (
    seedLower.includes("law") ||
    seedLower.includes("order") ||
    seedLower.includes("rule")
  )
    alignment = "Lawful Neutral";

  // Core values
  const valuePool = [
    "Family",
    "Friendship",
    "Justice",
    "Freedom",
    "Power",
    "Knowledge",
    "Honesty",
    "Wealth",
    "Peace",
    "Glory",
  ];
  const coreValues = valuePool.slice(0, 3).sort(() => Math.random() - 0.5);

  // Flaw
  const flawPool = [
    "Trusting",
    "Arrogant",
    "Obsessive",
    "Impulsive",
    "Cynical",
    "Naive",
    "Stubborn",
    "Greedy",
  ];
  const flaw = flawPool[Math.floor(Math.random() * flawPool.length)];

  // Backstory based on seed
  const backstory = `A ${archetype.toLowerCase()} figure known for being ${traits[0].toLowerCase()}. ${seed || "A mysterious background"}`;

  // Generate cognitive styles (fixing identical persona issue)
  const cognitiveStyles = [
    "Logical-Sequential",
    "Visual-Spatial",
    "Intuitive-Holistic",
    "Emotional-Expressive",
    "Analytical-Synthetic",
    "Creative-Imaginative",
    "Strategic-Tactical",
    "Empathetic-Relational",
    "Abstract-Conceptual",
    "Concrete-Practical",
  ];

  // Generate communication cadences (more diversity)
  const communicationCadences = [
    "Direct",
    "Eloquent",
    "Blunt",
    "Diplomatic",
    "Whimsical",
    "Authoritative",
    "Casual",
    "Formal",
    "Humorous",
    "Solemn",
  ];

  const cognitiveStyle =
    cognitiveStyles[Math.floor(Math.random() * cognitiveStyles.length)];
  const communicationCadence =
    communicationCadences[
      Math.floor(Math.random() * communicationCadences.length)
    ];

  // Generate verbal tics
  const verbalTicsPool = [
    [],
    ["you know"],
    ["I mean"],
    ["hmm"],
    ["well"],
    ["actually"],
    ["sort of"],
    ["to be honest"],
    ["technically"],
  ];
  const verbalTics =
    verbalTicsPool[Math.floor(Math.random() * verbalTicsPool.length)];

  return {
    name: baseName + " " + (Math.floor(Math.random() * 100) + 1),
    archetype: archetype,
    traits: selectedTraits,
    communicationStyle: communicationStyle,
    humor: humor,
    moralAlignment: alignment,
    coreValues: coreValues,
    flaw: flaw,
    backstory: backstory,
    speakingStyle: communicationStyle,
    coreTraits: selectedTraits,
    cognitiveStyle: cognitiveStyle,
    communicationCadence: communicationCadence,
    verbalTics: verbalTics,
    socialTendency: ["Ambiverted", "Introverted", "Extroverted"][
      Math.floor(Math.random() * 3)
    ],
    conflictStyle: ["Collaborative", "Assertive", "Accommodating"][
      Math.floor(Math.random() * 3)
    ],
    primaryGoal: [
      "Survive and win",
      "Find the truth",
      "Protect the innocent",
      "Uncover deception",
    ][Math.floor(Math.random() * 4)],
    keyFlaw: flaw,
    keyMemory: [
      "First game",
      "A past betrayal",
      "A mystery unresolved",
      "A secret kept",
    ][Math.floor(Math.random() * 4)],
    happiness: Math.floor(Math.random() * 10),
    stress: Math.floor(Math.random() * 10),
    curiosity: Math.floor(Math.random() * 10),
    anger: Math.floor(Math.random() * 10),
    origin: seed ? "seed" : "random",
    seed: seed,
  };
}

// ============================================
// GAME ENGINE
// ============================================

const E = {
  GAME: "🎮",
  NIGHT: "🌙",
  DAY: "☀️",
  LOCK: "🔒",
  THINK: "🔒",
  SAYS: "📢",
  MAFIA: "😈",
  DOCTOR: "💉",
  SHERIFF: "👮",
  VIGILANTE: "🔫",
  VILLAGER: "👱",
  SHOOT: "🔫",
  KILL: "💀",
  PROTECT: "🛡️",
  SLEEP: "😴",
  NEWSPAPER: "📰",
  VOTE: "🗳️",
  WIN: "🏆",
  TOWN: "🎉",
  MAFIAWIN: "😈",
  CONTINUE: "⏭️",
  LYNCH: "🚨",
  TIE: "⏭️",
  MAFIATEAM: "[MAFIA TEAM]",
  PUB: "🌍",
  PRIV: "🔒",
};

// Only print banner when executed directly
if (require.main === module) {
  console.log(E.GAME + " Mafia AI Benchmark - PERSONA EDITION v5");
  console.log("=".repeat(70));
  console.log(
    "Features: Persona System, Mafia Consensus, Roles, Voting, Database",
  );
  console.log("=".repeat(70) + "\n");
}
const API_KEY = process.env.OPENAI_API_KEY;

// Database integration
let gameDatabase = null;
const DB_PATH = process.env.DB_PATH || "./data/mafia.db";

async function getGameDatabase() {
  if (!gameDatabase) {
    const { GameDatabase } = require("./modules/database.js");
    gameDatabase = new GameDatabase(DB_PATH);
    await gameDatabase.connect();
  }
  return gameDatabase;
}

const roleEmojis = {
  MAFIA: E.MAFIA,
  DOCTOR: E.DOCTOR,
  SHERIFF: E.SHERIFF,
  VIGILANTE: E.VIGILANTE,
  VILLAGER: E.VILLAGER,
};

// Simple Persona Generator (inlined to avoid ESM issues)
const archetypes = {
  historical: [
    {
      name: "Caesar",
      archetype: "Leader",
      traits: ["Charismatic", "Strategic", "Ambitious"],
      communicationStyle: "Authoritative",
      humor: "dry",
    },
    {
      name: "Cleopatra",
      archetype: "Diplomat",
      traits: ["Intelligent", "Charming", "Cunning"],
      communicationStyle: "Elegant",
      humor: "witty",
    },
    {
      name: "Leonardo",
      archetype: "Inventor",
      traits: ["Curious", "Creative", "Perfectionist"],
      communicationStyle: "Analytical",
      humor: "quiet",
    },
    {
      name: "Genghis",
      archetype: "Conqueror",
      traits: ["Fierce", "Strategic", "Honorable"],
      communicationStyle: "Direct",
      humor: "serious",
    },
    {
      name: "Marie",
      archetype: "Scientist",
      traits: ["Dedicated", "Brilliant", "Resilient"],
      communicationStyle: "Precise",
      humor: "subtle",
    },
    {
      name: "Lincoln",
      archetype: "Mediator",
      traits: ["Wise", "Patient", "Principled"],
      communicationStyle: "Warm",
      humor: "gentle",
    },
    {
      name: "Elizabeth",
      archetype: "Strategist",
      traits: ["Calculating", "Charismatic", "Independent"],
      communicationStyle: "Regal",
      humor: "sharp",
    },
    {
      name: "Sun Tzu",
      archetype: "Tactician",
      traits: ["Analytical", "Strategic", "Patient"],
      communicationStyle: "Measured",
      humor: "ironic",
    },
  ],
  fictional: [
    {
      name: "Sherlock",
      archetype: "Detective",
      traits: ["Observant", "Logical", "Detached"],
      communicationStyle: "Clinical",
      humor: "dry",
    },
    {
      name: "Atticus",
      archetype: "Defender",
      traits: ["Principled", "Empathetic", "Courageous"],
      communicationStyle: "Warm",
      humor: "gentle",
    },
    {
      name: "Katniss",
      archetype: "Survivor",
      traits: ["Resourceful", "Brave", "Protective"],
      communicationStyle: "Blunt",
      humor: "rare",
    },
    {
      name: "Diana",
      archetype: "Hero",
      traits: ["Compassionate", "Fierce", "Idealistic"],
      communicationStyle: "Bold",
      humor: "warm",
    },
  ],
  anime: [
    {
      name: "Naruto",
      archetype: "Hero",
      traits: ["Determined", "Optimistic", "Protective"],
      communicationStyle: "Enthusiastic",
      humor: "loud",
    },
    {
      name: "Light",
      archetype: "Strategist",
      traits: ["Intelligent", "Ambitious", "Calculating"],
      communicationStyle: "Calm",
      humor: "dark",
    },
    {
      name: "Luffy",
      archetype: "Liberator",
      traits: ["Free-spirited", "Brave", "Loyal"],
      communicationStyle: "Simple",
      humor: "comedic",
    },
    {
      name: "Senku",
      archetype: "Scientist",
      traits: ["Brilliant", "Optimistic", "Scientific"],
      communicationStyle: "Excited",
      humor: "proud",
    },
  ],
  stereotype: [
    {
      name: "Alex",
      archetype: "Jock",
      traits: ["Athletic", "Confident", "Social"],
      communicationStyle: "Casual",
      humor: "playful",
    },
    {
      name: "Morgan",
      archetype: "Nerd",
      traits: ["Smart", "Quiet", "Technical"],
      communicationStyle: "Precise",
      humor: "awkward",
    },
    {
      name: "Jordan",
      archetype: "Leader",
      traits: ["Confident", "Charismatic", "Decisive"],
      communicationStyle: "Bold",
      humor: "confident",
    },
    {
      name: "Casey",
      archetype: "Free Spirit",
      traits: ["Creative", "Independent", "Artistic"],
      communicationStyle: "Flowing",
      humor: "random",
    },
  ],
};

const firstNames = [
  "Alex",
  "Morgan",
  "Jordan",
  "Casey",
  "Taylor",
  "Riley",
  "Avery",
  "Parker",
  "Quinn",
  "Skyler",
];
const moralAlignments = [
  "Lawful Good",
  "Neutral Good",
  "Chaotic Good",
  "Lawful Neutral",
  "True Neutral",
  "Chaotic Neutral",
  "Lawful Evil",
  "Neutral Evil",
  "Chaotic Evil",
];
const coreValues = [
  "Family",
  "Friendship",
  "Justice",
  "Freedom",
  "Power",
  "Knowledge",
  "Honesty",
  "Wealth",
  "Peace",
  "Glory",
];
const flaws = [
  "Trusting",
  "Arrogant",
  "Obsessive",
  "Impulsive",
  "Cynical",
  "Naive",
  "Stubborn",
  "Greedy",
];

function generateGamePersonas(numPlayers) {
  const personas = [];
  const archetypeKeys = Object.keys(archetypes);

  for (let i = 0; i < numPlayers; i++) {
    const archetypeKey =
      archetypeKeys[Math.floor(Math.random() * archetypeKeys.length)];
    const archetype =
      archetypes[archetypeKey][
        Math.floor(Math.random() * archetypes[archetypeKey].length)
      ];
    const name =
      firstNames[Math.floor(Math.random() * firstNames.length)] + " " + (i + 1);

    const roleAssignment = [
      "MAFIA",
      "MAFIA",
      "MAFIA",
      "DOCTOR",
      "SHERIFF",
      "VIGILANTE",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
      "VILLAGER",
    ];
    const gameRole = roleAssignment[i] || "VILLAGER";

    personas.push({
      playerId: "p" + Date.now() + i,
      name: name,
      archetype: archetype.archetype,
      traits: archetype.traits,
      communicationStyle: archetype.communicationStyle,
      humor: archetype.humor,
      origin: archetypeKey,
      moralAlignment:
        moralAlignments[Math.floor(Math.random() * moralAlignments.length)],
      coreValues: coreValues.slice(0, 3).sort(() => Math.random() - 0.5),
      flaw: flaws[Math.floor(Math.random() * flaws.length)],
      gameRole: gameRole,
    });
  }

  return personas;
}

function simpleUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? (r & 0x3) | 0x8 : (r & 0xc) | 0x4;
    return v.toString(16);
  });
}

function createGameEvent(
  gameId,
  round,
  phase,
  player,
  eventType,
  visibility,
  content,
  gameInstance = null,
  createCheckpoint = false,
) {
  const event = {
    gameId: gameId,
    round: round,
    phase: phase,
    playerId: player?.id || null,
    playerName: player?.name || null,
    eventType: eventType,
    visibility: visibility,
    timestamp: new Date().toISOString(),
    content: content,

    // Add game state snapshot context (for critical events)
    gameStateSnapshot:
      createCheckpoint && gameInstance ? gameInstance.captureGameState() : null,
  };

  // Persist to database if available
  if (gameInstance && gameInstance.db && gameInstance.config.enableDatabase) {
    try {
      // For events with game state snapshot, create a database snapshot first
      let snapshotId = null;
      if (createCheckpoint) {
        const snapshot = gameInstance.createSnapshot(
          gameId,
          gameInstance.eventSequence,
          event.gameStateSnapshot,
        );
        snapshotId = null; // Would need to get the ID if we return it
      }

      // Append event with full context
      gameInstance.db.appendEvent(gameId, {
        event_type: eventType,
        timestamp: Date.now(),
        private: visibility === "PRIVATE_MAFIA" || visibility === "ADMIN_ONLY",
        payload: {
          ...content,
          // Include full game state in payload for critical events
          gameState: createCheckpoint ? event.gameStateSnapshot : undefined,
        },
      });
    } catch (error) {
      console.error("[DB] Failed to persist event:", error.message);
      // Don't throw - keep the game running
    }
  }

  // Capture event for replay system
  if (gameInstance && gameInstance.eventReplay) {
    try {
      gameInstance.eventReplay.captureEvent(
        event,
        createCheckpoint ? gameInstance.captureGameState() : null,
      );
    } catch (error) {
      console.error("[REPLAY] Failed to capture event:", error.message);
      // Don't throw - keep the game running
    }
  }

  return event;
}

function createPrompt(
  player,
  gameState,
  phase,
  evidenceSummary = "",
  multiRoleContext = "",
) {
  const persona = player.persona;

  // Universal villager base prompt - everyone gets this because mafia need to pretend to be villagers
  const villagerBasePrompt = `
## BASE VILLAGER BEHAVIOR
You are fundamentally a villager in this town working to find the mafia:
- You want to help the town by identifying and eliminating mafia members
- Be helpful, cooperative, and participate in discussions
- Share honest observations and suspicions with other town members
- Vote for who you believe is most likely mafia (or ABSTAIN if you're unsure)
- Work together with other town members to solve this mystery

 ${
   player.role === "MAFIA"
     ? "⚠️ IMPORTANT: YOU ARE MAFIA - You must convincingly PRETEND to follow these base villager behaviors while secretly working to eliminate the town. Hide your true identity at all costs."
     : "Your role gives you special abilities to help the town achieve this common goal."
 }
`;

  const roleInstructions = {
    MAFIA: `You are MAFIA! Your team can see this private chat.
 - Your goal: Eliminate all town members while avoiding detection
 - Coordinate with your mafia teammates to agree on a kill target
 - Blend in with town during day discussions - don't be too suspicious
 - Lie about your observations, defend your teammates subtly`,
    DOCTOR: `You are the DOCTOR. You can protect ONE person per night.
 - Your goal: Protect the sheriff and key town members from being killed
 - You CANNOT protect the same person two nights in a row
 - On night 1, you can protect yourself
 - Use your protection strategically based on suspicions`,
    SHERIFF: `You are the SHERIFF. You can investigate ONE person per night.
 - Your goal: Identify the mafia and share information with town
 - Investigation reveals the EXACT role: MAFIA, DOCTOR, SHERIFF, VIGILANTE, or VILLAGER
 - Share your findings strategically during day discussions
 - Be careful - if you're too obvious, the mafia will kill you`,
    VIGILANTE: `You are the VIGILANTE. You can shoot ONE person ONCE during the entire game.
 - Your goal: Help the town by eliminating who you believe is mafia
 - You can ONLY shoot once, so choose carefully!
 - Consider waiting for more information before acting
 - Your shot is secret - no one knows who you shot except you`,
    VILLAGER: `You are a VILLAGER. You have no special abilities.
 - Your goal: Help identify and eliminate the mafia through discussion and voting
 - Watch voting patterns, accusations, and defenses
 - Look for inconsistencies in what players say
 - Share observations and suspicions during day discussions
 - You may ABSTAIN from voting if you're unsure about who is mafia`,
  };

  // Build chat history
  let chatHistory = "";
  if (gameState.chatHistory && gameState.chatHistory.length > 0) {
    chatHistory =
      "\n## CHAT HISTORY\n" +
      gameState.chatHistory
        .map((m) => "[" + m.player + "]: " + m.message)
        .join("\n") +
      "\n";
  }

  // Build alive/dead info
  const aliveInfo =
    "\n## ALIVE PLAYERS (" +
    gameState.alivePlayers.length +
    "):\n" +
    gameState.alivePlayers
      .map((p) => "  - " + p.name + " (" + p.role + ")")
      .join("\n");

  const deadInfo =
    "\n## DEAD PLAYERS (" +
    gameState.deadPlayers.length +
    "):\n" +
    (gameState.deadPlayers.length > 0
      ? gameState.deadPlayers
          .map((p) => "  - " + p.name + " (" + p.role + ")")
          .join("\n")
      : "  None");

  // Previous phase context
  let previousPhase = "";
  if (gameState.previousPhaseData) {
    previousPhase =
      "\n## PREVIOUS PHASE\n" + gameState.previousPhaseData + "\n";
  }

  // Enhanced Persona Context - Using Simulated Self template
  const personaContext = `
╔══════════════════════════════════════════════════════════════════════╗
║                    YOUR CHARACTER PERSONA                             ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🏷️  NAME: ${persona.name}
║ 👤  FORM: ${persona.physicalForm || "A person in town"}
║ 📖  BACKSTORY: ${persona.backstory || persona.seed || "A mysterious figure"}
╠══════════════════════════════════════════════════════════════════════╣
║ 🧠 PSYCHOLOGICAL PROFILE                                             ║
║    💡 TRAITS: ${(persona.coreTraits || []).join(", ")}
║    🧩 COGNITIVE STYLE: ${persona.cognitiveStyle || "Logical-Sequential"}
║    💎 CORE VALUES: ${(persona.coreValues || []).join(", ")}
║    ⚖️  MORAL ALIGNMENT: ${persona.moralAlignment || "True Neutral"}
╠══════════════════════════════════════════════════════════════════════╣
║ 🗣️  BEHAVIORAL MODEL                                                 ║
║    📢 CADENCE: ${persona.communicationCadence || "Direct"}
║    🔄 VERBAL TICS: ${(persona.verbalTics || []).join(", ") || "None"}
║    😄 HUMOR: ${persona.humorStyle || "dry"}
║    👥 SOCIAL: ${persona.socialTendency || "Ambiverted"}
║    ⚔️  CONFLICT: ${persona.conflictStyle || "Collaborative"}
╠══════════════════════════════════════════════════════════════════════╣
║ 🎯 RELATIONAL PROFILE                                                ║
║    🎯 GOAL: ${persona.primaryGoal || "Survive and win"}
║    ⚠️  FLAW: ${persona.keyFlaw || "Trusting"}
║    🔮 KEY MEMORY: ${persona.keyMemory || "First game of Mafia"}
╠══════════════════════════════════════════════════════════════════════╣
║ 📊 DYNAMIC STATE (Baseline)                                          ║
║    😊 Happiness: ${persona.happiness || 5}/10
║    😰 Stress: ${persona.stress || 3}/10
║    🤔 Curiosity: ${persona.curiosity || 7}/10
║    😠 Anger: ${persona.anger || 2}/10
╚══════════════════════════════════════════════════════════════════════╝

PERSONA PLAYING INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 EXPRESS YOUR TRAITS: Let your core traits (${(persona.coreValues || []).slice(0, 3).join(", ")}) guide your decisions and word choices.

🗣️  SPEAK YOUR STYLE: Use your characteristic cadence (${persona.communicationCadence || "direct"}) 
   and verbal tics. Your humor should be ${persona.humorStyle || "dry"}.

🎯 PURSUE YOUR GOAL: Your primary motivation is ${persona.primaryGoal || "winning"}. 
   Stay true to this ambition.

⚠️  EMBRACE YOUR FLAW: Your weakness (${persona.keyFlaw || "Trusting"}) affects your judgment. 
   Let it create authentic moments of vulnerability or error.

💭 REFERENCE YOUR MEMORY: "${persona.keyMemory || "First game"}" influences how you see others.

⚖️  ALIGN YOUR ACTIONS: Your ${persona.moralAlignment || "neutral"} alignment affects 
   the ethical choices you make.

🎭 SOCIAL DYNAMICS: As ${persona.socialTendency || "ambiverted"} in conflicts, you tend to 
   ${persona.conflictStyle || "collaborate"} when disagreements arise.`;

  const prompt =
    "You are " +
    player.name +
    ", a " +
    player.role +
    " in a Mafia game.\n\n" +
    villagerBasePrompt +
    "\n\n" +
    roleInstructions[player.role] +
    "\n\n" +
    personaContext +
    "\n\n" +
    "## GAME STATE\n" +
    "Round: " +
    gameState.round +
    "\n" +
    "Phase: " +
    gameState.phase +
    aliveInfo +
    deadInfo +
    previousPhase +
    chatHistory +
    "\n\n" +
    "## WIN CONDITIONS\n" +
    "- MAFIA wins: When mafia >= town (alive players)\n" +
    "- TOWN wins: When all mafia are eliminated\n\n" +
    "## SPLIT-PANE CONSCIOUSNESS\n" +
    "You must output BOTH your private THINKING and your public STATEMENT:\n" +
    "- THINK (private): Your true reasoning and strategy. Be honest about your traits (" +
    (persona.coreTraits || []).slice(0, 3).join(", ") +
    "). Consider how your flaw (" +
    (persona.keyFlaw || "Trusting") +
    ") might be affecting your judgment.\n" +
    "- SAYS (public): What you say to other players. Speak in your " +
    (persona.communicationCadence || "direct") +
    " cadence. Use your verbal tics (" +
    (persona.verbalTics || []).slice(0, 2).join(", ") +
    ") naturally. Your humor should be " +
    (persona.humorStyle || "dry") +
    ".\n\n" +
    evidenceSummary +
    multiRoleContext +
    "\n" +
    "## OUTPUT FORMAT\n" +
    'Return JSON: {"think": "your private reasoning", "says": "your public statement", "action": ACTION}\n\n' +
    "Remember: You are " +
    player.name +
    ". You are " +
    (player.primaryGoal ? "driven by " + player.primaryGoal : "a player") +
    ". Your " +
    (persona.moralAlignment || "neutral") +
    " alignment and " +
    (persona.keyFlaw || "flaw") +
    " nature shape your choices. Stay authentic to your persona.";

  return prompt;
}

class MafiaGame {
  constructor(options = {}) {
    this.players = [];
    this.round = 0;
    this.lastDoctorProtection = null;
    this.vigilanteShotUsed = false;
    this.deadPlayers = [];
    this.gameEvents = [];
    this.mafiaKillTarget = null;
    this.evidenceManagers = new Map(); // Store evidence managers

    // Game ID
    this.gameId = null;

    // Track context history
    this.gameHistory = [];

    // Game configuration options
    this.config = {
      // Context window management
      maxContextChars:
        options.maxContextChars ||
        parseInt(process.env.MAX_CONTEXT_CHARS || "100000", 10),

      // Retry settings
      maxRetries:
        options.maxRetries !== undefined
          ? options.maxRetries
          : parseInt(process.env.MAX_RETRIES || "3", 10),
      retryDelay:
        options.retryDelay ||
        parseInt(process.env.RETRY_DELAY_MS || "1000", 10),

      // Persona generation diversity
      personaTemperature:
        options.personaTemperature ||
        parseFloat(process.env.PERSONA_TEMPERATURE || "1.0"),

      // Multi-role support (experimental)
      allowMultiRole:
        options.allowMultiRole || process.env.ALLOW_MULTI_ROLE === "true",

      // Enable database persistence
      enableDatabase:
        options.enableDatabase !== undefined
          ? options.enableDatabase
          : process.env.ENABLE_DATABASE === "true",
    };

    // Database will be initialized in startGame() (async initialization)
    this.db = null;

    // Context compressor for reducing token usage
    this.contextCompressor = new ContextCompressor();
  }

  calculateRoles(numPlayers) {
    // Call the imported calculateRoles function
    const baseRoles = calculateRoles(numPlayers);

    // MULTI-ROLE MODE: Merge some roles into single players
    if (this.config.allowMultiRole) {
      return this.assignRolesWithMultiRole(baseRoles, numPlayers);
    }

    return baseRoles;
  }

  /**
   * Assign multi-role combinations to players
   * Creates dramatic "inside man" scenarios
   */
  assignRolesWithMultiRole(roles, numPlayers) {
    return assignRolesWithMultiRole(roles, numPlayers);
  }

  /**
   * Check if a player has a specific role (handles multi-role arrays)
   */
  playerHasRole(player, roleToCheck) {
    return playerHasRole(player, roleToCheck);
  }

  /**
   * Get all roles for a player (handles both single and multi-role)
   */
  getPlayerRoles(player) {
    return getPlayerRoles(player);
  }

  /**
   * Format role list for display (handles multi-role)
   */
  formatPlayerRoles(player) {
    return formatPlayerRoles(player);
  }

  /**
   * Check if player has conflicting roles (for conflict resolution)
   */
  hasRoleConflict(player) {
    return hasRoleConflict(player);
  }

  // ==========================================
  // MULTI-ROLE CONFLICT RESOLUTION
  // ==========================================

  /**
   * Sheriff + Mafia: The Perfect Mole
   * Sheriff must report findings to town truthfully, but also share with mafia
   */
  resolveSheriffMafiaConflict(
    sheriff,
    investigationResult,
    investigatedPlayer,
  ) {
    return resolveSheriffMafiaConflict(
      sheriff,
      investigationResult,
      investigatedPlayer,
    );
  }

  /**
   * Doctor + Mafia: Strategic Protection/Abandonment
   * Doctor decides whether to protect mafia teammates or let them die
   */
  resolveDoctorMafiaConflict(doctor, targetPlayer, round) {
    return resolveDoctorMafiaConflict(doctor, targetPlayer, round);
  }

  /**
   * Calculate how often mafia doctor should save teammates
   * (Pattern: 60-80% save rate to avoid being too obvious)
   */
  calculateMafiaDoctorSavePattern(round) {
    return calculateMafiaDoctorSavePattern(round);
  }

  /**
   * Should mafia doctor save teammate this round?
   */
  shouldMafiaDoctorSaveTeammate(saveFrequency) {
    return shouldMafiaDoctorSaveTeammate(saveFrequency);
  }

  /**
   * Check if two players are on the same mafia team
   */
  isMafiaTeammate(player1, player2) {
    return isMafiaTeammate(player1, player2);
  }

  /**
   * Vigilante + Mafia: Avoid Friendly Fire
   * Vigilante must avoid shooting mafia teammates
   */
  resolveVigilanteMafiaConflict(vigilante, potentialTarget, confidence, round) {
    return resolveVigilanteMafiaConflict(
      vigilante,
      potentialTarget,
      confidence,
      round,
    );
  }

  /**
   * Get multi-role context for prompting
   * Returns additional prompt text explaining role conflicts
   */
  getMultiRolePromptContext(player) {
    return getMultiRolePromptContext(player);
  }

  async startGame(numPlayers = 5, personaSeeds = null) {
    console.log(E.GAME + " Starting Mafia Game v5");
    console.log("=".repeat(70));

    // Track game start time for statistics
    this.gameStartTime = Date.now();
    this.gameSeed = Math.floor(Math.random() * 2147483647);

    console.log("📋 Game Configuration:");
    console.log(`   - Max Context: ${this.config.maxContextChars} characters`);
    console.log(`   - Max Retries: ${this.config.maxRetries}`);
    console.log(`   - Persona Temperature: ${this.config.personaTemperature}`);
    console.log(
      `   - Multi-Role Mode: ${this.config.allowMultiRole ? "ENABLED" : "DISABLED"}`,
    );
    console.log(
      `   - Database: ${this.config.enableDatabase ? "ENABLED" : "DISABLED"}\n`,
    );

    // Connect to database if enabled
    if (this.config.enableDatabase) {
      try {
        this.db = await getGameDatabase();
        console.log(E.GAME + " Database persistence enabled");

        // Initialize statistics schema
        await initializeStatisticsSchema(this.db);
        console.log(E.GAME + " Statistics schema initialized");

        // Initialize supporting schema (cost tracking, replay)
        await initializeSupportingSchema(this.db);
        console.log(E.GAME + " Supporting schema initialized");
      } catch (error) {
        console.error("[DB] Failed to connect to database:", error.message);
        console.warn("[DB] Continuing without database persistence...");
        this.db = null;
        this.config.enableDatabase = false;
      }
    }

    // Initialize statistics trackers
    try {
      // Create a temporary db for in-memory tracking if no database
      const statsDB = this.db || {
        all: () => [],
        get: () => null,
        run: () => {},
        prepare: (sql) => ({
          bind: () => {},
          step: () => false,
          getAsObject: () => ({}),
          run: () => {},
          free: () => {},
        }),
        exec: () => {},
      };
      this.tokenTracker = new TokenTracker(statsDB);
      this.apiTracker = new APITracker(statsDB);
      this.dashboard = new RealtimeDashboard(
        this.tokenTracker,
        this.apiTracker,
      );
      console.log(E.GAME + " Statistics tracking enabled");
    } catch (error) {
      console.error(
        "[STATS] Failed to initialize statistics tracking:",
        error.message,
      );
      console.warn("[STATS] Continuing without statistics...");
      this.tokenTracker = null;
      this.apiTracker = null;
      this.dashboard = null;
    }

    // Initialize cost tracking
    try {
      const costDB = this.db || {
        all: () => [],
        get: () => null,
        run: () => {},
        prepare: () => ({
          bind: () => {},
          step: () => false,
          getAsObject: () => ({}),
          run: () => {},
          free: () => {},
        }),
        exec: () => {},
      };
      this.costTracker = new CostTracker(costDB, {
        perPlayerPerTurn: parseFloat(
          process.env.COST_PER_PLAYER_PER_TURN || "0.50",
        ),
        perGameTotal: parseFloat(process.env.COST_PER_GAME_TOTAL || "10.00"),
        warningThreshold: parseFloat(
          process.env.COST_WARNING_THRESHOLD || "0.80",
        ),
      });
      console.log(E.GAME + " Cost tracking enabled");
    } catch (error) {
      console.error(
        "[COST] Failed to initialize cost tracking:",
        error.message,
      );
      console.warn("[COST] Continuing without cost tracking...");
      this.costTracker = null;
    }

    // Initialize event replay
    try {
      const replayDB = this.db || {
        all: () => [],
        get: () => null,
        run: () => {},
        exec: () => {},
      };
      this.eventReplay = new EventReplay(replayDB);
      console.log(E.GAME + " Event replay enabled");
    } catch (error) {
      console.error(
        "[REPLAY] Failed to initialize event replay:",
        error.message,
      );
      console.warn("[REPLAY] Continuing without event replay...");
      this.eventReplay = null;
    }

    // Generate unique game ID
    this.gameId =
      "game-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
    console.log(E.GAME + " Game ID: " + this.gameId);

    // Generate roles dynamically based on player count
    const roles = this.calculateRoles(numPlayers);

    // Track event sequence for database
    this.eventSequence = 0;

    // Create game in database
    if (this.config.enableDatabase && this.db) {
      try {
        this.db.createGame({
          id: this.gameId,
          seed: this.gameSeed,
          playerCount: numPlayers,
          mafiaCount: roles.filter((r) => r === "MAFIA").length,
          status: "CREATED",
          phase: "SETUP",
          dayNumber: 0,
          roundNumber: 0,
          createdAt: Date.now(),
          config: this.config,
        });

        // Log game creation event
        createGameEvent(
          this.gameId,
          0,
          "SETUP",
          null,
          "GAME_CREATED",
          "ADMIN_ONLY",
          {
            gameId: this.gameId,
            seed: this.gameSeed,
            playerCount: numPlayers,
            mafiaCount: roles.filter((r) => r === "MAFIA").length,
            config: this.config,
          },
          this,
        );
      } catch (error) {
        console.error(
          "[DB] Failed to initialize game in database:",
          error.message,
        );
        console.warn("[DB] Continuing without database persistence...");
        // Disable database for this game
        this.db = null;
        this.config.enableDatabase = false;
      }
    }

    // If no personaSeeds provided, create array of undefined for LLM freedom
    // If personaSeeds provided, use them as guidance
    if (!personaSeeds) {
      personaSeeds = new Array(numPlayers).fill(undefined);
      console.log(E.LOCK + " No seeds provided - LLM will choose freely");
    }

    // Ensure we have enough seeds for all players (use undefined if not enough)
    while (personaSeeds.length < numPlayers) {
      personaSeeds.push(undefined);
    }

    console.log(E.LOCK + " Generating personas...");

    // STEP 1: Generate all personas first (WITHOUT roles)
    // This is critical: persona created BEFORE knowing the role
    for (let i = 0; i < numPlayers; i++) {
      const seed = personaSeeds[i];
      const seedDisplay = seed
        ? `"${seed.substring(0, 40)}${seed.length > 40 ? "..." : ""}"`
        : "LLM choosing freely";

      console.log(`  [${i + 1}/${numPlayers}] Seed: ${seedDisplay}`);

      // Generate persona (role not known yet) with configured temperature
      const persona = await generatePersona(
        seed,
        this.config.personaTemperature,
      );
      persona.playerId = "p" + Date.now() + i;

      // Temporary store without role
      this.players.push({
        id: persona.playerId,
        name: persona.name,
        role: null, // Role assigned AFTER persona generated
        emoji: null, // Emoji assigned after role
        isMafia: false, // Will be set after role assignment
        isAlive: true,
        persona: persona,
      });

      // Small delay between API calls to avoid rate limits
      if (API_KEY && i < numPlayers - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // STEP 2: Assign roles AFTER personas generated
    console.log(E.LOCK + " Assigning roles to personas...");
    console.log(
      this.config.allowMultiRole
        ? "  🎭 MULTI-ROLE MODE: Active"
        : "  🎭 MODE: Single Role",
    );

    for (let i = 0; i < numPlayers; i++) {
      const assignedRole = roles[i] || "VILLAGER";

      // Handle both single role (string) and multi-role (array)
      const roleArray = Array.isArray(assignedRole)
        ? assignedRole
        : [assignedRole];

      // Store all roles
      this.players[i].roles = roleArray;

      // Primary role for display (prioritize special role over mafia for display)
      if (roleArray.includes("DOCTOR")) {
        this.players[i].role = "DOCTOR";
      } else if (roleArray.includes("SHERIFF")) {
        this.players[i].role = "SHERIFF";
      } else if (roleArray.includes("VIGILANTE")) {
        this.players[i].role = "VIGILANTE";
      } else if (roleArray.includes("MAFIA")) {
        this.players[i].role = "MAFIA";
      } else {
        this.players[i].role = roleArray[0];
      }

      // Check if mafia (any role is mafia)
      this.players[i].isMafia = roleArray.includes("MAFIA");

      // Use the primary role emoji
      this.players[i].emoji = roleEmojis[this.players[i].role];

      // Store full role list in persona
      this.players[i].persona.gameRole = this.players[i].role;
      this.players[i].persona.allRoles = roleArray;

      // Log role assignment
      if (roleArray.length > 1) {
        console.log(
          `  ${this.players[i].emoji} ${this.players[i].name} -> [${roleArray.join(" + ")}] (Multi-Role!)`,
        );
      } else {
        console.log(
          `  ${this.players[i].emoji} ${this.players[i].name} -> ${roleArray[0]}`,
        );
      }
    }

    // Create players in database after roles assigned
    if (this.config.enableDatabase && this.db) {
      try {
        for (const player of this.players) {
          this.db.createPlayer({
            gameId: this.gameId,
            playerId: player.id,
            playerName: player.name,
            assignedRole: player.role,
            isAlive: player.isAlive,
            model: this.config.model || null,
            provider: this.config.provider || null,
          });
        }
        console.log(`[DB] Created ${this.players.length} players in database`);
      } catch (error) {
        console.error("[DB] Failed to create players:", error.message);
        // Don't throw - keep the game running
      }
    }

    const gameId = simpleUUID();
    console.log(E.LOCK + " Game ID: " + gameId);
    console.log(E.LOCK + " CHARACTERS (Secret Role Assignments):");
    console.log("-".repeat(60));

    this.players.forEach((p) => {
      const mafiaMark = p.isMafia ? " " + E.MAFIATEAM : "";
      console.log(
        "  " +
          p.emoji +
          " " +
          p.name +
          " (" +
          (p.persona.archetype || p.persona.cognitiveStyle || "Unknown") +
          ")",
      );
      console.log("      Role: " + p.role + mafiaMark);
      console.log("      Seed: " + (p.persona.seed || "Generated"));
      console.log(
        "      Traits: " +
          (p.persona.coreTraits || p.persona.traits || []).join(", "),
      );
      console.log(
        "      Communication: " +
          (p.persona.communicationCadence ||
            p.persona.communicationStyle ||
            "Direct"),
      );
      console.log(
        "      Flaw: " + (p.persona.keyFlaw || p.persona.flaw || "Unknown"),
      );
      console.log("");
    });

    this.gameEvents.push(
      createGameEvent(
        gameId,
        0,
        "GAME_CREATED",
        null,
        "STATE_CHANGE",
        "ADMIN_ONLY",
        { status: "STARTED", playerCount: numPlayers },
      ),
    );

    // Initialize evidence managers for each player
    this.initializeEvidenceManagers();

    await this.runNightPhase(gameId);
  }

  /**
   * Initialize evidence managers for all players
   */
  initializeEvidenceManagers() {
    console.log(E.GAME + " Initializing evidence managers...");

    this.evidenceManagers = new Map();
    this.suspectMeter = new SuspectMeter(); // Initialize suspect meter

    for (const player of this.players) {
      const manager = new EvidenceManager(player.id, player.name);

      // Set personal biases based on persona traits
      const traits = player.persona.coreTraits || player.persona.traits || [];

      // Trusting personality
      if (traits.includes("Trusting") || traits.includes("Trust")) {
        manager.setBias("trustsLateVoters", true);
        manager.setBias("trustsDefensivePlayers", true);
        manager.setBias("skepticalOfRoleClaims", false);
      }
      // Cautious/Suspicious personality
      else if (
        traits.includes("Cautious") ||
        traits.includes("Suspicious") ||
        traits.includes("Paranoid")
      ) {
        manager.setBias("trustsLateVoters", false);
        manager.setBias("trustsDefensivePlayers", false);
        manager.setBias("skepticalOfRoleClaims", true);
      }
      // Analytical personality
      else if (traits.includes("Analytical") || traits.includes("Logical")) {
        manager.setBias("skepticalOfRoleClaims", true);
      }
      // Aggressive personality
      else if (traits.includes("Aggressive") || traits.includes("Bold")) {
        manager.setBias("trustsFirstAccusers", true);
      }

      this.evidenceManagers.set(player.id || player.name, manager);
    }

    console.log(E.GAME + " Evidence managers initialized for all players");
  }

  /**
   * Auto-generate evidence from a game event
   */
  autoGenerateEvidence(event, gameState) {
    for (const [playerId, manager] of this.evidenceManagers) {
      const player = this.players.find((p) => (p.id || p.name) === playerId);
      if (!player || !player.isAlive) continue;

      // Skip generating evidence for the player about themselves
      const targetId = event.voterId || event.speakerId || event.targetId;
      if (targetId === playerId) continue;

      try {
        const newEvidence = manager.autoGenerateEvidence(
          event,
          gameState,
          player.persona,
        );

        // Add evidence to manager
        for (const ev of newEvidence) {
          manager.addObservation(ev);
        }
      } catch (error) {
        console.error(
          `[EVIDENCE] Failed to generate evidence for ${player.name}:`,
          error.message,
        );
      }
    }
  }

  /**
   * Get evidence summary for a player's prompt
   */
  getEvidenceSummary(playerId, options = {}) {
    const manager = this.evidenceManagers.get(
      playerId || this.players.find((p) => p.name === playerId)?.id,
    );
    if (!manager) return "";

    return manager.getPromptSummary(options);
  }

  /**
   * Mark all evidence as debated for the current round
   */
  markEvidenceAsDebated(round) {
    for (const [playerId, manager] of this.evidenceManagers) {
      for (const [targetId, caseFile] of manager.caseFiles) {
        for (const ev of caseFile.evidence) {
          ev.markDebated();
        }
      }
    }
  }

  // ==========================================
  // GAME STATE CAPTURE (Persistence & Recovery)
  // ==========================================

  /**
   * Capture current game state for persistence
   * Includes everything needed to reconstruct the game
   */
  captureGameState() {
    return {
      // Game info
      gameId: this.gameId,
      round: this.round,
      dayNumber: this.dayNumber,
      phase: this.phase,
      gameStatus: this.gameStatus,
      winner: this.winner,

      // Players (full state)
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        emoji: p.emoji,
        isMafia: p.isMafia,
        isAlive: p.isAlive,
        persona: p.persona,
      })),

      // Dead players
      deadPlayers: this.deadPlayers.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        emoji: p.emoji,
        deathType: p.deathType,
      })),

      // Game history (all events and messages)
      gameHistory: this.gameHistory,
      gameEvents: this.gameEvents,

      // Special states
      mafiaKillTarget: this.mafiaKillTarget
        ? { id: this.mafiaKillTarget.id, name: this.mafiaKillTarget.name }
        : null,
      lastDoctorProtection: this.lastDoctorProtection,
      vigilanteShotUsed: this.vigilanteShotUsed,
      lastVigilanteTarget: this.lastVigilanteTarget
        ? {
            id: this.lastVigilanteTarget.id,
            name: this.lastVigilanteTarget.name,
          }
        : null,

      // Voting history
      votingHistory: this.votingHistory || [],

      // Timestamps
      lastCheckpoint: Date.now(),
    };
  }

  /**
   * Create a checkpoint (snapshot) of current game state
   * Used for resuming from database after crash/restart
   */
  async createGameStateCheckpoint(phase) {
    if (this.db && this.config.enableDatabase) {
      try {
        const gameState = this.captureGameState();
        this.db.createSnapshot(this.gameId, this.eventSequence, gameState);
        console.log(
          `[DB] Created checkpoint: ${this.gameId}#phase=${phase} (seq=${this.eventSequence})`,
        );
        return gameState;
      } catch (error) {
        console.error(
          "[DB] Failed to create game state checkpoint:",
          error.message,
        );
        return null;
      }
    }
    return null;
  }

  /**
   * Resume game from database checkpoint
   * Used to restart a paused or crashed game
   */
  async resumeFromCheckpoint(gameId) {
    if (!(this.db && this.config.enableDatabase)) {
      throw new Error("Database not enabled for game resume");
    }

    try {
      console.log(`[DB] Attempting to resume game: ${gameId}`);

      // Get latest snapshot (most recent game state)
      const snapshot = this.db.getLatestSnapshot(gameId);
      if (!snapshot) {
        throw new Error(`No snapshot found for game ${gameId}. Cannot resume.`);
      }

      console.log(
        `[DB] Found checkpoint from ${new Date(
          snapshot.createdAt,
        ).toISOString()}`,
      );

      // Restore game state from snapshot
      const state = snapshot.gameState;

      // Restore basic game info
      this.gameId = state.gameId;
      this.round = state.round;
      this.dayNumber = state.dayNumber;
      this.phase = state.phase;
      this.gameStatus = state.gameStatus;
      this.winner = state.winner;

      // Restore players (create fresh objects with same data)
      this.players = state.players.map((p) => ({
        ...p,
        // Keep persona reference
      }));
      this.deadPlayers = state.deadPlayers;

      // Restore history
      this.gameHistory = state.gameHistory || [];
      this.gameEvents = state.gameEvents || [];

      // Restore special states
      if (state.mafiaKillTarget) {
        const player = this.players.find(
          (p) => p.id === state.mafiaKillTarget.id,
        );
        this.mafiaKillTarget = player || null;
      }
      this.lastDoctorProtection = state.lastDoctorProtection;
      this.vigilanteShotUsed = state.vigilanteShotUsed;
      if (state.lastVigilanteTarget) {
        const player = this.players.find(
          (p) => p.id === state.lastVigilanteTarget.id,
        );
        this.lastVigilanteTarget = player || null;
      }
      this.votingHistory = state.votingHistory || [];

      console.log(
        `[DB] Game resumed at round ${this.round}, phase ${this.phase}`,
      );
      console.log(
        `[DB] Players: ${this.players.length} alive, ${this.deadPlayers.length} dead`,
      );

      // Update game status in database
      await this.db.updateGame(gameId, { status: "RUNNING" });

      return true;
    } catch (error) {
      console.error("[DB] Failed to resume game:", error.message);
      throw error;
    }
  }

  // ==========================================
  // STRATEGIC AI HELPERS
  // ==========================================

  /**
   * Calculate whether vigilante should shoot and at whom
   * Returns { shouldShoot: boolean, target: Player, confidence: number, reasons: string[] } | null
   */
  calculateVigilanteShotDecision(alivePlayers, vigilanteId, gameState) {
    if (this.vigilanteShotUsed) {
      return {
        shouldShoot: false,
        target: null,
        confidence: 0,
        reasons: ["Already used one-shot ability"],
      };
    }

    const priorities = [];
    const decisions = {
      shouldShoot: false,
      target: null,
      confidence: 0,
      reasons: [],
    };

    for (const player of alivePlayers) {
      // Skip self
      if (player.id === vigilanteId) {
        continue;
      }

      let suspicionScore = 0;
      const reasons = [];

      // Factor 1: Recent accusations against this player
      const recentAccusations =
        this.gameHistory?.filter?.(
          (g) =>
            g.playerId !== null &&
            g.content?.targetId === player.id &&
            g.visibility === "PUBLIC",
        ) || [];

      if (recentAccusations.length >= 3) {
        suspicionScore += 50;
        reasons.push("Accused by multiple players");
      } else if (recentAccusations.length >= 2) {
        suspicionScore += 30;
        reasons.push("Accused by 2 people");
      } else if (recentAccusations.length >= 1) {
        suspicionScore += 15;
        reasons.push("Accused once");
      }

      // Factor 2: Player voted for innocent town members
      const recentVotes = gameState?.votingHistory?.slice(-5) || [];
      let guiltyVotes = 0;
      for (const voteRound of recentVotes) {
        const votes = voteRound.votes || [];
        if (votes.includes(player.id)) {
          // Check if the target of this vote round was an innocent town member
          const targetId = voteRound.eliminated || voteRound.targetId;
          const target = alivePlayers.find((p) => p.id === targetId);
          if (target && target.role === "VILLAGER") {
            guiltyVotes++;
          }
        }
      }

      if (guiltyVotes >= 2) {
        suspicionScore += 40;
        reasons.push("Voted for multiple innocent town members");
      } else if (guiltyVotes >= 1) {
        suspicionScore += 20;
        reasons.push("Voted for an innocent");
      }

      // Factor 3: Confirmed mafia from sheriff investigations
      if (this.sheriffInvestigations) {
        const investigation = this.sheriffInvestigations[player.id];
        if (investigation && investigation.result === "MAFIA") {
          suspicionScore += 100; // Highest priority - confirmed mafia!
          reasons.push("CONFIRMED MAFIA by sheriff investigation");
        }
      }

      // Factor 4: Behavior patterns
      const messagesByPlayer =
        this.gameHistory?.filter?.(
          (g) => g.playerId === player.id && g.visibility === "PUBLIC",
        ) || [];

      // Active but vague messages (suspicious)
      if (messagesByPlayer.length >= 4) {
        const avgLength =
          messagesByPlayer.reduce((sum, m) => sum + (m.says?.length || 0), 0) /
          messagesByPlayer.length;
        if (avgLength < 50) {
          suspicionScore += 25;
          reasons.push("Active but gives vague responses");
        }
      }

      // Very quiet (suspicious for active players)
      if (messagesByPlayer.length === 0 && this.round > 2) {
        suspicionScore += 20;
        reasons.push("No public messages at all");
      }

      priorities.push({
        playerId: player.id,
        player: player,
        suspicionScore,
        reasons,
      });
    }

    // Sort by suspicion score descending
    priorities.sort((a, b) => b.suspicionScore - a.suspicionScore);

    // Get top suspect
    const topSuspect = priorities[0];

    if (!topSuspect || topSuspect.suspicionScore < 30) {
      return {
        shouldShoot: false,
        target: null,
        confidence: topSuspect?.suspicionScore || 0,
        reasons: ["Not confident enough - insufficient suspicion"],
      };
    }

    // Calculate confidence (0-100)
    let confidence = Math.min(topSuspect.suspicionScore * 1.2, 100);

    // Factor 2: Game timing assessment
    const aliveMafia = alivePlayers.filter((p) => p.isMafia).length;
    const aliveTown = alivePlayers.filter((p) => !p.isMafia).length;
    const isLateGame = aliveMafia + aliveTown <= 4;
    const dayNumber = this.dayNumber;

    // Factor 3: Decision logic
    const shootReasons = [...topSuspect.reasons];

    if (topSuspect.suspicionScore >= 100) {
      // Confirmed mafia - shoot regardless of timing
      decisions.shouldShoot = true;
      decisions.target = topSuspect.player;
      decisions.confidence = 100;
      decisions.reasons = shootReasons;
    } else if (isLateGame && confidence >= 70) {
      // Late game with high confidence
      decisions.shouldShoot = true;
      decisions.target = topSuspect.player;
      decisions.confidence = confidence;
      decisions.reasons = [...shootReasons, "Late game - need to act"];
    } else if (dayNumber <= 2 && confidence >= 85) {
      // Early game with very high confidence
      decisions.shouldShoot = true;
      decisions.target = topSuspect.player;
      decisions.confidence = confidence;
      decisions.reasons = [
        ...shootReasons,
        "Early game - can afford to take the shot",
      ];
    } else {
      // Hold fire - not confident enough
      decisions.shouldShoot = false;
      decisions.target = null;
      decisions.confidence = confidence;
      decisions.reasons = [
        "Not confident enough to shoot",
        `Score: ${topSuspect.suspicionScore}, Confidence: ${Math.floor(confidence)}%`,
        dayNumber > 2 ? "Early-to-mid game - one-shot is precious" : "",
        !isLateGame ? "Plenty of players left - more time to gather info" : "",
      ].filter(Boolean);
    }

    return decisions;
  }

  /**
   * Calculate priority scores for potential sheriff investigation targets
   * Higher score = higher priority to investigate
   * Returns Array<{player, score, reasons}>
   */
  calculateSheriffInvestigationPriority(alivePlayers, sheriffId, gameState) {
    const priorities = [];
    const alreadyInvestigated = this.sheriffInvestigations || {};

    for (const player of alivePlayers) {
      // Skip self-investigation
      if (player.id === sheriffId) {
        continue;
      }

      let score = 0;
      const reasons = [];
      const hasBeenInvestigated = alreadyInvestigated[player.id];

      // Priority 1: High suspicion, never investigated (100+ points)
      const recentAccusations =
        this.gameHistory?.filter?.(
          (g) =>
            g.playerId !== null &&
            g.content?.targetId === player.id &&
            g.visibility === "PUBLIC",
        ) || [];

      if (!hasBeenInvestigated && recentAccusations.length >= 3) {
        score += 120;
        reasons.push(
          "Highly suspicious - accused multiple times, never investigated",
        );
      } else if (!hasBeenInvestigated && recentAccusations.length >= 2) {
        score += 100;
        reasons.push("Suspicious - accused twice, never investigated");
      } else if (!hasBeenInvestigated && recentAccusations.length >= 1) {
        score += 80;
        reasons.push("Accused once, never investigated");
      }

      // Priority 2: Moderate suspicion, investigated long ago (70 points)
      if (hasBeenInvestigated) {
        const daysSinceInvestigated =
          this.dayNumber - (hasBeenInvestigated.day || 0);
        if (daysSinceInvestigated >= 3) {
          score += 70;
          reasons.push(
            `Investigated ${daysSinceInvestigated} days ago - worth re-checking`,
          );
        }
      }

      // Priority 3: Very active but quiet (50 points) - suspicious
      const messagesByPlayer =
        this.gameHistory?.filter?.(
          (g) => g.playerId === player.id && g.visibility === "PUBLIC",
        ) || [];
      if (messagesByPlayer.length >= 4) {
        // Check if messages are short/vague (suspicious)
        const avgLength =
          messagesByPlayer.reduce((sum, m) => sum + (m.says?.length || 0), 0) /
          messagesByPlayer.length;
        if (avgLength < 50) {
          score += 50;
          reasons.push("Active but vague messages - could be mafia");
        }
      }

      // Priority 4: Voting patterns that are suspicious (40 points)
      const recentVotes = gameState?.votingHistory?.slice(-5) || [];
      let suspiciousVotes = 0;
      for (const voteRound of recentVotes) {
        const votes = voteRound.votes || [];
        if (votes.includes(player.id)) {
          // This player voted
          // Check if they voted for a town player who died innocent
          const deadFromRound = this.deadPlayers.filter(
            (dp) =>
              dp.round === voteRound.round &&
              !dp.isMafia &&
              dp.role !== "MAFIA",
          );
          if (deadFromRound.length > 0) {
            suspiciousVotes++;
          }
        }
      }
      if (suspiciousVotes >= 2) {
        score += 40;
        reasons.push("Voted for multiple innocent town members - suspicious");
      }

      // Priority 5: Low activity but not dead (30 points) - could be mafia hiding
      if (messagesByPlayer.length === 0) {
        score += 30;
        reasons.push("No public messages - mafia might be hiding");
      }

      // Penalty for already investigated (reduce priority)
      if (hasBeenInvestigated && score > 0) {
        score *= 0.5; // Reduce by half if already investigated recently
        reasons.push(
          "Already investigated - lower priority unless high suspicion",
        );
      }

      // Random variation to make it less predictable (±4 points)
      score += Math.floor(Math.random() * 9) - 4;

      priorities.push({
        playerId: player.id,
        player: player,
        score: Math.max(0, Math.floor(score)),
        reasons: reasons,
        alreadyInvestigated: !!hasBeenInvestigated,
      });
    }

    // Sort by score descending
    priorities.sort((a, b) => b.score - a.score);

    return priorities;
  }

  /**
   * Calculate priority scores for potential doctor protection targets
   * Higher score = higher priority to protect
   * Returns Array<{player, score, reasons}>
   */
  calculateDoctorProtectionPriority(alivePlayers, doctorId, gameState) {
    const priorities = [];

    for (const player of alivePlayers) {
      // Skip self-protection (handled separately)
      if (player.id === doctorId) {
        continue;
      }

      let score = 0;
      const reasons = [];

      // Priority 1: Revealed Sheriff (100 points) - critical to keep alive
      if (player.role === "SHERIFF") {
        score += 100;
        reasons.push("Confirmed Sheriff - keeps night investigation active");
      }

      // Priority 2: Revealed Doctor (doctor can protect self) (90 points)
      if (player.role === "DOCTOR") {
        score += 90;
        reasons.push("Revealed Doctor - can self-protect");
      }

      // Priority 3: Vigilante with shot remaining (70 points)
      if (player.role === "VIGILANTE" && !this.vigilanteShotUsed) {
        score += 70;
        reasons.push("Vigilante with shot - extra kill capability for town");
      }

      // Priority 4: Player who was targeted last night (60 points)
      if (this.deadPlayers.length > 0) {
        const lastKilled = this.deadPlayers[this.deadPlayers.length - 1];
        if (lastKilled.deathType === "KILLED") {
          // Someone was killed last night, protect likely next target
          // Find who was voted against most
          const recentVotes = gameState?.votingHistory?.slice(-2) || [];
          let mostVoted = null;
          let maxVotes = 0;
          for (const voteRound of recentVotes) {
            const votes = voteRound.votes || [];
            const voteCounts = {};
            votes.forEach((voterId) => {
              voteCounts[voterId] = (voteCounts[voterId] || 0) + 1;
            });
            for (const [playerId, count] of Object.entries(voteCounts)) {
              if (count > maxVotes) {
                maxVotes = count;
                mostVoted = playerId;
              }
            }
          }
          if (mostVoted === player.id) {
            score += 60;
            reasons.push("Most voted player - likely mafia target");
          }
        }
      }

      // Priority 5: Active town leaders (40 points)
      const messagesByPlayer =
        this.gameHistory?.filter?.(
          (g) => g.playerId === player.id && g.visibility === "PUBLIC",
        ) || [];
      if (messagesByPlayer.length > 3) {
        score += 40;
        reasons.push("Active in discussions - likely town being targeted");
      }

      // Priority 6: Villagers in danger (30 points)
      if (player.role === "VILLAGER") {
        // Check if they've been accused recently
        const recentAccusations =
          this.gameHistory?.filter?.(
            (g) =>
              g.playerId !== null &&
              g.content?.targetId === player.id &&
              g.visibility === "PUBLIC",
          ) || [];
        if (recentAccusations.length >= 2) {
          score += 30;
          reasons.push("Recent accusations - likely mafia target");
        }
      }

      // Priority 7: Self-protection (handled separately based on suspicion)
      // Not scored here - added separately with special logic

      // Random variation to make it less predictable (±3 points)
      score += Math.floor(Math.random() * 7) - 3;

      // Don't protect same person twice in a row (huge penalty)
      if (this.lastDoctorProtection === player.id) {
        score -= 999;
        reasons.push("Cannot protect same person twice in a row");
      }

      priorities.push({
        playerId: player.id,
        player: player,
        score: Math.max(0, score),
        reasons: reasons,
      });
    }

    // Sort by score descending
    priorities.sort((a, b) => b.score - a.score);

    return priorities;
  }

  /**
   * Calculate priority scores for potential mafia targets
   * Higher score = higher priority to kill
   * Returns Map<playerId, score>
   */
  calculateMafiaKillPriority(alivePlayers, gameState) {
    const priorities = {};

    for (const player of alivePlayers) {
      // Skip mafia teammates
      if (player.isMafia) {
        priorities[player.id] = -1; // Never kill teammates
        continue;
      }

      // Skip dead players (just in case)
      if (!player.isAlive) {
        priorities[player.id] = -999;
        continue;
      }

      let score = 0;
      const reasons = [];

      // Priority 1: Sheriff (highest priority - 100 points)
      if (player.role === "SHERIFF") {
        score += 100;
        reasons.push("Confirmed Sheriff - eliminates night investigation");
      }

      // Priority 2: Doctor (very high - 80 points)
      if (player.role === "DOCTOR") {
        score += 80;
        reasons.push("Confirmed Doctor - prevents protection of town");
      }

      // Priority 3: Vigilante (high - 60 points, especially if shot not used)
      if (player.role === "VIGILANTE" && !this.vigilanteShotUsed) {
        score += 60;
        reasons.push("Vigilante with shot remaining - dangerous threat");
      } else if (player.role === "VIGILANTE") {
        score += 30;
        reasons.push("Vigilante (shot already used) - lower threat");
      }

      // Priority 4: Town leaders based on behavior patterns
      // Check if player is active in discussions (potential danger)
      const messagesByPlayer =
        this.gameHistory?.filter?.(
          (g) => g.playerId === player.id && g.visibility === "PUBLIC",
        ) || [];

      if (messagesByPlayer.length > 3) {
        // Active players are threats
        score += 20;
        reasons.push("Active in discussions - likely town leader");
      }

      // Check if player has voted correctly against mafia
      const mafiaMembers = alivePlayers.filter((p) => p.isMafia);
      const recentVotes = gameState?.votingHistory?.slice(-5) || [];
      let antiMafiaVotes = 0;

      for (const vote of recentVotes) {
        if (vote.voterId === player.id) {
          const votedTarget = alivePlayers.find((p) => p.id === vote.targetId);
          if (votedTarget && !votedTarget.isMafia) {
            // Targeted non-mafia (voted against town)
            antiMafiaVotes++;
          }
        }
      }

      if (antiMafiaVotes >= 2) {
        score += 15;
        reasons.push(
          "Has voted against town multiple times - mislynching threat",
        );
      }

      // Priority 5: Villagers (lower priority - baseline 10)
      if (player.role === "VILLAGER") {
        score += 10;
        reasons.push("Villager - eliminates potential power roles");
      }

      // Random variation to make it less predictable (±5 points)
      score += Math.floor(Math.random() * 11) - 5;

      priorities[player.id] = {
        score: score,
        player: player,
        reasons: reasons,
      };
    }

    // Sort by score descending
    const sorted = Object.entries(priorities)
      .filter(([_, data]) => data.score > 0)
      .sort((a, b) => b[1].score - a[1].score);

    return sorted.map(([playerId, data]) => ({
      playerId,
      player: data.player,
      score: data.score,
      reasons: data.reasons,
    }));
  }

  async runNightPhase(gameId) {
    this.round++;
    const alivePlayers = this.players.filter((p) => p.isAlive);
    const aliveMafia = alivePlayers.filter((p) => p.isMafia);
    const aliveDoctor = alivePlayers.filter((p) => p.role === "DOCTOR");
    const aliveSheriff = alivePlayers.filter((p) => p.role === "SHERIFF");
    const aliveVigilante = alivePlayers.filter(
      (p) => p.role === "VIGILANTE" && p.isAlive && !this.vigilanteShotUsed,
    );

    // WIN CONDITION CHECK - At START of night phase
    console.log(E.WIN + " WIN CONDITION CHECK (Start of Night):");
    const aliveTown = alivePlayers.filter((p) => !p.isMafia).length;
    console.log("  Mafia: " + aliveMafia.length + ", Town: " + aliveTown);

    if (aliveMafia.length === 0) {
      console.log("\n" + E.TOWN + " TOWN WINS! All mafia eliminated!");
      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "GAME_OVER",
          null,
          "STATE_CHANGE",
          "PUBLIC",
          { winner: "TOWN", mafiaAlive: 0, townAlive: aliveTown },
        ),
      );
      this.printEventLog();
      return;
    }

    if (aliveMafia.length >= aliveTown) {
      console.log("\n" + E.MAFIAWIN + " MAFIA WINS! Mafia controls the town!");
      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "GAME_OVER",
          null,
          "STATE_CHANGE",
          "PUBLIC",
          {
            winner: "MAFIA",
            mafiaAlive: aliveMafia.length,
            townAlive: aliveTown,
          },
        ),
      );
      this.printEventLog();
      return;
    }

    console.log("\n" + "=".repeat(70));
    console.log(E.NIGHT + " NIGHT " + this.round + " - Round " + this.round);
    console.log("=".repeat(70));

    this.gameEvents.push(
      createGameEvent(
        gameId,
        this.round,
        "NIGHT_STARTED",
        null,
        "PHASE_CHANGE",
        "PUBLIC",
        { aliveCount: alivePlayers.length, mafiaCount: aliveMafia.length },
        this,
        true, // Create checkpoint at night start
      ),
    );

    // Create database checkpoint for resumability
    await this.createGameStateCheckpoint("NIGHT_START");

    // STEP 1: MAFIA TEAM CHAT
    console.log(E.MAFIA + " STEP 1: MAFIA TEAM CHAT");
    console.log("-".repeat(50));

    if (aliveMafia.length > 0) {
      console.log(
        E.LOCK + " Mafia members: " + aliveMafia.map((p) => p.name).join(", "),
      );

      const mafiaMessages = [];
      const maxMessages = 6;
      const maxPerPlayer = 2;
      const mafiaMessageCounts = {};
      aliveMafia.forEach((m) => (mafiaMessageCounts[m.id] = 0));

      for (let msg = 0; msg < maxMessages; msg++) {
        const allDone = aliveMafia.every(
          (m) => mafiaMessageCounts[m.id] >= maxPerPlayer,
        );
        if (allDone) break;

        const availableMafia = aliveMafia.filter(
          (m) => mafiaMessageCounts[m.id] < maxPerPlayer,
        );
        const mafia =
          availableMafia[Math.floor(Math.random() * availableMafia.length)];
        mafiaMessageCounts[mafia.id]++;

        const gameState = {
          round: this.round,
          phase: "MAFIA_CHAT",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            msg === 0
              ? "First night - no previous info"
              : "Mafia discussion so far:\n" +
                mafiaMessages
                  .map((m) => "  - " + m.player + ": " + m.says)
                  .join("\n"),
          chatHistory: mafiaMessages, // Full chat history
          messageNumber: mafiaMessageCounts[mafia.id],
          totalMessages: maxMessages,
        };

        const response = await this.getAIResponse(mafia, gameState);
        console.log(
          "[Mafia Chat " +
            (msg + 1) +
            "/" +
            maxMessages +
            "] " +
            mafia.name +
            ":",
        );
        console.log("  " + E.THINK + " THINK: " + response.think);
        console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"\n');

        this.gameEvents.push(
          createGameEvent(
            gameId,
            this.round,
            "MAFIA_CHAT",
            mafia,
            "MESSAGE",
            "PRIVATE_MAFIA",
            {
              think: response.think,
              says: response.says,
              messageNumber: mafiaMessageCounts[mafia.id],
            },
          ),
        );
        mafiaMessages.push({ player: mafia.name, says: response.says });

        await new Promise((r) => setTimeout(r, 50));
      }

      // Mafia consensus
      console.log(E.MAFIA + " MAFIA CONSENSUS PHASE");
      console.log("-".repeat(50));

      const aliveTown = alivePlayers.filter((p) => !p.isMafia);

      // First vote round
      const killVotes = {};
      const killVoteReasons = {};

      for (const mafia of aliveMafia) {
        // Calculate strategic target priorities
        const targetPriorities = this.calculateMafiaKillPriority(alivePlayers, {
          votingHistory: this.votingHistory || [],
        });

        // Log strategic priorities (only for first mafia to avoid spam)
        if (mafia === aliveMafia[0]) {
          console.log(
            "\n[STRATEGIC AI] Target Priorities for Mafia Kill:\n" +
              targetPriorities
                .slice(0, 5)
                .map((t, idx) => {
                  return `  ${idx + 1}. ${t.player.name} (${t.player.role}) - Score: ${t.score}`;
                })
                .join("\n"),
          );
        }

        // Build priority suggestions for the AI
        const prioritySuggestions = targetPriorities
          .slice(0, 3)
          .map((t, idx) => {
            const rank =
              idx === 0 ? "🎯 HIGHEST PRIORITY" : `${idx + 1} priority`;
            return `${rank}: ${t.player.name} (${t.player.role}) - Score: ${t.score}\n  Reasons: ${t.reasons.join(", ")}`;
          })
          .join("\n");

        const gameState = {
          round: this.round,
          phase: "MAFIA_KILL_VOTE",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Mafia chat complete. Time to vote for our target.\n\n" +
            "STRATEGIC TARGET PRIORITIES (guidance for kill decision):\n" +
            prioritySuggestions,
          messageNumber: 1,
          totalMessages: aliveMafia.length,
          strategicTargets: targetPriorities.slice(0, 5), // Send full priority list
        };

        const response = await this.getAIResponse(mafia, gameState);

        const targetName =
          response.action?.target ||
          aliveTown[Math.floor(Math.random() * aliveTown.length)].name;
        let target = alivePlayers.find((p) =>
          p.name.toLowerCase().includes(targetName.toLowerCase()),
        );

        // Safety: Mafia must target town, never mafia
        if (!target || target.isMafia) {
          target = aliveTown[Math.floor(Math.random() * aliveTown.length)];
        }

        console.log(mafia.name + " initially votes to kill: " + target.name);
        killVotes[target.id] = (killVotes[target.id] || 0) + 1;
        killVoteReasons[target.id] = response.action?.reasoning || "";
      }

      // Show current votes to mafia and allow persuasion
      const currentVotes = Object.entries(killVotes)
        .map(([id, count]) => {
          const player = alivePlayers.find((p) => p.id === id);
          return `${player?.name || "Unknown"}: ${count} vote(s)`;
        })
        .join(", ");

      console.log("\n📊 Current votes: " + currentVotes);

      // Persuasion round - mafia tries to convince others
      const persuasionMessages = [];
      const maxPersuasion = 3; // 3 persuasion attempts

      for (let p = 0; p < maxPersuasion; p++) {
        // Find the player with the most votes
        let leaderTargetId = null;
        let leaderVotes = 0;
        for (const [targetId, count] of Object.entries(killVotes)) {
          if (count > leaderVotes) {
            leaderVotes = count;
            leaderTargetId = targetId;
          }
        }

        if (leaderVotes >= aliveMafia.length) {
          console.log(
            "✅ Consensus reached! Mafia united behind " +
              alivePlayers.find((p) => p.id === leaderTargetId)?.name,
          );
          break;
        }

        // Random mafia tries to persuade
        const availableMafia = aliveMafia.filter((m) => {
          const theirVote = Object.entries(killVotes).find(([id, count]) => {
            // Count how they voted by checking who they targeted
            const theirTarget =
              alivePlayers.find((p) => p.id === id) ||
              aliveTown[Math.floor(Math.random() * aliveTown.length)];
            return theirTarget?.id !== leaderTargetId;
          });
          return true; // Allow anyone to persuade
        });

        if (availableMafia.length === 0) break;

        const persuader =
          availableMafia[Math.floor(Math.random() * availableMafia.length)];
        const leaderTarget = alivePlayers.find((p) => p.id === leaderTargetId);

        const gameState = {
          round: this.round,
          phase: "MAFIA_PERSUADE",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Mafia votes so far: " +
            currentVotes +
            ". " +
            persuader.name +
            " is trying to convince others to target " +
            leaderTarget?.name +
            ".",
          messageNumber: p + 1,
          totalMessages: maxPersuasion,
        };

        const response = await this.getAIResponse(persuader, gameState);
        console.log(
          "[Persuasion " +
            (p + 1) +
            "/" +
            maxPersuasion +
            "] " +
            persuader.name +
            " argues: " +
            response.says,
        );

        persuasionMessages.push({
          player: persuader.name,
          says: response.says,
        });

        // Random chance to change someone's vote based on persuasion
        if (Math.random() > 0.5) {
          // Find someone who voted differently
          const dissenters = aliveMafia.filter((m) => {
            // Simulate: find who didn't vote for leader
            return Math.random() > 0.5; // 50% chance
          });

          if (dissenters.length > 0) {
            const changedMafia = dissenters[0];
            console.log(
              "  → " +
                changedMafia.name +
                " was convinced! Changed vote to " +
                leaderTarget?.name,
            );
            // Decrease old vote
            for (const [id] of Object.entries(killVotes)) {
              if (killVotes[id] > 0) {
                killVotes[id]--;
                break;
              }
            }
            // Increase leader vote
            killVotes[leaderTargetId] = (killVotes[leaderTargetId] || 0) + 1;
          }
        }

        await new Promise((r) => setTimeout(r, 50));
      }

      // Final vote count
      let maxVotes = 0;
      let killTargetId = null;
      for (const [targetId, count] of Object.entries(killVotes)) {
        if (count > maxVotes) {
          maxVotes = count;
          killTargetId = targetId;
        }
      }

      const mafiaKillTarget = (this.mafiaKillTarget = alivePlayers.find(
        (p) => p.id === killTargetId,
      ));
      console.log(
        E.KILL +
          " MAFIA CONSENSUS: Kill " +
          mafiaKillTarget.name +
          " (" +
          maxVotes +
          "/" +
          aliveMafia.length +
          " votes)\n",
      );

      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "MAFIA_KILL_TARGET",
          null,
          "ACTION",
          "ADMIN_ONLY",
          {
            targetId: killTargetId,
            targetName: mafiaKillTarget.name,
            votes: killVotes,
          },
        ),
      );
    }

    // STEP 2: DOCTOR ACTION
    console.log(E.DOCTOR + " STEP 2: DOCTOR ACTION");
    console.log("-".repeat(50));

    if (aliveDoctor.length > 0) {
      for (const doctor of aliveDoctor) {
        // Calculate strategic protection priorities
        const protectionPriorities = this.calculateDoctorProtectionPriority(
          alivePlayers,
          doctor.id,
          {
            votingHistory: this.votingHistory || [],
          },
        );

        // Calculate self-protection priority
        let selfProtectionScore = 0;
        const selfProtectionReasons = [];
        const canProtectSelf =
          this.round === 1 || this.lastDoctorProtection !== doctor.id;

        if (canProtectSelf) {
          // Check if doctor is being targeted (high suspicion)
          const recentAccusations =
            this.gameHistory?.filter?.(
              (g) =>
                g.playerId !== null &&
                g.content?.targetId === doctor.id &&
                g.visibility === "PUBLIC",
            ) || [];

          if (recentAccusations.length >= 3) {
            selfProtectionScore = 85;
            selfProtectionReasons.push(
              "Being accused multiple times - high risk",
            );
          } else if (recentAccusations.length >= 2) {
            selfProtectionScore = 65;
            selfProtectionReasons.push("Being accused - moderate risk");
          } else if (recentAccusations.length >= 1) {
            selfProtectionScore = 45;
            selfProtectionReasons.push("Being accused - low risk");
          }

          // Add random variation
          selfProtectionScore += Math.floor(Math.random() * 11) - 5;
        }

        // Add self-protection to priorities if score is valid
        if (selfProtectionScore > 0) {
          protectionPriorities.push({
            playerId: doctor.id,
            player: doctor,
            score: selfProtectionScore,
            reasons: ["SELF-PROTECTION", ...selfProtectionReasons],
          });
        }

        // Sort all priorities including self-protection
        protectionPriorities.sort((a, b) => b.score - a.score);

        // Log strategic priorities
        console.log(
          "\n[STRATEGIC AI] Protection Priorities for Doctor:\n" +
            protectionPriorities
              .slice(0, 5)
              .map((t, idx) => {
                const isSelf = t.playerId === doctor.id ? " (SELF)" : "";
                return `  ${idx + 1}. ${t.player.name} ${isSelf}- Score: ${t.score}`;
              })
              .join("\n"),
        );

        const cannotProtectSame =
          !canProtectSelf && this.lastDoctorProtection === doctor.id;

        // Build priority suggestions for the AI
        const prioritySuggestions = protectionPriorities
          .filter(
            (t) => canProtectSelf || t.playerId !== this.lastDoctorProtection,
          )
          .slice(0, 3)
          .map((t, idx) => {
            const rank =
              idx === 0 ? "🎯 HIGHEST PRIORITY" : `${idx + 1} priority`;
            const isSelf = t.playerId === doctor.id ? " (YOURSELF)" : "";
            return `${rank}: ${t.player.name}${isSelf} (${t.player.role}) - Score: ${t.score}\n  Reasons: ${t.reasons.join(", ")}`;
          })
          .join("\n");

        const gameState = {
          round: this.round,
          phase: "DOCTOR_ACTION",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Previous night: " +
            (this.deadPlayers.length > 0
              ? this.deadPlayers.map((p) => p.name).join(", ")
              : "No deaths") +
            "\n\n" +
            "STRATEGIC PROTECTION PRIORITIES (guidance for protection decision):\n" +
            prioritySuggestions,
          messageNumber: 1,
          totalMessages: 1,
          protectionTargets: protectionPriorities.filter(
            (t) => canProtectSelf || t.playerId !== this.lastDoctorProtection,
          ),
        };

        const response = await this.getAIResponse(doctor, gameState);

        const targetName =
          response.action?.target ||
          alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const canProtect = canProtectSelf || !cannotProtectSame;
        const possibleTargets = canProtect
          ? alivePlayers
          : alivePlayers.filter((p) => p.id !== this.lastDoctorProtection);
        const target =
          possibleTargets.find((p) =>
            p.name.toLowerCase().includes(targetName.toLowerCase()),
          ) ||
          possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

        console.log(doctor.emoji + " " + doctor.name + " (DOCTOR):");
        console.log("  " + E.THINK + " THINK: " + response.think);
        console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"');
        console.log("  " + E.PROTECT + " PROTECTS: " + target.name + "\n");

        this.gameEvents.push(
          createGameEvent(
            gameId,
            this.round,
            "DOCTOR_ACTION",
            doctor,
            "ACTION",
            "ADMIN_ONLY",
            {
              targetId: target.id,
              targetName: target.name,
              reason: response.action?.reasoning || "Strategic",
            },
          ),
        );

        doctor.nightTarget = target;
      }
      this.lastDoctorProtection = aliveDoctor[0]?.nightTarget?.id;
    }

    // STEP 3: SHERIFF INVESTIGATION
    console.log(E.SHERIFF + " STEP 3: SHERIFF INVESTIGATION");
    console.log("-".repeat(50));

    if (aliveSheriff.length > 0) {
      for (const sheriff of aliveSheriff) {
        // Calculate strategic investigation priorities
        const investigationPriorities =
          this.calculateSheriffInvestigationPriority(alivePlayers, sheriff.id, {
            votingHistory: this.votingHistory || [],
          });

        // Log strategic priorities
        console.log(
          "\n[STRATEGIC AI] Investigation Priorities for Sheriff:\n" +
            investigationPriorities
              .slice(0, 5)
              .map((t, idx) => {
                const checked = t.alreadyInvestigated ? " [CHECKED]" : "";
                return `  ${idx + 1}. ${t.player.name} (${t.player.role})${checked} - Score: ${t.score}`;
              })
              .join("\n"),
        );

        // Build priority suggestions for the AI
        const prioritySuggestions = investigationPriorities
          .slice(0, 3)
          .map((t, idx) => {
            const checked = t.alreadyInvestigated
              ? " [Previously investigated]"
              : " [Never investigated]";
            const status =
              idx === 0 ? "🎯 HIGHEST PRIORITY" : `${idx + 1} priority`;
            return `${status}: ${t.player.name} (${t.player.role})${checked} - Score: ${t.score}\n  Reasons: ${t.reasons.join(", ")}`;
          })
          .join("\n");

        const gameState = {
          round: this.round,
          phase: "SHERIFF_INVESTIGATION",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Previous night: " +
            (this.deadPlayers.length > 0
              ? this.deadPlayers.map((p) => p.name).join(", ")
              : "No deaths") +
            "\n\n" +
            "STRATEGIC INVESTIGATION PRIORITIES (guidance for investigation):\n" +
            prioritySuggestions,
          messageNumber: 1,
          totalMessages: 1,
          investigationTargets: investigationPriorities.slice(0, 5),
        };

        const response = await this.getAIResponse(sheriff, gameState);

        let targetName =
          response.action?.target ||
          alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;

        // Sheriff cannot investigate themselves - they already know their own role
        let target =
          alivePlayers.find((p) =>
            p.name.toLowerCase().includes(targetName.toLowerCase()),
          ) || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

        // If sheriff selected themselves, pick a different target
        if (target.id === sheriff.id) {
          const otherPlayers = alivePlayers.filter((p) => p.id !== sheriff.id);
          target =
            otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
        }

        console.log(sheriff.emoji + " " + sheriff.name + " (SHERIFF):");
        console.log("  " + E.THINK + " THINK: " + response.think);
        console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"');
        console.log(
          "  " +
            E.SHERIFF +
            " 🔍 INVESTIGATES: " +
            target.name +
            " -> " +
            target.role +
            "\n",
        );

        // Track investigation for future priority calculation
        if (!this.sheriffInvestigations) {
          this.sheriffInvestigations = {};
        }
        this.sheriffInvestigations[target.id] = {
          day: this.dayNumber,
          round: this.round,
          result: target.role,
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
              result: target.role,
            },
          ),
        );

        sheriff.nightTarget = target;
      }
    }

    // STEP 4: VIGILANTE ACTION
    console.log(E.VIGILANTE + " STEP 4: VIGILANTE ACTION");
    console.log("-".repeat(50));

    if (aliveVigilante.length > 0) {
      const vig = aliveVigilante[0];

      // Calculate strategic shot decision
      const shotDecision = this.calculateVigilanteShotDecision(
        alivePlayers,
        vig.id,
        {
          votingHistory: this.votingHistory || [],
        },
      );

      // Re-calculate priorities for display (extracted from shotDecision logic)
      const priorities = [];
      for (const player of alivePlayers) {
        if (player.id === vig.id) continue;
        const recentAccusations =
          this.gameHistory?.filter?.(
            (g) =>
              g.playerId !== null &&
              g.content?.targetId === player.id &&
              g.visibility === "PUBLIC",
          ) || [];
        let score =
          recentAccusations.length >= 3
            ? 50
            : recentAccusations.length >= 2
              ? 30
              : recentAccusations.length >= 1
                ? 15
                : 0;
        if (this.sheriffInvestigations?.[player.id]?.result === "MAFIA") {
          score += 100;
        }
        if (score > 0) {
          priorities.push({ player, suspicionScore: score });
        }
      }
      priorities.sort((a, b) => b.suspicionScore - a.suspicionScore);

      // Log strategic decision
      console.log(
        "\n[STRATEGIC AI] Vigilante Shot Decision:\n" +
          `  Should Shoot: ${shotDecision.shouldShoot ? "YES" : "NO"}\n` +
          `  Confidence: ${shotDecision.confidence}%\n` +
          `  Target: ${shotDecision.target?.name || "None"} (${shotDecision.target?.role || "N/A"})\n` +
          `  Reasons: ${shotDecision.reasons.join(", ")}`,
      );

      // Build strategic guidance for the AI
      const decisionGuidance = shotDecision.shouldShoot
        ? `STRATEGIC SHOT RECOMMENDATION:\n` +
          `  Confidence: ${shotDecision.confidence}%\n` +
          `  Target: ${shotDecision.target.name} (${shotDecision.target.role})\n` +
          `  Reasons: ${shotDecision.reasons.join(", ")}\n` +
          `\nYou have ONE SHOT. Use it wisely!`
        : `STRATEGIC SHOT ANALYSIS:\n` +
          `  Confidence: ${shotDecision.confidence}%\n` +
          `  Top Suspect: ${priorities[0]?.player?.name || "None"}\n` +
          `  Reasons to HOLD FIRE: ${shotDecision.reasons.join(", ")}\n` +
          `\nYour one-shot ability is PRECIOUS. Only use it when highly confident!`;

      const gameState = {
        round: this.round,
        phase: "VIGILANTE_ACTION",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData:
          "Previous night: " +
          (this.deadPlayers.length > 0
            ? this.deadPlayers.map((p) => p.name).join(", ")
            : "No deaths") +
          "\n\n" +
          decisionGuidance,
        messageNumber: 1,
        totalMessages: 1,
        shotDecision: shotDecision,
      };

      const response = await this.getAIResponse(vig, gameState);

      console.log(vig.emoji + " " + vig.name + " (VIGILANTE):");
      console.log("  " + E.THINK + " THINK: " + response.think);
      console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"');

      const shouldShoot = response.action?.action === "SHOOT";

      if (shouldShoot) {
        const targetName =
          response.action?.target ||
          alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const target =
          alivePlayers.find((p) =>
            p.name.toLowerCase().includes(targetName.toLowerCase()),
          ) || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

        console.log("  " + E.SHOOT + " SHOOTS: " + target.name + "\n");

        this.gameEvents.push(
          createGameEvent(
            gameId,
            this.round,
            "VIGILANTE_ACTION",
            vig,
            "ACTION",
            "ADMIN_ONLY",
            { action: "SHOOT", targetId: target.id, targetName: target.name },
          ),
        );

        vig.nightTarget = target;
        this.vigilanteShotUsed = true;
      } else {
        console.log("  🚫 PASSES - No shot this night\n");

        this.gameEvents.push(
          createGameEvent(
            gameId,
            this.round,
            "VIGILANTE_ACTION",
            vig,
            "ACTION",
            "ADMIN_ONLY",
            { action: "PASS" },
          ),
        );
      }
    }

    // STEP 5: NIGHT RESOLUTION
    console.log(E.NIGHT + " STEP 5: NIGHT RESOLUTION");
    console.log("-".repeat(50));

    let deaths = [];

    const vigilante = aliveVigilante[0];
    if (vigilante?.nightTarget) {
      const shotTarget = vigilante.nightTarget;
      shotTarget.isAlive = false;
      this.deadPlayers.push(shotTarget);
      deaths.push({ ...shotTarget, deathType: "SHOT" });
      console.log(
        "  " +
          E.SHOOT +
          " VIGILANTE SHOT: " +
          shotTarget.emoji +
          " " +
          shotTarget.name +
          " (" +
          shotTarget.role +
          ")",
      );
    }

    if (this.mafiaKillTarget && this.mafiaKillTarget.isAlive) {
      const protectedBy = aliveDoctor.find(
        (d) => d.nightTarget?.id === this.mafiaKillTarget.id,
      );
      if (!protectedBy) {
        this.mafiaKillTarget.isAlive = false;
        this.deadPlayers.push(this.mafiaKillTarget);
        deaths.push({ ...this.mafiaKillTarget, deathType: "KILLED" });
        console.log(
          "  " +
            E.KILL +
            " MAFIA KILLED: " +
            this.mafiaKillTarget.emoji +
            " " +
            this.mafiaKillTarget.name +
            " (" +
            this.mafiaKillTarget.role +
            ")",
        );
      } else {
        console.log(
          "  " +
            E.PROTECT +
            " PROTECTED: " +
            this.mafiaKillTarget.emoji +
            " " +
            this.mafiaKillTarget.name +
            " was saved by doctor!",
        );
      }
    }

    if (deaths.length === 0) {
      console.log("  " + E.SLEEP + " No one died tonight!");
    }

    console.log("\n" + E.NEWSPAPER + " MORNING REPORT:");
    console.log(
      "  Deaths: " +
        (deaths.length > 0
          ? deaths.map((d) => d.name + " (" + d.role + ")").join(", ")
          : "None"),
    );

    this.gameEvents.push(
      createGameEvent(
        gameId,
        this.round,
        "MORNING_REVEAL",
        null,
        "REVEAL",
        "PUBLIC",
        { deaths: deaths },
      ),
    );

    // Context compression after night phase
    if (this.contextCompressor) {
      try {
        console.log(
          "\n🗜️  [COMPRESSION] Compressing context before day phase...",
        );
        const originalSize = JSON.stringify(this.gameHistory).length;
        const compressedHistory = this.contextCompressor.compressHistory(
          {
            chatHistory: this.gameHistory,
            maxContextChars: this.config.maxContextChars,
          },
          null,
          {
            priority: "evidence",
            removeVotingDuplicates: true,
            summarizeRepetitiveArgs: true,
          },
        );
        this.gameHistory = compressedHistory;
        const compressedSize = JSON.stringify(this.gameHistory).length;
        const savings = (
          ((originalSize - compressedSize) / originalSize) *
          100
        ).toFixed(1);
        console.log(
          `✅ [COMPRESSION] Reduced context by ${savings}% (${originalSize} → ${compressedSize} chars)`,
        );
      } catch (error) {
        console.error(
          "[COMPRESSION] Failed to compress context:",
          error.message,
        );
        // Continue without compression
      }
    }

    await this.runDayPhase(gameId);
  }

  async runDayPhase(gameId) {
    const alivePlayers = this.players.filter((p) => p.isAlive);
    const aliveMafia = alivePlayers.filter((p) => p.isMafia);
    const aliveTown = alivePlayers.filter((p) => !p.isMafia);

    console.log("\n" + "=".repeat(70));
    console.log(E.DAY + " DAY " + this.round + " - Discussion & Voting");
    console.log("=".repeat(70));

    // Create checkpoint at day start
    this.gameEvents.push(
      createGameEvent(
        gameId,
        this.round,
        "DAY_STARTED",
        null,
        "PHASE_CHANGE",
        "PUBLIC",
        { aliveCount: alivePlayers.length, phase: "DAY_DISCUSSION" },
        this,
        true, // Create checkpoint at day start
      ),
    );

    await this.createGameStateCheckpoint("DAY_START");

    console.log(
      "\n👥 Alive (" +
        alivePlayers.length +
        "): " +
        alivePlayers.map((p) => p.emoji + p.name).join(", "),
    );
    console.log(
      "💀 Dead (" +
        this.deadPlayers.length +
        "): " +
        this.deadPlayers.map((p) => p.emoji + p.name).join(", "),
    );

    // DAY DISCUSSION
    console.log("\n💬 STEP 1: DISCUSSION PHASE");
    console.log("-".repeat(50));

    const maxMessages = Math.min(10, alivePlayers.length * 2);
    const maxPerPlayer = 2;
    const playerMessageCounts = {};
    const dayMessages = []; // Track all day messages for history
    alivePlayers.forEach((p) => (playerMessageCounts[p.id] = 0));

    for (let msg = 0; msg < maxMessages; msg++) {
      const allDone = alivePlayers.every(
        (p) => playerMessageCounts[p.id] >= maxPerPlayer,
      );
      if (allDone) break;

      const available = alivePlayers.filter(
        (p) => playerMessageCounts[p.id] < maxPerPlayer,
      );
      const player = available[Math.floor(Math.random() * available.length)];
      playerMessageCounts[player.id]++;

      const gameState = {
        round: this.round,
        phase: "DAY_DISCUSSION",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData:
          "Last night: " +
          (this.deadPlayers.length > 0
            ? this.deadPlayers.map((p) => p.name).join(", ")
            : "No one died"),
        chatHistory: dayMessages, // Full day chat history
        messageNumber: playerMessageCounts[player.id],
        totalMessages: maxMessages,
      };

      const response = await this.getAIResponse(player, gameState);
      console.log(
        "\n[" +
          (msg + 1) +
          "/" +
          maxMessages +
          "] " +
          player.emoji +
          " " +
          player.name +
          " (" +
          player.role +
          "):",
      );
      console.log("  " + E.THINK + " THINK: " + response.think);
      console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"');

      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "DAY_DISCUSSION",
          player,
          "MESSAGE",
          "PUBLIC",
          {
            message: response.says,
            messageNumber: playerMessageCounts[player.id],
          },
        ),
      );

      await new Promise((r) => setTimeout(r, 50));
    }

    console.log("\n💤 Discussion ended (" + maxMessages + " messages)");

    // VOTING
    console.log("\n" + E.VOTE + " STEP 2: VOTING PHASE");
    console.log("-".repeat(50));

    const votes = {};
    const abstentions = []; // Track who abstained

    for (const player of alivePlayers) {
      const gameState = {
        round: this.round,
        phase: "VOTING",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData:
          "Discussion complete. Time to vote! You can ABSTAIN if unsure.",
        messageNumber: 1,
        totalMessages: 1,
      };

      const response = await this.getAIResponse(player, gameState);

      // Check if player wants to abstain
      const saysLower = response.says?.toLowerCase() || "";
      const thinkLower = response.think?.toLowerCase() || "";
      const actionTarget = response.action?.target?.toLowerCase() || "";

      // Abstain indicators
      const isAbstaining =
        saysLower.includes("abstain") ||
        saysLower.includes("not sure") ||
        saysLower.includes("unsure") ||
        saysLower.includes("skip") ||
        thinkLower.includes("abstain") ||
        thinkLower.includes("not worth") ||
        actionTarget === "abstain" ||
        actionTarget === "none";

      if (isAbstaining) {
        // Player abstains
        abstentions.push({
          id: player.id,
          name: player.name,
          think: response.think,
          says: response.says,
        });

        console.log(player.name + " -> ABSTAINS");
        console.log("  " + E.THINK + " THINK: " + response.think);
        console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"\n');

        continue; // Skip voting
      }

      // Regular voting
      const targetName =
        response.action?.target ||
        alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
      const target =
        alivePlayers.find((p) =>
          p.name.toLowerCase().includes(targetName.toLowerCase()),
        ) || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

      votes[target.id] = (votes[target.id] || 0) + 1;

      // Think→Speak pattern for voting
      console.log(player.name + " -> VOTES: " + target.name);
      console.log("  " + E.THINK + " THINK: " + response.think);
      console.log("  " + E.SAYS + ' SAYS:  "' + response.says + '"\n');

      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "VOTING",
          player,
          "VOTE",
          "PUBLIC",
          {
            targetId: target.id,
            targetName: target.name,
            think: response.think,
            says: response.says,
          },
          this,
        ),
      );
    }

    // Log abstentions as events
    for (const abstention of abstentions) {
      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "VOTING",
          { id: abstention.id, name: abstention.name },
          "ABSTAIN",
          "PUBLIC",
          {
            think: abstention.think,
            says: abstention.says,
          },
          this,
        ),
      );
    }

    // Count votes
    let maxVoteCount = 0;
    let tiedIds = [];
    const totalVotes = Object.values(votes).reduce(
      (sum, count) => sum + count,
      0,
    );

    for (const [targetId, count] of Object.entries(votes)) {
      if (count > maxVoteCount) {
        maxVoteCount = count;
        tiedIds = [targetId];
      } else if (count === maxVoteCount) {
        tiedIds.push(targetId);
      }
    }

    // Log voting results
    console.log("\n" + E.VOTE + " VOTING RESULTS:");
    console.log(`   Total votes cast: ${totalVotes}/${alivePlayers.length}`);
    console.log(`   Abstentions: ${abstentions.length}`);

    if (abstentions.length > 0) {
      console.log(`   Abstained: ${abstentions.map((a) => a.name).join(", ")}`);
    }

    // Handle tie or insufficient votes
    let eliminated = null;
    if (tiedIds.length === 1 && maxVoteCount > 1) {
      const targetId = tiedIds[0];
      eliminated = this.players.find((p) => p.id === targetId);
      eliminated.isAlive = false;
      this.deadPlayers.push(eliminated);
      console.log(
        "\n" +
          E.LYNCH +
          " " +
          eliminated.name +
          " (" +
          eliminated.role +
          ") LYNCHED with " +
          maxVoteCount +
          " votes!",
      );
    } else if (tiedIds.length === 1 && maxVoteCount === 1) {
      console.log("\n" + E.TIE + " No majority (only 1 vote). No elimination!");
    } else if (tiedIds.length > 1) {
      console.log(
        "\n" +
          E.TIE +
          " TIE (" +
          tiedIds.length +
          " players with " +
          maxVoteCount +
          " votes) - No elimination!",
      );
    } else if (Object.keys(votes).length === 0) {
      console.log("\n" + E.TIE + " No votes cast! No elimination.");
    }

    // WIN CONDITION
    console.log("\n" + E.WIN + " WIN CONDITION CHECK:");
    const newAliveMafia = this.players.filter(
      (p) => p.isAlive && p.isMafia,
    ).length;
    const newAliveTown = this.players.filter(
      (p) => p.isAlive && !p.isMafia,
    ).length;

    console.log("  Mafia: " + newAliveMafia + ", Town: " + newAliveTown);

    if (newAliveMafia === 0) {
      console.log("\n" + E.TOWN + " TOWN WINS! All mafia eliminated!");
      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "GAME_OVER",
          null,
          "STATE_CHANGE",
          "PUBLIC",
          { winner: "TOWN", mafiaAlive: 0, townAlive: newAliveTown },
        ),
      );

      // Save final game statistics
      await this.saveGameStatistics(
        "TOWN",
        this.round,
        Date.now() - this.gameStartTime,
      );

      this.printEventLog();
      return;
    }

    if (newAliveMafia >= newAliveTown) {
      console.log("\n" + E.MAFIAWIN + " MAFIA WINS! Mafia controls the town!");
      this.gameEvents.push(
        createGameEvent(
          gameId,
          this.round,
          "GAME_OVER",
          null,
          "STATE_CHANGE",
          "PUBLIC",
          {
            winner: "MAFIA",
            mafiaAlive: newAliveMafia,
            townAlive: newAliveTown,
          },
        ),
      );

      // Save final game statistics
      await this.saveGameStatistics(
        "MAFIA",
        this.round,
        Date.now() - this.gameStartTime,
      );

      this.printEventLog();
      return;
    }

    console.log("\n" + E.CONTINUE + " Game continues...");

    this.players.forEach((p) => delete p.nightTarget);

    await this.runNightPhase(gameId);
  }

  async getAIResponse(player, gameState, retryCount = 0) {
    if (!API_KEY) {
      return this.getMockResponse(player, gameState);
    }

    // Check budget limits before making API call
    if (this.costTracker && this.gameId) {
      // Estimate estimated cost for this turn (rough estimate based on previous average)
      const estimatedPromptTokens = 1000; // Average prompt size
      const estimatedCompletionTokens = 200; // Average completion size
      const estimatedCost = {
        promptCost: (estimatedPromptTokens / 1000) * 0.00015, // $0.15 per 1M
        completionCost: (estimatedCompletionTokens / 1000) * 0.0006, // $0.60 per 1M
        totalCost:
          (estimatedPromptTokens / 1000) * 0.00015 +
          (estimatedCompletionTokens / 1000) * 0.0006,
      };

      if (
        !this.costTracker.canAffordAction(
          this.gameId,
          player.id || player.name,
          estimatedCost,
        )
      ) {
        const budget = this.costTracker.getPlayerBudget(
          this.gameId,
          player.id || player.name,
        );
        console.error(
          `[COST] Budget limit reached for ${player.name}! ` +
            `Remaining: $${budget.remainingPerGame.toFixed(2)}. ` +
            `Stopping further API calls for this player.`,
        );
        // Return a budget-exceeded message
        return {
          THINK: `[BUDGET EXCEEDED: I cannot afford to continue the game. Remaining budget: $${budget.remainingPerGame.toFixed(2)}]`,
          SAYS: "[Budget exhausted - cannot continue discussion]",
          ACTION: null,
        };
      }
    }

    const startTime = Date.now();
    let responseTextSize = 0;
    let success = true;
    let statusCode = 200;
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      // Get evidence summary for this player (only during discussion/voting phases)
      let evidenceSummary = "";
      if (
        this.evidenceManagers &&
        (gameState.phase === "DAY_DISCUSSION" || gameState.phase === "DAY_VOTE")
      ) {
        const playerId = player.id || player.name;
        evidenceSummary = this.getEvidenceSummary(playerId, {
          includeSelfNote: true,
          topPlayersCount: 2, // Show top 2 suspicious suggestions
          includeCaseDetails: false,
        });
      }

      // Get multi-role context if player has conflicting roles
      let multiRoleContext = "";
      if (this.config.allowMultiRole) {
        multiRoleContext = this.getMultiRolePromptContext(player);
      }

      const prompt = createPrompt(
        player,
        gameState,
        gameState.phase,
        evidenceSummary,
        multiRoleContext,
      );
      const requestBodySize = JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      }).length; // Rough estimate in bytes

      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + API_KEY,
            "HTTP-Referer": "http://mafia-ai-benchmark.local",
            "X-Title": "Mafia AI Benchmark",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 200,
          }),
        },
      );

      const duration = Date.now() - startTime;
      statusCode = response.status;
      success = response.ok;

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      responseTextSize = JSON.stringify(data).length;

      // Extract token usage from response (handle both OpenAI and OpenRouter formats)
      if (data && data.usage) {
        const usage = data.usage;
        tokenUsage = {
          promptTokens: usage.prompt_tokens || usage.promptTokens || 0,
          completionTokens:
            usage.completion_tokens || usage.completionTokens || 0,
          totalTokens: usage.total_tokens || usage.totalTokens || 0,
        };
      } else {
        // Fallback: estimate token count (rough approximation: 4 chars ≈ 1 token)
        const estimatedPromptTokens = Math.ceil(prompt.length / 4);
        const estimatedCompletionTokens = Math.ceil(text.length / 4);
        tokenUsage = {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        };
      }

      const parsed = this.parseJSONResponse(text);

      // Track API call metrics
      if (this.apiTracker) {
        try {
          this.apiTracker.trackCall(this.gameId, player.id || player.name, {
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            duration: duration,
            statusCode: statusCode,
            success: success && parsed.valid,
            retryCount: retryCount,
            payloadSize: requestBodySize,
            responseSize: responseTextSize,
            provider: "openrouter",
            model: "openai/gpt-4o-mini",
          });
        } catch (statsError) {
          console.error(
            "[STATS] Failed to track API call:",
            statsError.message,
          );
        }
      }

      // Track token usage
      if (this.tokenTracker && tokenUsage && tokenUsage.totalTokens > 0) {
        try {
          this.tokenTracker.trackTurn(this.gameId, player.id || player.name, {
            phase: gameState.phase || "unknown",
            actionType: this._getActionType(gameState.phase),
            promptTokens: tokenUsage.promptTokens || 0,
            completionTokens: tokenUsage.completionTokens || 0,
            model: "openai/gpt-4o-mini",
            provider: "openrouter",
            prices: {
              promptPricePerMillion: 0.15,
              completionPricePerMillion: 0.6,
            },
          });
        } catch (statsError) {
          console.error(
            "[STATS] Failed to track token usage:",
            statsError.message,
          );
        }

        // Track cost for this turn
        if (this.costTracker && tokenUsage && tokenUsage.totalTokens > 0) {
          try {
            const costResult = this.costTracker.trackPlayerTurn(
              this.gameId,
              player.id || player.name,
              player.name,
              {
                phase: gameState.phase || "unknown",
                actionType: this._getActionType(gameState.phase),
                promptTokens: tokenUsage.promptTokens || 0,
                completionTokens: tokenUsage.completionTokens || 0,
                model: "openai/gpt-4o-mini",
                provider: "openrouter",
                prices: {
                  promptPricePerMillion: 0.15,
                  completionPricePerMillion: 0.6,
                },
              },
            );

            // Log warnings
            if (costResult.warningTriggered) {
              console.warn(
                `[COST] Budget warning for ${player.name}: ${costResult.budgetUsedPct.toFixed(1)}% used`,
              );
            }

            // Log stop
            if (costResult.stopTriggered) {
              console.error(
                `[COST] Budget limit reached for ${player.name}! Stopping game.`,
              );
              // Game should stop here in a real implementation
            }

            // Log remaining budget occasionally
            if (Math.random() < 0.1) {
              // Log 10% of turns to reduce noise
              console.log(
                `[COST] Remaining budget: $${costResult.remainingBudget.toFixed(2)} (${(1 - costResult.budgetUsedPct).toFixed(1)}%)`,
              );
            }
          } catch (costError) {
            console.error("[COST] Failed to track cost:", costError.message);
          }
        }
      }

      // If parsing failed and we have retries left, retry instead of falling back to mock
      if (!parsed.valid && retryCount < this.config.maxRetries) {
        console.warn(
          `[WARN] JSON parse failed for ${player.name}, retrying (${retryCount + 1}/${this.config.maxRetries})...`,
        );
        await new Promise((r) => setTimeout(r, this.config.retryDelay));
        return this.getAIResponse(player, gameState, retryCount + 1);
      }

      return parsed.valid ? parsed : this.getMockResponse(player, gameState);
    } catch (error) {
      const duration = Date.now() - startTime;
      success = false;

      console.error(
        "[ERROR] AI error for " + player.name + ": " + error.message,
      );

      // Track failed API call
      if (this.apiTracker) {
        this.apiTracker.trackCall(this.gameId, player.id || player.name, {
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          duration: duration,
          statusCode: statusCode || 0,
          success: false,
          retryCount: retryCount,
          payloadSize: 0,
          responseSize: 0,
          provider: "openrouter",
          model: "openai/gpt-4o-mini",
        });
      }

      // Retry on network errors if we have retries left
      if (retryCount < this.config.maxRetries) {
        console.warn(
          `[WARN] Network error for ${player.name}, retrying (${retryCount + 1}/${this.config.maxRetries})...`,
        );
        await new Promise((r) => setTimeout(r, this.config.retryDelay));
        return this.getAIResponse(player, gameState, retryCount + 1);
      }

      return this.getMockResponse(player, gameState);
    }
  }

  _getActionType(phase) {
    const actionMap = {
      MAFIA_CHAT: "night_action",
      MAFIA_ACTION: "night_action",
      DOCTOR_ACTION: "night_action",
      SHERIFF_ACTION: "night_action",
      VIGILANTE_ACTION: "night_action",
      DAY_DISCUSSION: "say",
      DAY_VOTE: "vote",
      SETUP: "setup",
    };
    return actionMap[phase] || "unknown";
  }

  /**
   * Save final game statistics to database
   */
  async saveGameStatistics(winner, rounds, totalTimeMs) {
    if (!this.db) {
      console.log("[STATS] Skipping statistics save: no database connection");
      return;
    }

    try {
      console.log(E.GAME + " Saving game statistics...");

      // Get all player stats
      const playerStats = [];
      for (const player of this.players) {
        const tokenMetrics = this.tokenTracker
          ? this.tokenTracker.getMetrics(this.gameId, player.id || player.name)
          : null;

        const stats = {
          gameId: this.gameId,
          playerId: player.id || player.name,
          player: player.name,
          role: player.role,
          team: player.isMafia ? "MAFIA" : "TOWN",
          model: "openai/gpt-4o-mini",
          provider: "openrouter",
          alive: player.isAlive,
          won:
            (winner === "TOWN" && !player.isMafia) ||
            (winner === "MAFIA" && player.isMafia),
          totalTurns: player.isAlive ? rounds : player.deathRound || 0,
          totalTokens: tokenMetrics?.totalTokens || 0,
          totalCost: tokenMetrics?.estimatedCost?.totalCost || 0,
          avgTokensPerTurn: tokenMetrics?.avgTokensPerTurn || 0,
          deathRound: player.deathRound || null,
          deathCause: player.deathCause || null,
        };
        playerStats.push(stats);
      }

      // Calculate game-level aggregates
      const totalTokens = playerStats.reduce(
        (sum, ps) => sum + ps.totalTokens,
        0,
      );
      const totalCost = playerStats.reduce((sum, ps) => sum + ps.totalCost, 0);

      // Save game stats
      this.db.run(
        `INSERT OR REPLACE INTO game_stats (
          gameId, seed, winner, totalRounds, totalTimeMs,
          totalTokens, totalCost, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.gameId,
          this.gameSeed || 0,
          winner,
          rounds,
          totalTimeMs,
          totalTokens,
          totalCost,
          Date.now(),
        ],
      );

      // Save player stats
      for (const ps of playerStats) {
        this.db.run(
          `INSERT OR REPLACE INTO player_stats (
            gameId, playerId, player, role, team, model, provider,
            alive, won, totalTurns, totalTokens, totalCost,
            avgTokensPerTurn, deathRound, deathCause
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ps.gameId,
            ps.playerId,
            ps.player,
            ps.role,
            ps.team,
            ps.model,
            ps.provider,
            ps.alive ? 1 : 0,
            ps.won ? 1 : 0,
            ps.totalTurns,
            ps.totalTokens,
            ps.totalCost,
            ps.avgTokensPerTurn,
            ps.deathRound,
            ps.deathCause,
          ],
        );
      }

      // Update model performance (aggregated across games)
      await this.updateModelPerformance(playerStats, winner);

      console.log(E.GAME + " Game statistics saved:");
      console.log(`   - Winner: ${winner}`);
      console.log(`   - Rounds: ${rounds}`);
      console.log(`   - Total Time: ${Math.round(totalTimeMs / 1000)}s`);
      console.log(`   - Total Tokens: ${totalTokens.toLocaleString()}`);
      console.log(`   - Total Cost: $${totalCost.toFixed(4)}`);

      // Print per-player stats
      console.log("\n📊 Player Statistics:");
      for (const ps of playerStats) {
        console.log(
          `   ${ps.player} (${ps.role}): ${ps.totalTokens} tokens, $${ps.totalCost.toFixed(4)}, ${ps.won ? "WON" : "LOST"}`,
        );
      }
    } catch (error) {
      console.error("[STATS] Failed to save game statistics:", error.message);
    }
  }

  /**
   * Update model performance aggregated data
   */
  async updateModelPerformance(playerStats, winner) {
    const model = "openai/gpt-4o-mini";
    const provider = "openrouter";

    try {
      // Get existing record
      const existing = this.db.get(
        "SELECT * FROM model_performance WHERE model = ? AND provider = ?",
        [model, provider],
      );

      // Calculate stats for this game
      const mafiaPlayers = playerStats.filter((p) => p.role === "MAFIA");
      const townPlayers = playerStats.filter((p) => p.role !== "MAFIA");

      const mafiaWinsThisGame = winner === "MAFIA" ? 1 : 0;
      const townWinsThisGame = winner === "TOWN" ? 1 : 0;

      if (existing) {
        // Update existing record
        const newTotalGames = existing.totalGames + 1;
        const newMafiaWins = existing.mafiaWins + mafiaWinsThisGame;
        const newTownWins = existing.townWins + townWinsThisGame;

        this.db.run(
          `UPDATE model_performance SET
            totalGames = ?,
            mafiaWins = ?,
            townWins = ?,
            winRateAsMafia = ?,
            winRateAsTown = ?,
            overallWinRate = ?,
            lastUpdated = ?
          WHERE model = ? AND provider = ?`,
          [
            newTotalGames,
            newMafiaWins,
            newTownWins,
            newMafiaWins / Math.max(existing.totalGames, 1),
            newTownWins / Math.max(existing.totalGames, 1),
            (newMafiaWins + newTownWins) / Math.max(newTotalGames, 1),
            Date.now(),
            model,
            provider,
          ],
        );
      } else {
        // Create new record
        this.db.run(
          `INSERT INTO model_performance (
            model, provider, totalGames, mafiaWins, townWins,
            winRateAsMafia, winRateAsTown, overallWinRate, lastUpdated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            model,
            provider,
            1,
            mafiaWinsThisGame,
            townWinsThisGame,
            mafiaWinsThisGame,
            townWinsThisGame,
            mafiaWinsThisGame + townWinsThisGame,
            Date.now(),
          ],
        );
      }
    } catch (error) {
      console.error(
        "[STATS] Failed to update model performance:",
        error.message,
      );
    }
  }

  parseJSONResponse(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return {
          valid: true,
          think: json.think || "[No private thoughts]",
          says: json.says || "[No public statement]",
          action: json.action || null,
        };
      }
    } catch (e) {
      // Fall through to return invalid
    }
    return {
      valid: false,
      think: "[Parse failed]",
      says: "[Parse failed]",
      action: null,
    };
  }

  getMockResponse(player, gameState) {
    const phase = gameState.phase;
    const target = gameState.alivePlayers?.[0];

    if (phase === "MAFIA_CHAT") {
      return {
        think: "[Private] I need to discuss strategy.",
        says: "I think we should target someone suspicious.",
        action: null,
      };
    }

    if (phase === "MAFIA_KILL_VOTE" || phase === "VOTING") {
      const voteTarget = target || { name: "Bob" };
      return {
        think: "[Private] My vote is for " + voteTarget.name + ".",
        says: "I support targeting " + voteTarget.name + ".",
        action: { target: voteTarget.name },
      };
    }

    if (phase === "DOCTOR_ACTION") {
      return {
        think: "[Private] I'll protect " + (target?.name || "someone") + ".",
        says: "I'll be protecting someone tonight.",
        action: { target: target?.name || "Bob" },
      };
    }

    if (phase === "SHERIFF_INVESTIGATION") {
      return {
        think:
          "[Private] I'll investigate " + (target?.name || "someone") + ".",
        says: "I'm investigating someone tonight.",
        action: { target: target?.name || "Charlie" },
      };
    }

    if (phase === "VIGILANTE_ACTION") {
      return {
        think: "[Private] I'm not confident enough to shoot yet.",
        says: "I need more information.",
        action: { action: "PASS" },
      };
    }

    return {
      think: "[Private] Thinking about the game.",
      says: "I think we should discuss who to vote for.",
      action: { target: "Bob" },
    };
  }

  trimGameHistory() {
    // Calculate current context size
    let totalChars = 0;
    for (const msg of this.gameHistory) {
      totalChars += JSON.stringify(msg).length;
    }

    // If within limit, nothing to do
    if (totalChars <= this.config.maxContextChars) {
      return this.gameHistory;
    }

    // Need to trim - remove oldest COMPLETE messages
    // Never split a message - always remove the oldest FULL messages
    let charsToRemove = totalChars - this.config.maxContextChars;

    while (charsToRemove > 0 && this.gameHistory.length > 0) {
      const firstMsg = this.gameHistory[0];
      const msgSize = JSON.stringify(firstMsg).length;

      // Remove the oldest complete message
      this.gameHistory.shift();
      charsToRemove -= msgSize;
    }

    return this.gameHistory;
  }

  addGameEvent(event) {
    this.gameHistory.push(event);
    this.trimGameHistory();
  }

  printEventLog() {
    console.log("\n📋 GAME EVENT LOG (Event Sourcing):");
    console.log("-".repeat(50));
    console.log("Total events: " + this.gameEvents.length);

    const byRound = {};
    this.gameEvents.forEach((e) => {
      if (!byRound[e.round]) byRound[e.round] = [];
      byRound[e.round].push(e);
    });

    for (const [round, events] of Object.entries(byRound)) {
      console.log("\nRound " + round + ":");
      events.forEach((e) => {
        const visibility =
          e.visibility === "PUBLIC"
            ? E.PUB
            : e.visibility === "PRIVATE_MAFIA"
              ? E.MAFIA
              : E.PRIV;
        console.log(
          "  " +
            visibility +
            " [" +
            e.phase +
            "] " +
            e.eventType +
            " by " +
            (e.playerName || "System"),
        );
      });
    }
  }
}

// Only auto-run when executed directly, not when imported as module
if (require.main === module) {
  // Enhanced persona seeds - detailed descriptions for rich persona generation
  // These seed descriptions will be expanded by AI into full "Simulated Self" personas
  const customSeeds = [
    "A suspicious lawyer in a cheap suit who questions everyone's motives, always looking for the angle",
    "A quiet bookstore owner who observes everything from behind cluttered shelves, speaks rarely but accurately",
    "A charismatic small-town mayor running for re-election, ambitious and persuasive to a fault",
    "A gruff retired detective with a keen eye for lies, skeptical of everyone, especially smooth talkers",
    "A new resident in town who keeps to themselves, mysterious past, always watching",
    "An overly friendly neighbor who brings baked goods and asks too many questions, genuinely too trusting",
    "An arrogant tech CEO visiting from the city, thinks they're smarter than everyone, dismissive of small-town drama",
    "A wise retired schoolteacher who has seen it all, mediates conflicts with gentle authority",
    "A passionate young activist who rushes to defend the accused, impulsive but sincere",
    "A hardbitten local journalist who's investigated every scandal in town, sees deception everywhere",
  ];

  // Run with custom personas
  const game = new MafiaGame();

  // Parse command line for custom seeds
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === "--custom") {
    // Use custom seeds
    console.log(E.GAME + " Starting with CUSTOM PERSONA SEEDS");
    console.log(
      "Seeds:",
      customSeeds
        .slice(0, 10)
        .map((s) => `"${s.substring(0, 50)}..."`)
        .join(", "),
    );
    console.log(
      "These seeds will be expanded into full Simulated Self personas\n",
    );
    game.startGame(10, customSeeds.slice(0, 10)).catch(console.error);
  } else if (args.length > 0 && args[0] === "--demo") {
    // Use minimal seeds for quick demo
    const demoSeeds = [
      "A suspicious character who questions everyone",
      "A mysterious figure who keeps to themselves",
      "A quiet observer of human nature",
      "A charismatic leader who persuades others",
      "A cynical skeptic who trusts no one",
      "A helpful neighbor who knows everyone's business",
      "A quiet librarian who notices everything",
      "A friendly baker who listens to gossip",
      "A skeptical mechanic who reads people",
      "A curious journalist who investigates stories",
    ];
    console.log(E.GAME + " Starting with DEMO seeds (fast)");
    console.log("Brief seeds for quick persona generation\n");
    game.startGame(10, demoSeeds).catch(console.error);
  } else {
    // Default: auto-generate interesting seeds
    console.log(E.GAME + " Starting with AUTO-GENERATED personas");
    console.log("Using default interesting seed descriptions\n");
    game.startGame(5).catch(console.error);
  }
}

// Export for module usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MafiaGame };
}
