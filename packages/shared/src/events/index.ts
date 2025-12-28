/**
 * Events Module
 * 
 * Event schemas and validation for the Mafia AI Benchmark system.
 * Events are the core of the event-sourced game state.
 */

import { RoleType, GamePhase, Agent } from '../types/index.js';

// Event visibility levels
export type EventVisibility = 'PUBLIC' | 'PRIVATE' | 'ADMIN';

// Event interface
export interface GameEvent {
  id: string;
  gameId: string;
  type: EventType;
  timestamp: Date;
  visibility: EventVisibility;
  actorId?: string;
  targetId?: string;
  data: EventData;
  metadata: EventMetadata;
}

export interface EventMetadata {
  turnNumber: number;
  dayNumber: number;
  phase: GamePhase;
  sequence: number;
}

// Event types
export type EventType =
  // Game lifecycle events
  | 'GAME_CREATED'
  | 'GAME_STARTED'
  | 'GAME_ENDED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED'
  | 'GAME_CANCELLED'
  
  // Player events
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'PLAYER_ELIMINATED'
  | 'PLAYER_REVIVED'
  
  // Role events
  | 'ROLES_ASSIGNED'
  | 'ROLE_REVEALED'
  | 'ROLE_CLAIMED'
  
  // Phase events
  | 'PHASE_CHANGED'
  | 'NIGHT_STARTED'
  | 'NIGHT_ENDED'
  | 'DAY_STARTED'
  | 'MORNING_REVEAL'
  | 'VOTING_STARTED'
  | 'VOTING_ENDED'
  
  // Action events
  | 'VOTE_CAST'
  | 'VOTE_RETRACTED'
  | 'ACCUSATION_MADE'
  | 'ACCUSATION_DEFENDED'
  | 'NIGHT_ACTION_SUBMITTED'
  
  // Mafia events
  | 'MAFIA_KILL_ATTEMPTED'
  | 'MAFIA_KILL_SUCCEEDED'
  | 'MAFIA_KILL_FAILED'
  | 'MAFIA_KILL_BLOCKED'
  | 'MAFIA_TEAM_NOTIFIED'
  
  // Doctor events
  | 'DOCTOR_PROTECTION_SUBMITTED'
  | 'DOCTOR_PROTECTION_SUCCESSFUL'
  | 'DOCTOR_PROTECTION_FAILED'
  | 'SELF_PROTECTION_DETECTED'
  
  // Sheriff events
  | 'SHERIFF_INVESTIGATION_SUBMITTED'
  | 'SHERIFF_INVESTIGATION_RESULT'
  | 'SHERIFF_INVESTIGATION_FAILED'
  
  // Vigilante events
  | 'VIGILANTE_SHOT_SUBMITTED'
  | 'VIGILANTE_SHOT_FIRED'
  | 'VIGILANTE_SHOT_MISSED'
  | 'VIGILANTE_SHOT_HIT'
  
  // Resolution events
  | 'PLAYER_LYNCHED'
  | 'PLAYER_KILLED'
  | 'WINNER_DETERMINED'
  | 'MAFIA_WINS'
  | 'TOWN_WINS'
  
  // Agent events
  | 'AGENT_THINK_STARTED'
  | 'AGENT_THINK_COMPLETED'
  | 'AGENT_SAYS_BROADCASTED'
  | 'AGENT_ACTION_TAKEN'
  | 'AGENT_ERROR'
  
  // Admin events
  | 'GAME_CONFIG_CHANGED'
  | 'TIMEOUT_EXTENDED'
  | 'ADMIN_INTERVENTION'
  | 'DEBUG_COMMAND';

// Game phase type (re-exported for event context)
export type GamePhase = 
  | 'SETUP' 
  | 'NIGHT_ACTIONS' 
  | 'MORNING_REVEAL' 
  | 'DAY_DISCUSSION' 
  | 'DAY_VOTING' 
  | 'RESOLUTION' 
  | 'GAME_OVER';

// Event data types for each event type
export interface GameCreatedEventData {
  config: GameConfig;
  hostPlayerId: string;
}

export interface GameStartedEventData {
  dayNumber: number;
  turnNumber: number;
  players: PlayerSetup[];
}

export interface PlayerSetup {
  playerId: string;
  name: string;
  role: RoleType;
  agentId?: string;
}

