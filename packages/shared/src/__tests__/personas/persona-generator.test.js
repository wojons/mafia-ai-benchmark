// ============================================
// Game Engine Tests - Persona System
// Tests for seed-based persona generation
// ============================================

const { describe, it, expect, beforeEach, vi, afterEach } = require("vitest");

// Mock the API_KEY and fetch for testing
const mockApiKey = "test-api-key";
const mockPersonaResponse = {
  choices: [
    {
      message: {
        content: `{
        "name": "Marcus Webb",
        "physicalForm": "Late 40s man in a rumpled suit with squinting eyes",
        "backstory": "Spent two decades defending clients in criminal court. Developed an instinct for lies after watching too many defendants break under cross-examination.",
        "coreTraits": ["Skeptical", "Analytical", "Paranoid", "Methodical", "Cautious"],
        "cognitiveStyle": "Logical-Sequential",
        "coreValues": ["Truth", "Justice", "Order"],
        "moralAlignment": "Lawful Neutral",
        "communicationCadence": "Measured and precise",
        "verbalTics": ["Based on the evidence...", "Let's examine the facts", "The question is..."],
        "humorStyle": "Dry",
        "socialTendency": "Introverted",
        "conflictStyle": "Authoritative",
        "primaryGoal": "Uncover the truth regardless of consequences",
        "keyFlaw": "Paranoia leads to false accusations when evidence is thin",
        "keyMemory": "Lost his biggest case because he trusted a witness who lied",
        "happiness": 4,
        "stress": 7,
        "curiosity": 9,
        "anger": 3
      }`,
      },
    },
  ],
};

describe("Persona Generation from Seeds", () => {
  let gameEngine;
  let mockFetch;

  beforeEach(async () => {
    // Clear module cache and reimport
    vi.resetModules();

    // Set up environment
    process.env.OPENAI_API_KEY = mockApiKey;

    // Create mock fetch
    mockFetch = vi.fn().mockResolvedValue({
      json: async () => mockPersonaResponse,
    });

    vi.stubGlobal("fetch", mockFetch);

    // Import fresh module
    gameEngine = await import("../../../../game-engine.js");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  describe("generatePersonaFromSeed()", () => {
    it("should generate a complete persona from seed description", async () => {
      const seed = "A suspicious lawyer who questions everyone's motives";
      const role = "MAFIA";

      const persona = await gameEngine.generatePersonaFromSeed(seed, role);

      // Verify API was called
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify core identity fields
      expect(persona.name).toBe("Marcus Webb");
      expect(persona.seed).toBe(seed);
      expect(persona.physicalForm).toContain("rumpled suit");
      expect(persona.backstory).toContain("defending clients");

      // Verify psychological profile
      expect(persona.coreTraits).toContain("Skeptical");
      expect(persona.coreTraits).toContain("Analytical");
      expect(persona.coreTraits).toHaveLength(5);
      expect(persona.cognitiveStyle).toBe("Logical-Sequential");
      expect(persona.moralAlignment).toBe("Lawful Neutral");

      // Verify behavioral model
      expect(persona.communicationCadence).toBe("Measured and precise");
      expect(persona.verbalTics).toContain("Based on the evidence...");
      expect(persona.humorStyle).toBe("Dry");
      expect(persona.socialTendency).toBe("Introverted");
      expect(persona.conflictStyle).toBe("Authoritative");

      // Verify relational profile
      expect(persona.primaryGoal).toContain("truth");
      expect(persona.keyFlaw).toContain("Paranoia");
      expect(persona.keyMemory).toContain("case");

      // Verify dynamic state
      expect(persona.happiness).toBe(4);
      expect(persona.stress).toBe(7);
      expect(persona.curiosity).toBe(9);
      expect(persona.anger).toBe(3);

      // Verify metadata
      expect(persona.origin).toBe("seed");
      expect(persona.role).toBe(role);
    });

    it("should include role in API prompt", async () => {
      const seed = "A quiet observer who watches everything";
      const role = "SHERIFF";

      await gameEngine.generatePersonaFromSeed(seed, role);

      // Verify the API call includes the role
      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.messages[1].content).toContain("SHERIFF");
    });

    it("should fall back to procedural generation when API fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("API Error"));

      const seed = "A test seed for fallback";
      const role = "VILLAGER";

      const persona = await gameEngine.generatePersonaFromSeed(seed, role);

      // Should still return valid persona
      expect(persona).toBeDefined();
      expect(persona.name).toBeDefined();
      expect(persona.coreTraits).toBeInstanceOf(Array);
      expect(persona.seed).toBe(seed);
    });

    it("should fall back when API returns invalid JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          choices: [{ message: { content: "invalid json" } }],
        }),
      });

      const seed = "Another test seed";
      const role = "DOCTOR";

      const persona = await gameEngine.generatePersonaFromSeed(seed, role);

      expect(persona).toBeDefined();
      expect(persona.seed).toBe(seed);
    });
  });

  describe("generateProceduralPersona()", () => {
    it("should generate valid persona without API key", async () => {
      vi.resetModules();
      delete process.env.OPENAI_API_KEY;

      const gameEngine = await import("../../../../game-engine.js");
      const seed = "A leader who commands respect";
      const role = "MAFIA";

      const persona = gameEngine.generateProceduralPersona(seed, role);

      expect(persona).toBeDefined();
      expect(persona.name).toBeDefined();
      expect(persona.coreTraits).toBeInstanceOf(Array);
      expect(persona.coreTraits.length).toBeGreaterThanOrEqual(3);
      expect(persona.moralAlignment).toBeDefined();
      expect(persona.seed).toBe(seed);
    });

    it("should detect archetype hints from seed", () => {
      const gameEngine = require("../../../../game-engine.js");

      // Test leader detection
      const leaderSeed = "A commanding leader who takes charge";
      const leaderPersona = gameEngine.generateProceduralPersona(
        leaderSeed,
        "VILLAGER",
      );
      expect(leaderPersona.coreTraits).toContain("Charismatic");

      // Test detective detection
      const detectiveSeed = "A detective who investigates clues";
      const detectivePersona = gameEngine.generateProceduralPersona(
        detectiveSeed,
        "SHERIFF",
      );
      expect(detectivePersona.coreTraits).toContain("Observant");

      // Test scientist detection
      const scientistSeed = "A brilliant scientist who analyzes data";
      const scientistPersona = gameEngine.generateProceduralPersona(
        scientistSeed,
        "VILLAGER",
      );
      expect(scientistPersona.coreTraits).toContain("Brilliant");
    });

    it("should extract name from seed if present", () => {
      const gameEngine = require("../../../../game-engine.js");

      const seed = "Morgan is a charismatic leader";
      const persona = gameEngine.generateProceduralPersona(seed, "MAFIA");

      expect(persona.name).toContain("Morgan");
    });
  });

  describe("generateNameFromSeed()", () => {
    it("should generate unique name from seed", () => {
      const gameEngine = require("../../../../game-engine.js");

      const seed1 = "A mysterious stranger";
      const seed2 = "Another mysterious stranger";

      const name1 = gameEngine.generateNameFromSeed(seed1);
      const name2 = gameEngine.generateNameFromSeed(seed2);

      expect(name1).toBeDefined();
      expect(name2).toBeDefined();
      expect(name1).not.toBe(name2); // Different random names
    });

    it("should extract existing name from seed", () => {
      const gameEngine = require("../../../../game-engine.js");

      const seed = "Morgan is new in town";
      const name = gameEngine.generateNameFromSeed(seed);

      expect(name).toContain("Morgan");
    });
  });
});

