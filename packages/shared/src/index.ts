/**
 * Mafia AI Benchmark - Shared Core Package
 * 
 * Core types, utilities, and game engine for the Mafia AI Benchmark system.
 * This package contains all shared code between server, web, and CLI applications.
 */

// Re-export types with explicit names to avoid conflicts
export { 
  // From types
  Player,
  Game,
  GameState,
  GameConfig,
  GamePhase,
  RoleType,
  LLMProvider,
  Vote,
  NightAction,
  Agent,
  AgentResponse,
  AgentAction,
  AgentMetadata,
  AgentMemory,
  GameHistoryEntry,
  NightContext,
  DayContext,
  InternalMonologue,
  PrivateInfo,
  GameStats,
  PlayerStats,
  ModelStats,
  APIResponse,
  APIError,
  APIMetadata,
  WSMessage,
  WSMessageType,
} from './types/index.js';

export { 
  // From events
  EventVisibility,
  EventType,
  GameEvent,
  EventMetadata,
  createEvent,
  validateEvent,
  filterEventsByVisibility,
} from './events/index.js';

export {
  // From FSM
  GameFSM,
  createGameFSM,
} from './fsm/index.js';

export {
  // From roles
  getRoleConfig,
  getTeam,
  isMafia,
  canActAtNight,
  hasNightAbility,
  getAbilityFrequency,
  getMafiaTeammates,
  getInvestigationResult,
  generateRolePrompt,
} from './roles/index.js';

export {
  // From providers
  createProvider,
  getAvailableProviders,
  getProviderCapabilities,
  getDefaultModel,
  getProviderModels,
  validateProviderConfig,
  getRecommendedSettings,
  inferProvider,
  getEnvConfig,
  refreshModelMetadata,
  getModelCacheStats,
  ProviderConfig,
  ChatRequest,
  ChatResponse,
  StreamResponse,
  ProviderStats,
  LLMError,
  ERROR_CODES,
  LLMProviderAdapter,
  ProviderCapabilities,
  ProviderFactory,
} from './providers/index.js';

// Version
export const VERSION = '1.0.0';
