// ============================================
// PERSONA GENERATION MODULE
// ============================================

require("dotenv").config();

const { getRandomName } = require("../../src/core-systems/name-database");

// ============================================
// PERSONA SYSTEM PROMPT
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
  "socialTendency": "Introverted | Extroverted | Ambivert",
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
// API Key
// ============================================

const API_KEY = process.env.OPENAI_API_KEY;

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
      const name = persona.name || generateNameFromSeed(seed);

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

function generateNameFromSeed(seed) {
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
    "Drew",
    "Blake",
    "Cameron",
    "Dakota",
    "Emerson",
    "Finley",
    "Harper",
    "Hayden",
    "Jesse",
    "Kai",
  ];

  const lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Wilson",
    "Anderson",
    "Taylor",
    "Thomas",
    "Moore",
    "Jackson",
    "Martin",
    "Lee",
    "Thompson",
    "White",
  ];

  // Try to extract name hints from seed (if provided)
  if (seed) {
    const seedWords = seed.split(" ");
    const potentialFirst = seedWords.find((w) =>
      firstNames.some((fn) => fn.toLowerCase() === w.toLowerCase()),
    );

    if (potentialFirst) {
      const first =
        potentialFirst.charAt(0).toUpperCase() +
        potentialFirst.slice(1).toLowerCase();
      const last = lastNames[Math.floor(Math.random() * lastNames.length)];
      return `${first} ${last}`;
    }
  }

  // Random name
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${first} ${last}`;
}

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
// EXPORTS
// ============================================

module.exports = {
  generatePersona,
  generateProceduralPersona,
  PERSONA_SYSTEM_PROMPT,
};