describe("Simulated Self v2 Template Fields", () => {
  it("should have all required v2 fields in generated persona", async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = mockApiKey;

    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => mockPersonaResponse,
    });
    vi.stubGlobal("fetch", mockFetch);

    const gameEngine = await import("../../../../game-engine.js");
    const persona = await gameEngine.generatePersonaFromSeed(
      "Test seed",
      "MAFIA",
    );

    // Core Identity
    expect(persona).toHaveProperty("name");
    expect(persona).toHaveProperty("seed");
    expect(persona).toHaveProperty("physicalForm");
    expect(persona).toHaveProperty("backstory");

    // Psychological Profile
    expect(persona).toHaveProperty("coreTraits");
    expect(persona).toHaveProperty("cognitiveStyle");
    expect(persona).toHaveProperty("coreValues");
    expect(persona).toHaveProperty("moralAlignment");

    // Behavioral Model
    expect(persona).toHaveProperty("communicationCadence");
    expect(persona).toHaveProperty("verbalTics");
    expect(persona).toHaveProperty("humorStyle");
    expect(persona).toHaveProperty("socialTendency");
    expect(persona).toHaveProperty("conflictStyle");

    // Relational Profile
    expect(persona).toHaveProperty("primaryGoal");
    expect(persona).toHaveProperty("keyFlaw");
    expect(persona).toHaveProperty("keyMemory");

    // Dynamic State
    expect(persona).toHaveProperty("happiness");
    expect(persona).toHaveProperty("stress");
    expect(persona).toHaveProperty("curiosity");
    expect(persona).toHaveProperty("anger");

    // Metadata
    expect(persona).toHaveProperty("origin");
    expect(persona).toHaveProperty("role");

    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it("should have emotional scales within valid range (1-10)", async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = mockApiKey;

    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => mockPersonaResponse,
    });
    vi.stubGlobal("fetch", mockFetch);

    const gameEngine = await import("../../../../game-engine.js");
    const persona = await gameEngine.generatePersonaFromSeed(
      "Test seed",
      "VILLAGER",
    );

    expect(persona.happiness).toBeGreaterThanOrEqual(1);
    expect(persona.happiness).toBeLessThanOrEqual(10);
    expect(persona.stress).toBeGreaterThanOrEqual(1);
    expect(persona.stress).toBeLessThanOrEqual(10);
    expect(persona.curiosity).toBeGreaterThanOrEqual(1);
    expect(persona.curiosity).toBeLessThanOrEqual(10);
    expect(persona.anger).toBeGreaterThanOrEqual(1);
    expect(persona.anger).toBeLessThanOrEqual(10);

    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });
});

describe("Persona Seed Quality", () => {
  it("should handle short seeds", async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = mockApiKey;

    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Test Person",
                coreTraits: ["Test", "Traits"],
                primaryGoal: "Test goal",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const gameEngine = await import("../../../../game-engine.js");
    const persona = await gameEngine.generatePersonaFromSeed(
      "Short",
      "VILLAGER",
    );

    expect(persona.name).toBe("Test Person");
    expect(persona.coreTraits).toEqual(["Test", "Traits"]);

    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it("should handle long, detailed seeds", async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = mockApiKey;

    const longSeed = `A former undercover cop who infiltrated the mafia five years ago,
      developed a gambling addiction, lost everything, and now distrusts everyone.
      Speaks in short, clipped sentences. Has a tell when lying - touches their ear.`;

    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Frank Castle",
                backstory: longSeed,
                coreTraits: ["Distrustful", "Observant", "Direct"],
                communicationCadence: "Short and clipped",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const gameEngine = await import("../../../../game-engine.js");
    const persona = await gameEngine.generatePersonaFromSeed(
      longSeed,
      "SHERIFF",
    );

    expect(persona.backstory).toContain("undercover");
    expect(persona.communicationCadence).toBe("Short and clipped");

    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });
});
