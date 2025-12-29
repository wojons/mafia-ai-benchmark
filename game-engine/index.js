// ============================================
// GAME ENGINE INDEX
// Central entry point for all game-engine modules
// ============================================

// Constants and utilities
const { E, roleEmojis, simpleUUID } = require("./utils");

// Persona generation
const {
  generatePersona,
  generateNameFromSeed,
  generateProceduralPersona,
  PERSONA_SYSTEM_PROMPT,
} = require("./persona/generator");

// Events and prompts
const { createGameEvent, createPrompt } = require("./events");

// Database helper
async function getGameDatabase() {
  if (!gameDatabase) {
    const { GameDatabase } = require("../modules/database.js");
    gameDatabase = new GameDatabase(DB_PATH);
    await gameDatabase.connect();
  }
  return gameDatabase;
}

// Global state (for database singleton)
let gameDatabase = null;
let API_KEY = process.env.OPENAI_API_KEY;
const DB_PATH = process.env.DB_PATH || "./data/mafia.db";

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Utils
  E,
  roleEmojis,
  simpleUUID,

  // Persona
  generatePersona,
  generateNameFromSeed,
  generateProceduralPersona,
  PERSONA_SYSTEM_PROMPT,

  // Events
  createGameEvent,
  createPrompt,

  // Database
  getGameDatabase,

  // Global state
  API_KEY: process.env.OPENAI_API_KEY,
  DB_PATH: process.env.DB_PATH || "./data/mafia.db",
};
