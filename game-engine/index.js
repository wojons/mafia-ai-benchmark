// ============================================
// GAME ENGINE INDEX
// Central entry point for all game-engine modules
// ============================================

// Constants and utilities
const {
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
} = require("./utils");

// Persona generation
const {
  generatePersona,
  generateProceduralPersona,
  PERSONA_SYSTEM_PROMPT,
} = require("./persona/generator");

// Events and prompts
const { createGameEvent, createPrompt } = require("./events");

// Role management and conflicts
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
} = require("./roles");

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
  generateProceduralPersona,
  PERSONA_SYSTEM_PROMPT,

  // Events
  createGameEvent,
  createPrompt,

  // Roles
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

  // Database
  getGameDatabase,

  // Global state
  API_KEY: process.env.OPENAI_API_KEY,
  DB_PATH: process.env.DB_PATH || "./data/mafia.db",
};