export interface GameEndedEventData {
  winner: 'MAFIA' | 'TOWN';
  reason: string;
  duration: number;
  dayCount: number;
  finalScores: PlayerFinalScore[];
}

export interface PlayerFinalScore {
  playerId: string;
  role: RoleType;
  survived: boolean;
  performance: number;
  tokensUsed: number;
}

export interface PlayerJoinedEventData {
  playerId: string;
  name: string;
  agent?: Agent;
  joinOrder: number;
}

export interface PlayerEliminatedEventData {
  playerId: string;
  role: RoleType;
  killerId?: string;
  cause: 'LYNCHED' | 'KILLED' | 'LEFT';
  votes?: number;
  dayNumber: number;
}

export interface RolesAssignedEventData {
  assignments: RoleAssignment[];
  mafiaTeam: string[];
}

export interface RoleAssignment {
  playerId: string;
  role: RoleType;
}

export interface PhaseChangedEventData {
  fromPhase: GamePhase;
  toPhase: GamePhase;
  dayNumber: number;
  turnNumber: number;
  timeRemaining: number;
}

export interface NightStartedEventData {
  nightNumber: number;
  alivePlayers: string[];
  roles: NightRoleInfo[];
}

export interface NightRoleInfo {
  playerId: string;
  role: RoleType;
  canAct: boolean;
}

export interface MorningRevealEventData {
  nightNumber: number;
  deaths: DeathInfo[];
  protections: ProtectionInfo[];
}

export interface DeathInfo {
  playerId: string;
  role: RoleType;
  killedBy?: string;
  protected: boolean;
}

export interface ProtectionInfo {
  doctorId: string;
  targetId: string;
  successful: boolean;
}

export interface VoteCastEventData {
  voterId: string;
  targetId: string;
  dayNumber: number;
  turnNumber: number;
  voteNumber: number;
  final: boolean;
}

export interface AccusationMadeEventData {
  accuserId: string;
  targetId: string;
  accusation: string;
  evidence: string;
  dayNumber: number;
}

export interface NightActionSubmittedEventData {
  actorId: string;
  action: NightActionType;
  targetId: string;
  nightNumber: number;
}

export type NightActionType = 
  | 'MAFIA_KILL' 
  | 'DOCTOR_PROTECT' 
  | 'SHERIFF_INVESTIGATE' 
  | 'VIGILANTE_SHOOT';

export interface MafiaKillAttemptedEventData {
  killerId: string;
  targetId: string;
  nightNumber: number;
  killersTeam: string[];
}

export interface MafiaKillResultEventData {
  killerId: string;
  targetId: string;
  successful: boolean;
  blocked: boolean;
  blockedBy?: string;
  protected: boolean;
  protectedBy?: string;
  role: RoleType;
}

export interface DoctorProtectionEventData {
  doctorId: string;
  targetId: string;
  successful: boolean;
  selfProtection: boolean;
}

export interface SheriffInvestigationEventData {
  sheriffId: string;
  targetId: string;
  result: 'MAFIA' | 'NOT_MAFIA';
  accurate: boolean;
  targetRole: RoleType;
}

export interface VigilanteShotEventData {
  vigilanteId: string;
  targetId: string;
  nightNumber: number;
  shotNumber: number;
  successful: boolean;
  targetRole: RoleType;
}

export interface PlayerLynchedEventData {
  playerId: string;
  role: RoleType;
  votes: number;
  totalVotes: number;
  dayNumber: number;
  tied: boolean;
  tieBreaker?: string;
}

export interface WinnerDeterminedEventData {
  winner: 'MAFIA' | 'TOWN';
  mafiaCount: number;
  townCount: number;
  mafiaAlive: boolean[];
  townAlive: boolean[];
}

export interface AgentThinkEventData {
  agentId: string;
  playerId: string;
  turnNumber: number;
  phase: GamePhase;
  context: AgentContext;
  promptTokens: number;
  model: string;
}

export interface AgentContext {
  gameState: string;
  recentEvents: string[];
  playerInfo: PlayerInfo[];
  memory: AgentMemory;
}

export interface PlayerInfo {
  playerId: string;
  name: string;
  role: RoleType;
  alive: boolean;
  statements: string[];
}

export interface AgentMemory {
  gameHistory: GameHistoryEntry[];
  nightContext: NightContext;
  dayContext: DayContext;
  internalMonologue: InternalMonologue;
  privateInfo: PrivateInfo;
}

