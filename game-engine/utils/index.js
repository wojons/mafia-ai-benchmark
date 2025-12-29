// ============================================
// UTILITIES MODULE
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

const roleEmojis = {
  MAFIA: E.MAFIA,
  DOCTOR: E.DOCTOR,
  SHERIFF: E.SHERIFF,
  VIGILANTE: E.VIGILANTE,
  VILLAGER: E.VILLAGER,
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

// ============================================
// UUID GENERATOR
// ============================================

function simpleUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? (r & 0x3) | 0x8 : (r & 0xc) | 0x4;
    return v.toString(16);
  });
}

// ============================================
// NAME GENERATOR
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
// CONSTANT DATA ARRAYS
// ============================================

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
  ],
  modern: [
    {
      name: "Tech Leader",
      archetype: "Innovator",
      traits: ["Visionary", "Analytical", "Determined"],
      communicationStyle: "Precise",
      humor: "dry",
    },
    {
      name: "Community Organizer",
      archetype: "Unifier",
      traits: ["Charitable", "Connected", "Inspiring"],
      communicationStyle: "Passionate",
      humor: "warm",
    },
    {
      name: "Small Business Owner",
      archetype: "Entrepreneur",
      traits: ["Resourceful", "Determined", "Practical"],
      communicationStyle: "Direct",
      humor: "witty",
    },
    {
      name: "Teacher",
      archetype: "Mentor",
      traits: ["Patient", "Knowledgeable", "Caring"],
      communicationStyle: "Measured",
      humor: "subtle",
    },
    {
      name: "Community Leader",
      archetype: "Activist",
      traits: ["Passionate", "Principled", "Resilient"],
      communicationStyle: "Empathetic",
      humor: "gentle",
    },
  ],
};

// ============================================
// RANDOM UTILITIES
// ============================================

/**
 * Get random element from array
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Get N random unique elements from array
 */
function randomSample(array, count) {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Get random number between min and max (inclusive)
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  E,
  roleEmojis,
  simpleUUID,
  generateNameFromSeed,
  randomChoice,
  randomSample,
  randomInt,
  // Constants
  firstNames,
  moralAlignments,
  coreValues,
  flaws,
  archetypes,
};
