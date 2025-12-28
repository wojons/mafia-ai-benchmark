// ============================================
// LOAD ENVIRONMENT VARIABLES
// ============================================
require("dotenv").config();

// ============================================
// ENHANCED PERSONA GENERATION SYSTEM
// Using "Simulated Self" Meta-Prompt Template (v2)
// ============================================

const PERSONA_SYSTEM_PROMPT = `You are a creative character designer for a Mafia game. 
Expand the user's seed description into a complete "Simulated Self" persona.

Generate a rich, dynamic character with depth across all these dimensions:

## Core Identity
- Name (realistic, fits backstory)
- Physical form/avatar description
- Backstory (2-3 sentences about origin)

## Psychological Profile
- Core traits (3-5 adjectives)
- Cognitive style (how they think)
- Core values (what matters most)
- Moral alignment (DnD style)

## Behavioral Model
- Communication cadence (how they speak)
- Verbal tics (common phrases)
- Humor style
- Social tendencies
- Conflict resolution style

## Relational Profile
- Primary goal/motivation
- Key flaw/insecurity
- A key formative memory

## Dynamic State
- Current emotional baseline (happiness, stress, curiosity, anger scales 1-10)
- State-based behavior modifiers

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

The character should feel authentic and consistent. Use the seed description as the foundation.`;

// ============================================
// PERSONA GENERATION FROM SEED
// ============================================

async function generatePersona(seed = undefined) {
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
              content: `You are creating a persona for a social deduction game.

 ${seed ? `Use this as inspiration: "${seed}"` : `Choose ANY character you want. No constraints or descriptions. You can choose from: fictional (books, movies, TV, anime, comics, games), historical figures, original characters, or real people.`}

Provide:
 1. A realistic name (diverse cultures, NOT stereotypical Italian mobster names)
   Examples: Sarah Chen, Marcus Williams, Aiko Tanaka, Fatima Al-Hassan, Erik Johansson, Yuki Suzuki, Priya Patel, Ahmed Hassan, Olga Petrova, Carlos Rivera
   AVOID: Giovanni, Marco, Vincenzo, Giuseppe, or any stereotypical mobster-sounding names

 2. A brief personality description (2-3 sentences)
 3. Core traits (3-5 keywords)
 4. Communication style (1 sentence)
 5. A notable flaw or quirk

Return JSON: { "name": "...", "personality": "...", "traits": [...], "communicationStyle": "...", "flaw": "..."}`,
            },
            {
              role: "user",
              content: seed
                ? `${seed}\n\nCreate a persona inspired by this description. Feel free to expand on it!`
                : "Generate a persona for me. Choose ANY character - fictional, historical, or original. The more diverse and interesting, the better!",
            },
          ],
          temperature: seed ? 0.8 : 0.9,
          max_tokens: 400,
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
  console.log(E.GAME + " Mafia AI Benchmark - PERSONA EDITION v3");
  console.log("=".repeat(70));
  console.log("Features: Persona System, Mafia Consensus, Roles, Voting");
  console.log("=".repeat(70) + "\n");
}
const API_KEY = process.env.OPENAI_API_KEY;

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
) {
  return {
    gameId: gameId,
    round: round,
    phase: phase,
    playerId: player?.id || null,
    playerName: player?.name || null,
    eventType: eventType,
    visibility: visibility,
    timestamp: new Date().toISOString(),
    content: content,
  };
}

function createPrompt(player, gameState, phase) {
  const persona = player.persona;

  // Universal villager base prompt - everyone gets this because mafia need to pretend to be villagers
  const villagerBasePrompt = `
## BASE VILLAGER BEHAVIOR
You are fundamentally a villager in this town working to find the mafia:
- You want to help the town by identifying and eliminating mafia members
- Be helpful, cooperative, and participate in discussions
- Share honest observations and suspicions with other town members
- Vote for who you believe is most likely mafia
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
 - Share observations and suspicions during day discussions`,
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
    "## OUTPUT FORMAT\n" +
    'Return JSON: {"think": "your private reasoning", "says": "your public statement", "action": ACTION}\n\n' +
    "Remember: You are " +
    player.name +
    ". You are " +
    (persona.primaryGoal ? "driven by " + persona.primaryGoal : "a player") +
    ". Your " +
    (persona.moralAlignment || "neutral") +
    " alignment and " +
    (persona.keyFlaw || "flaw") +
    " nature shape your choices. Stay authentic to your persona.";

  return prompt;
}

class MafiaGame {
  constructor() {
    this.players = [];
    this.round = 0;
    this.lastDoctorProtection = null;
    this.vigilanteShotUsed = false;
    this.deadPlayers = [];
    this.gameEvents = [];
    this.mafiaKillTarget = null;
  }

  calculateRoles(numPlayers) {
    // Validate minimum players
    if (numPlayers < 5) {
      throw new Error("Minimum 5 players required");
    }

    const roles = [];

    // Always include 1 mafia, 1 doctor, 1 sheriff
    roles.push("MAFIA", "DOCTOR", "SHERIFF");

    // Add vigilante only if we have 6+ players
    if (numPlayers >= 6) {
      roles.push("VIGILANTE");
    }

    // Add more mafia for larger games (roughly 1 mafia per 4 players)
    const totalMafia = Math.floor(numPlayers / 4);
    while (roles.filter((r) => r === "MAFIA").length < totalMafia) {
      roles.push("MAFIA");
    }

    // Fill remaining with villagers
    while (roles.length < numPlayers) {
      roles.push("VILLAGER");
    }

    // Shuffle for random assignment
    return roles.sort(() => Math.random() - 0.5);
  }