export interface GameHistoryEntry {
  turnNumber: number;
  phase: GamePhase;
  dayNumber: number;
  playerId: string;
  action: string;
  statement: string;
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

export interface AgentSaysEventData {
  agentId: string;
  playerId: string;
  turnNumber: number;
  phase: GamePhase;
  statement: string;
  completionTokens: number;
  model: string;
}

export interface AgentActionEventData {
  agentId: string;
  playerId: string;
  action: AgentActionType;
  targetId?: string;
  confidence: number;
  reasoning: string;
  turnNumber: number;
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

// Event data union type
export type EventData =
  | GameCreatedEventData
  | GameStartedEventData
  | GameEndedEventData
  | PlayerJoinedEventData
  | PlayerEliminatedEventData
  | RolesAssignedEventData
  | PhaseChangedEventData
  | NightStartedEventData
  | MorningRevealEventData
  | VoteCastEventData
  | AccusationMadeEventData
  | NightActionSubmittedEventData
  | MafiaKillResultEventData
  | DoctorProtectionEventData
  | SheriffInvestigationEventData
  | VigilanteShotEventData
  | PlayerLynchedEventData
  | WinnerDeterminedEventData
  | AgentThinkEventData
  | AgentSaysEventData
  | AgentActionEventData
  | Record<string, unknown>;

// Game configuration type
export interface GameConfig {
  numPlayers: number;
  roles: RoleConfig[];
  nightPhaseDuration: number;
  dayPhaseDuration: number;
  votingDuration: number;
  maxPlayers: number;
  minPlayers: number;
  allowSelfVote: boolean;
  tieBreaker: TieBreakerType;
  enable3D: boolean;
  enableVoice: boolean;
  logLevel: LogLevel;
}

export interface RoleConfig {
  role: RoleType;
  count: number;
}

export type RoleType = 
  | 'MAFIA' 
  | 'DOCTOR' 
  | 'SHERIFF' 
  | 'VIGILANTE' 
  | 'VILLAGER';

export type TieBreakerType = 'RANDOM' | 'FIRST' | 'LAST' | 'SKIP';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Event factory functions
export function createEvent<T extends EventType>(
  gameId: string,
  type: T,
  visibility: EventVisibility,
  actorId: string | undefined,
  data: EventData,
  metadata: EventMetadata
): GameEvent {
  return {
    id: crypto.randomUUID(),
    gameId,
    type,
    timestamp: new Date(),
    visibility,
    actorId,
    targetId: getTargetIdFromData(data),
    data,
    metadata,
  };
}

function getTargetIdFromData(data: EventData): string | undefined {
  if (data && typeof data === 'object' && 'targetId' in data) {
    return (data as { targetId?: string }).targetId;
  }
  return undefined;
}

// Event validation
export function validateEvent(event: GameEvent): boolean {
  // Basic validation
  if (!event.id || !event.gameId || !event.type) {
    return false;
  }
  
  // Validate timestamp
  if (!(event.timestamp instanceof Date) || isNaN(event.timestamp.getTime())) {
    return false;
  }
  
  // Validate visibility
  if (!['PUBLIC', 'PRIVATE', 'ADMIN'].includes(event.visibility)) {
    return false;
  }
  
  return true;
}

// Event filtering for visibility
export function filterEventsByVisibility(
  events: GameEvent[],
  visibility: EventVisibility
): GameEvent[] {
  return events.filter(event => {
    if (visibility === 'ADMIN') {
      return true; // Admin sees everything
    }
    if (event.visibility === 'ADMIN') {
      return false; // Non-admin doesn't see admin events
    }
    if (visibility === 'PUBLIC') {
      return event.visibility === 'PUBLIC';
    }
    // PRIVATE sees public + private
    return ['PUBLIC', 'PRIVATE'].includes(event.visibility);
  });
}

// Event query helpers
export function getEventsByType(events: GameEvent[], type: EventType): GameEvent[] {
  return events.filter(event => event.type === type);
}

export function getEventsByActor(events: GameEvent[], actorId: string): GameEvent[] {
  return events.filter(event => event.actorId === actorId);
}

export function getEventsByPhase(events: GameEvent[], phase: GamePhase): GameEvent[] {
  return events.filter(event => event.metadata.phase === phase);
}

export function getEventsByDay(events: GameEvent[], dayNumber: number): GameEvent[] {
  return events.filter(event => event.metadata.dayNumber === dayNumber);
}

// All event types are exported above
