/**
 * Core Types Index
 * 
 * All core types used throughout the Mafia AI Benchmark system.
 */

// Player types
export interface Player {
  id: string;
  name: string;
  role: RoleType;
  isAlive: boolean;
  isMafia: boolean;
  joinOrder: number;
}

export type RoleType = 
  | 'MAFIA' 
  | 'DOCTOR' 
  | 'SHERIFF' 
  | 'VIGILANTE' 
  | 'VILLAGER';

export type TeamType = 'MAFIA' | 'TOWN';

// Game types
export interface Game {
  id: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  status: GameStatus;
  players: Player[];
  config: GameConfig;
  currentState: GameState;
  events: GameEvent[];
}

export type GameStatus = 
  | 'SETUP' 
  | 'IN_PROGRESS' 
  | 'PAUSED' 
  | 'ENDED' 
  | 'CANCELLED';

export interface GameConfig {
  numPlayers: number;
  roles: RoleConfig[];
  nightPhaseDuration: number;  // seconds
  dayPhaseDuration: number;    // seconds
  votingDuration: number;      // seconds
  maxPlayers: number;
  minPlayers: number;
  allowSelfVote: boolean;
  tieBreaker: TieBreakerType;
  enable3D: boolean;
  enableVoice: boolean;
  logLevel: LogLevel;
}

export type RoleConfig = {
  role: RoleType;
  count: number;
};

export type TieBreakerType = 'RANDOM' | 'FIRST' | 'LAST' | 'SKIP';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Turn and Phase types
export interface GameState {
  phase: GamePhase;
  dayNumber: number;
  turnNumber: number;
  timeRemaining: number;
  activePlayers: string[];
  eliminatedPlayers: string[];
  votes: Vote[];
  nightActions: NightAction[];
  currentActor?: string;
}

export type GamePhase = 
  | 'SETUP' 
  | 'NIGHT_ACTIONS' 
  | 'MORNING_REVEAL' 
  | 'DAY_DISCUSSION' 
  | 'DAY_VOTING' 
  | 'RESOLUTION' 
  | 'GAME_OVER';

// Action types
export interface Vote {
  voterId: string;
  targetId: string;
  timestamp: Date;
  phase: GamePhase;
  dayNumber: number;
}

export interface NightAction {
  actorId: string;
  action: NightActionType;
  targetId: string;
  timestamp: Date;
  nightNumber: number;
}

export type NightActionType = 
  | 'MAFIA_KILL' 
  | 'DOCTOR_PROTECT' 
  | 'SHERIFF_INVESTIGATE' 
  | 'VIGILANTE_SHOOT';

// Agent types
export interface Agent {
  id: string;
  name: string;
  provider: LLMProvider;
  model: string;
  temperature: number;
  systemPrompt: string;
  maxTokens: number;
  apiKey?: string;
  baseUrl?: string;
}

export type LLMProvider = 
  | 'OPENAI' 
  | 'ANTHROPIC' 
  | 'GOOGLE' 
  | 'META'
  | 'QWEN'
  | 'XAI'
  | 'MOONSHOT'
  | 'DEEPSEEK' 
  | 'GROQ' 
  | 'OLLAMA' 
  | 'LM_STUDIO' 
  | 'CUSTOM';

// Agent response types
export interface AgentResponse {
  think: string;      // Private internal reasoning (hidden)
  says: string;       // Public statement (broadcast)
  action?: AgentAction;
  metadata: AgentMetadata;
}

export interface AgentAction {
  type: AgentActionType;
  target?: string;
  confidence: number;
  reasoning: string;
}

export type AgentActionType = 
  | 'VOTE' 
  | 'ACCUSE' 
  | 'DEFEND' 
  | 'CLAIM_ROLE' 
  | 'INVESTIGATE' 
  | 'PROTECT' 
  | 'KILL' 
  | 'SHOOT' 
  | 'PASS';

export interface AgentMetadata {
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  latency: number;
  cost: number;
  provider: LLMProvider;
  model: string;
  turnNumber: number;
  timestamp: Date;
}

// Memory types
export interface AgentMemory {
  gameId: string;
  playerId: string;
  role: RoleType;
  turnNumber: number;
  gameHistory: GameHistoryEntry[];
  nightContext: NightContext;
  dayContext: DayContext;
  internalMonologue: InternalMonologue;
  privateInfo: PrivateInfo;
  teammates?: string[];
}

export interface GameHistoryEntry {
  turnNumber: number;
  phase: GamePhase;
  dayNumber: number;
  playerId: string;
  action: string;
  statement: string;
  timestamp: Date;
}

export interface NightContext {
  kills: KillRecord[];
  protects: ProtectRecord[];
  investigations: InvestigationRecord[];
  vigilanteShot?: boolean;
}

export interface KillRecord {
  killerId: string;
  targetId: string;
  successful: boolean;
  protected: boolean;
}

export interface ProtectRecord {
  protectorId: string;
  targetId: string;
  successful: boolean;
}

export interface InvestigationRecord {
  investigatorId: string;
  targetId: string;
  result: 'MAFIA' | 'NOT_MAFIA';
}

export interface DayContext {
  votes: VoteRecord[];
  accusations: AccusationRecord[];
  roleClaims: RoleClaimRecord[];
  eliminations: EliminationRecord[];
}

export interface VoteRecord {
  voterId: string;
  targetId: string;
  dayNumber: number;
  final: boolean;
}

export interface AccusationRecord {
  accuserId: string;
  targetId: string;
  dayNumber: number;
  evidence: string;
}

export interface RoleClaimRecord {
  playerId: string;
  claimedRole: RoleType;
  dayNumber: number;
  believable: boolean;
}

export interface EliminationRecord {
  playerId: string;
  dayNumber: number;
  votes: number;
  role: RoleType;
}

export interface InternalMonologue {
  currentSuspects: string[];
  trustMap: Map<string, number>;
  gamePlan: string;
  observations: string[];
  nextMoves: string[];
}

export interface PrivateInfo {
  teammates?: string[];
  investigationResults: InvestigationRecord[];
  protectedBy?: string;
  shotsRemaining?: number;
}

// API types
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: APIError;
  metadata?: APIMetadata;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface APIMetadata {
  timestamp: Date;
  requestId: string;
  version: string;
}

// WebSocket types
export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
  timestamp: Date;
  requestId?: string;
}

export type WSMessageType = 
  | 'JOIN' 
  | 'LEAVE' 
  | 'START_GAME' 
  | 'END_GAME' 
  | 'PAUSE_GAME' 
  | 'RESUME_GAME' 
  | 'PLAYER_ACTION' 
  | 'GAME_STATE_UPDATE' 
  | 'EVENT_BROADCAST' 
  | 'ERROR' 
  | 'PING' 
  | 'PONG';

// Stats types
export interface GameStats {
  gameId: string;
  duration: number;
  turns: number;
  dayCount: number;
  eliminations: number;
  mafiaWins: boolean;
  events: number;
  tokensUsed: number;
  apiCalls: number;
  cost: number;
}

export interface PlayerStats {
  playerId: string;
  gameId: string;
  role: RoleType;
  survived: boolean;
  won: boolean;
  tokensUsed: number;
  apiCalls: number;
  actionsTaken: number;
  correctVotes: number;
  incorrectVotes: number;
  rolePerformance: number;
}

export interface ModelStats {
  provider: LLMProvider;
  model: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRolePerformance: number;
  avgTokensPerGame: number;
  avgCostPerGame: number;
  avgDuration: number;
}