  async startGame(numPlayers = 5, personaSeeds = null) {
    console.log(E.GAME + " Starting Mafia Game v3");
    console.log("=".repeat(70));

    // If no personaSeeds provided, create array of undefined for LLM freedom
    // If personaSeeds provided, use them as guidance
    if (!personaSeeds) {
      personaSeeds = new Array(numPlayers).fill(undefined);
      console.log(E.LOCK + " No seeds provided - LLM will choose freely");
    }

    // Generate roles dynamically based on player count
    const roles = this.calculateRoles(numPlayers);

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

      // Generate persona (role not known yet)
      const persona = await generatePersona(seed);
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
    for (let i = 0; i < numPlayers; i++) {
      const role = roles[i] || "VILLAGER";
      this.players[i].role = role;
      this.players[i].isMafia = role === "MAFIA";
      this.players[i].emoji = roleEmojis[role];
      this.players[i].persona.gameRole = role;

      console.log(
        `  ${this.players[i].emoji} ${this.players[i].name} -> ${role}`,
      );
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

    await this.runNightPhase(gameId);
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
      ),
    );

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
        const gameState = {
          round: this.round,
          phase: "MAFIA_KILL_VOTE",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Mafia chat complete. Time to vote for our target.",
          messageNumber: 1,
          totalMessages: aliveMafia.length,
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
        const canProtectSelf = this.round === 1;
        const cannotProtectSame =
          !canProtectSelf && this.lastDoctorProtection === doctor.id;

        const gameState = {
          round: this.round,
          phase: "DOCTOR_ACTION",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Previous night: " +
            (this.deadPlayers.length > 0
              ? this.deadPlayers.map((p) => p.name).join(", ")
              : "No deaths"),
          messageNumber: 1,
          totalMessages: 1,
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
        const gameState = {
          round: this.round,
          phase: "SHERIFF_INVESTIGATION",
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData:
            "Previous night: " +
            (this.deadPlayers.length > 0
              ? this.deadPlayers.map((p) => p.name).join(", ")
              : "No deaths"),
          messageNumber: 1,
          totalMessages: 1,
        };

        const response = await this.getAIResponse(sheriff, gameState);

        const targetName =
          response.action?.target ||
          alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const target =
          alivePlayers.find((p) =>
            p.name.toLowerCase().includes(targetName.toLowerCase()),
          ) || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

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

      const gameState = {
        round: this.round,
        phase: "VIGILANTE_ACTION",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData:
          "Previous night: " +
          (this.deadPlayers.length > 0
            ? this.deadPlayers.map((p) => p.name).join(", ")
            : "No deaths"),
        messageNumber: 1,
        totalMessages: 1,
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

    await this.runDayPhase(gameId);
  }

  async runDayPhase(gameId) {
    const alivePlayers = this.players.filter((p) => p.isAlive);
    const aliveMafia = alivePlayers.filter((p) => p.isMafia);
    const aliveTown = alivePlayers.filter((p) => !p.isMafia);

    console.log("\n" + "=".repeat(70));
    console.log(E.DAY + " DAY " + this.round + " - Discussion & Voting");
    console.log("=".repeat(70));

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

    for (const player of alivePlayers) {
      const gameState = {
        round: this.round,
        phase: "VOTING",
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: "Discussion complete. Time to vote!",
        messageNumber: 1,
        totalMessages: 1,
      };

      const response = await this.getAIResponse(player, gameState);

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
        ),
      );
    }

    // Count votes
    let maxVoteCount = 0;
    let tiedIds = [];
    for (const [targetId, count] of Object.entries(votes)) {
      if (count > maxVoteCount) {
        maxVoteCount = count;
        tiedIds = [targetId];
      } else if (count === maxVoteCount) {
        tiedIds.push(targetId);
      }
    }

    // Handle tie
    let eliminated = null;
    if (tiedIds.length === 1) {
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
    } else {
      console.log(
        "\n" +
          E.TIE +
          " TIE (" +
          tiedIds.length +
          " players with " +
          maxVoteCount +
          " votes) - No elimination!",
      );
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
      this.printEventLog();
      return;
    }

    console.log("\n" + E.CONTINUE + " Game continues...");

    this.players.forEach((p) => delete p.nightTarget);

    await this.runNightPhase(gameId);
  }

  async getAIResponse(player, gameState) {
    if (!API_KEY) {
      return this.getMockResponse(player, gameState);
    }

    try {
      const prompt = createPrompt(player, gameState, gameState.phase);

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

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";

      return this.parseJSONResponse(text);
    } catch (error) {
      console.error(
        "[ERROR] AI error for " + player.name + ": " + error.message,
      );
      return this.getMockResponse(player, gameState);
    }
  }

  parseJSONResponse(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return {
          think: json.think || "[No private thoughts]",
          says: json.says || "[No public statement]",
          action: json.action || null,
        };
      }
    } catch (e) {
      // Fall through to default
    }
    return this.getMockResponse({}, { phase: "UNKNOWN" });
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
