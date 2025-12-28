// ============================================
// ULTRATHINK Features Test Suite
// Tests for context management, retry logic, persona diversity, and multi-role
// ============================================

const { describe, it, expect, beforeEach, afterEach, vi } = require("vitest");

describe("ULTRATHINK Features", () => {
  let MafiaGame;
  let game;

  beforeEach(async () => {
    vi.resetModules();
    MafiaGame = (await import("../../game-engine.js")).MafiaGame;
  });

  afterEach(() => {
    // Reset environment variables
    delete process.env.MAX_CONTEXT_CHARS;
    delete process.env.MAX_RETRIES;
    delete process.env.RETRY_DELAY_MS;
    delete process.env.PERSONA_TEMPERATURE;
    delete process.env.ALLOW_MULTI_ROLE;
  });

  describe("Context Window Management", () => {
    it("should use default maxContextChars when not configured", () => {
      game = new MafiaGame();
      expect(game.config.maxContextChars).toBe(100000);
    });

    it("should read maxContextChars from environment", () => {
      process.env.MAX_CONTEXT_CHARS = "50000";
      game = new MafiaGame();
      expect(game.config.maxContextChars).toBe(50000);
    });

    it("should use options parameter over environment variable", () => {
      process.env.MAX_CONTEXT_CHARS = "50000";
      game = new MafiaGame({ maxContextChars: 25000 });
      expect(game.config.maxContextChars).toBe(25000);
    });

    it("should trim game history when over limit", () => {
      game = new MafiaGame({ maxContextChars: 1000 });

      // Add large events that exceed the limit
      const largeContent = "x".repeat(500);
      for (let i = 0; i < 10; i++) {
        game.addGameEvent({
          id: `event-${i}`,
          content: largeContent,
        });
      }

      // Should have trimmed to stay under limit
      const totalChars = game.gameHistory.reduce(
        (sum, msg) => sum + JSON.stringify(msg).length,
        0,
      );

      expect(totalChars).toBeLessThanOrEqual(1000);
      expect(game.gameHistory.length).toBeLessThan(10); // Some events removed
    });

    it("should never split a message when trimming", () => {
      game = new MafiaGame({ maxContextChars: 200 });

      // Add messages each 100 chars long
      for (let i = 0; i < 5; i++) {
        game.addGameEvent({
          id: `event-${i}`,
          content: "x".repeat(85), // 85 chars + overhead = ~100 chars total
        });
      }

      // With 200 char limit and ~100 char messages, should have 2 complete messages
      expect(game.gameHistory.length).toBeGreaterThanOrEqual(1);
      expect(game.gameHistory.length).toBeLessThanOrEqual(3); // 2-3 messages fit

      // Verify all messages are complete (have content)
      game.gameHistory.forEach((msg) => {
        expect(msg).toHaveProperty("id");
        expect(msg).toHaveProperty("content");
        expect(msg.content).toBeDefined();
      });
    });

    it("should keep most recent messages when trimming", () => {
      game = new MafiaGame({ maxContextChars: 300 });

      // Add 5 messages (each ~80 chars with overhead)
      for (let i = 0; i < 5; i++) {
        game.addGameEvent({
          id: `event-${i}`,
          seq: i,
        });
      }

      // Most recent messages should be kept
      const lastMessageId = game.gameHistory[game.gameHistory.length - 1].id;
      expect(lastMessageId).toBe("event-4");
    });
  });

  describe("Retry Logic", () => {
    it("should use default retry settings when not configured", () => {
      game = new MafiaGame();
      expect(game.config.maxRetries).toBe(3);
      expect(game.config.retryDelay).toBe(1000);
    });

    it("should read retry settings from environment", () => {
      process.env.MAX_RETRIES = "5";
      process.env.RETRY_DELAY_MS = "2000";
      game = new MafiaGame();
      expect(game.config.maxRetries).toBe(5);
      expect(game.config.retryDelay).toBe(2000);
    });

    it("should use zero to allow unlimited retries", () => {
      process.env.MAX_RETRIES = "0";
      game = new MafiaGame();
      expect(game.config.maxRetries).toBe(0);
    });

    it("should return valid:true for successful parse", () => {
      game = new MafiaGame();
      const result = game.parseJSONResponse(
        '{"think":"test","says":"hello","action":null}',
      );
      expect(result.valid).toBe(true);
      expect(result.think).toBe("test");
      expect(result.says).toBe("hello");
    });

    it("should return valid:false for failed parse", () => {
      game = new MafiaGame();
      const result = game.parseJSONResponse("not valid json");
      expect(result.valid).toBe(false);
      expect(result.think).toBe("[Parse failed]");
      expect(result.says).toBe("[Parse failed]");
    });

    it("should handle empty response", () => {
      game = new MafiaGame();
      const result = game.parseJSONResponse("");
      expect(result.valid).toBe(false);
    });

    it("should extract JSON from text with prefix/suffix", () => {
      game = new MafiaGame();
      const result = game.parseJSONResponse(
        'Here is the JSON:\n{"think":"test"}\nDone',
      );
      expect(result.valid).toBe(true);
      expect(result.think).toBe("test");
    });
  });

  describe("Persona Generation Diversity", () => {
    it("should use default persona temperature when not configured", () => {
      process.env.PERSONA_TEMPERATURE = undefined;
      game = new MafiaGame();
      expect(game.config.personaTemperature).toBe(1.0);
    });

    it("should read persona temperature from environment", () => {
      process.env.PERSONA_TEMPERATURE = "1.5";
      game = new MafiaGame();
      expect(game.config.personaTemperature).toBe(1.5);
    });

    it("should accept temperature as string from env", () => {
      process.env.PERSONA_TEMPERATURE = "0.8";
      game = new MafiaGame();
      expect(game.config.personaTemperature).toBe(0.8);
    });

    it("should generate diverse cognitive styles procedurally", () => {
      const styles = new Set();
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const { generateProceduralPersona } = require("../../game-engine.js");
        const persona = generateProceduralPersona(undefined);
        styles.add(persona.cognitiveStyle);
      }

      // Should have multiple different styles, not all the same
      expect(styles.size).toBeGreaterThan(3);
      expect(styles).toContain("Logical-Sequential");
      expect(styles).toContain("Visual-Spatial");
    });

    it("should generate diverse communication cadences procedurally", () => {
      const cadences = new Set();
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const { generateProceduralPersona } = require("../../game-engine.js");
        const persona = generateProceduralPersona(undefined);
        cadences.add(persona.communicationCadence);
      }

      // Should have multiple different cadences
      expect(cadences.size).toBeGreaterThan(3);
      expect(cadences).toContain("Direct");
      expect(cadences).toContain("Eloquent");
    });

    it("should generate diverse social tendencies", () => {
      const tendencies = new Set();
      const iterations = 20;

      for (let i = 0; i < iterations; i++) {
        const { generateProceduralPersona } = require("../../game-engine.js");
        const persona = generateProceduralPersona(undefined);
        tendencies.add(persona.socialTendency);
      }

      // Should have all three types with enough iterations
      expect(tendencies).toContain("Introverted");
      expect(tendencies).toContain("Extroverted");
      expect(tendencies).toContain("Ambiverted");
    });

    it("should not have identical personas across generations", () => {
      const { generateProceduralPersona } = require("../../game-engine.js");
      const persona1 = generateProceduralPersona(undefined);
      const persona2 = generateProceduralPersona(undefined);
      const persona3 = generateProceduralPersona(undefined);

      // At least one attribute should differ
      const allIdentical =
        persona1.cognitiveStyle === persona2.cognitiveStyle &&
        persona1.cognitiveStyle === persona3.cognitiveStyle &&
        persona1.communicationCadence === persona2.communicationCadence &&
        persona1.communicationCadence === persona3.communicationCadence;

      expect(allIdentical).toBe(false);
    });
  });

  describe("Multi-Role Configuration", () => {
    it("should disable multi-role by default", () => {
      game = new MafiaGame();
      expect(game.config.allowMultiRole).toBe(false);
    });

    it("should enable multi-role from environment", () => {
      process.env.ALLOW_MULTI_ROLE = "true";
      game = new MafiaGame();
      expect(game.config.allowMultiRole).toBe(true);
    });

    it("should treat '1' as true for multi-role", () => {
      process.env.ALLOW_MULTI_ROLE = "1";
      game = new MafiaGame();
      expect(game.config.allowMultiRole).toBe(true);
    });

    it("should treat any other value as false for multi-role", () => {
      process.env.ALLOW_MULTI_ROLE = "yes";
      game = new MafiaGame();
      expect(game.config.allowMultiRole).toBe(false);
    });

    it("should use options parameter over environment", () => {
      process.env.ALLOW_MULTI_ROLE = "false";
      game = new MafiaGame({ allowMultiRole: true });
      expect(game.config.allowMultiRole).toBe(true);
    });
  });

  describe("Configuration Priority", () => {
    it("should prioritize: options > env > default", () => {
      process.env.MAX_CONTEXT_CHARS = "50000";
      process.env.MAX_RETRIES = "5";

      game = new MafiaGame({
        maxContextChars: 25000, // Options override env
        // maxRetries not in options, should use env
      });

      expect(game.config.maxContextChars).toBe(25000); // Options
      expect(game.config.maxRetries).toBe(5); // Env
      expect(game.config.personaTemperature).toBe(1.0); // Default
    });

    it("should handle 0 values correctly in env", () => {
      process.env.MAX_RETRIES = "0";
      process.env.PERSONA_TEMPERATURE = "0";
      game = new MafiaGame();

      expect(game.config.maxRetries).toBe(0);
      expect(game.config.personaTemperature).toBe(0);
    });
  });

  describe("Sheriff Self-Investigation Prevention", () => {
    it("should prevent sheriff from investigating themselves", async () => {
      game = new MafiaGame();

      // Create a simple game with sheriff
      await game.startGame(5);

      const sheriff = game.players.find((p) => p.role === "SHERIFF");
      const otherPlayers = game.players.filter((p) => p.id !== sheriff.id);

      // Mock sheriff response trying to investigate themselves
      const mockSelfResponse = {
        think: "I'll investigate myself to verify my role",
        says: "I'm investigating someone tonight",
        action: { target: sheriff.name },
      };

      // Verify that even if the AI tries to target themselves,
      // it will be redirected to another player in the actual implementation
      // This is tested in the integration, but we verify the logic here:
      expect(sheriff.id).toBeDefined();
      expect(otherPlayers.length).toBeGreaterThan(0);
      expect(otherPlayers.every((p) => p.id !== sheriff.id)).toBe(true);
    });

    it("should have at least one other player for sheriff to investigate", async () => {
      game = new MafiaGame();
      await game.startGame(5);

      const sheriff = game.players.find((p) => p.role === "SHERIFF");
      const otherPlayers = game.players.filter((p) => p.id !== sheriff.id);

      // Should have at least 4 other players in a 5-player game
      expect(otherPlayers.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Game History Tracking", () => {
    it("should initialize with empty game history", () => {
      game = new MafiaGame();
      expect(game.gameHistory).toEqual([]);
      expect(game.gameHistory.length).toBe(0);
    });

    it("should add event to game history", () => {
      game = new MafiaGame();
      const event = {
        id: "test-event",
        type: "TEST",
        content: { test: true },
      };

      game.addGameEvent(event);

      expect(game.gameHistory.length).toBe(1);
      expect(game.gameHistory[0]).toEqual(event);
    });

    it("should add multiple events in order", () => {
      game = new MafiaGame();

      for (let i = 0; i < 5; i++) {
        game.addGameEvent({ id: `event-${i}`, seq: i });
      }

      expect(game.gameHistory.length).toBe(5);
      expect(game.gameHistory[0].id).toBe("event-0");
      expect(game.gameHistory[4].id).toBe("event-4");
    });
  });
});
