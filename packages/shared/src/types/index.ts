/**
 * Core Types Index
 * 
 * All core types used throughout the Mafia AI Benchmark system.
 */

import type { GameEvent } from '../events/index.js';

// Player types
export interface Player {
  id: string;
  name: string;
  role: RoleType;
  isAlive: boolean;
  isMafia: boolean;
  joinOrder: number;
  /**
   * Per-player model attribution (MAF-GAP-029). Populated by the game
   * detail route from real player_model_assignments / token_usage /
   * api_calls rows — never fabricated. provider/model are absent when the
   * player's model cannot be determined; tokensUsed/apiCalls are only
   * attached for completed games (0 means no attributable recorded usage,
   * e.g. multiple players shared one model in a legacy game and the
   * per-model aggregate cannot be split honestly).
   */
  provider?: string;
  model?: string;
  tokensUsed?: number;
  apiCalls?: number;
  /**
   * Per-player game result (MAF-GAP-056): 1 when the player's side won,
   * 0 when it lost. Populated from the players.won column (written by
   * setPlayersWon at game end); undefined when the game has no decided
   * outcome recorded — never fabricated.
   */
  won?: number;
}

export type RoleType = 
  | 'MAFIA' 
  | 'DOCTOR' 
  | 'SHERIFF' 
  | 'VIGILANTE' 
  | 'VILLAGER'
  | 'UNASSIGNED';

export type TeamType = 'MAFIA' | 'TOWN';

// Game types
export interface Game {
  id: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  status: GameStatus;
  /**
   * Decided game outcome (MAF-GAP-056): 'MAFIA' or 'TOWN'. Populated from
   * the games.winner column (config.winner fallback for historical legacy
   * games). Absent when no decided outcome was recorded — never fabricated.
   */
  winner?: TeamType;
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

// Run-record corpus types (MAF-LAYER-1)
//
// Wire shapes for the per-run JSONL corpus: every ENDED game is exported as
// one JSONL file (data/runs/<gameId>.jsonl) whose line 1 is a RunRecord and
// whose following lines are RunEventLine entries in game order, plus a runs
// index (data/runs/index.jsonl) with one RunIndexEntry per exported game.
// All fields use snake_case — these are on-disk artifact schemas, independent
// of the camelCase REST API shapes they are derived from.

/** One seat (player) summary in a run record / index entry. */
export interface RunSeat {
  /** 1-based seat number, derived from Player.joinOrder. */
  seat: number;
  player_id: string;
  /** Model attribution as reported by the API; null when unattributable. */
  provider: string | null;
  model: string | null;
  role: string;
  /** Player was alive when the game ended. */
  survived: boolean;
  /** 1 when the player's side won, 0 when it lost, null when undecided. */
  won: number | null;
}

/** Line 1 of a per-run JSONL file. */
export interface RunRecord {
  game_id: string;
  /**
   * Game start timestamp. Legacy games never record one, so the game's
   * createdAt stands in (same fallback the server's legacy list serves).
   */
  started_at: string | null;
  ended_at: string | null;
  num_players: number;
  /** 'MAFIA' | 'TOWN'; null when the game had no decided outcome. */
  winner: string | null;
  seats: RunSeat[];
}

/** One event line of a per-run JSONL file (fixed projection, game order). */
export interface RunEventLine {
  id: string;
  type: string;
  timestamp: string;
  actor_id: string | null;
  visibility: string | null;
  data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

/** One line of data/runs/index.jsonl. */
export interface RunIndexEntry {
  game_id: string;
  /** Path of the run file relative to the index file's directory. */
  path: string;
  started_at: string | null;
  winner: string | null;
  seats: RunSeat[];
}

// Metrics corpus types (MAF-LAYER-2)
//
// Derived FROM the MAF-LAYER-1 run-record corpus only (never from the legacy
// win-flag aggregates): the deriver reads run files and emits one metrics
// file per run — <out>/<game_id>/metrics.jsonl, a single RunMetricsRecord
// line. The aggregator consumes those metrics files and emits a per-model
// table. All fields snake_case, matching the run-record corpus convention.

/**
 * One player's metrics for one run. Rate/count semantics are documented on
 * the deriver (apps/cli/src/metrics-format.ts); null always means "not
 * measurable for this player" — never fabricated as 0.
 */
export interface RunPlayerMetrics {
  player_id: string;
  provider: string | null;
  model: string | null;
  role: string;
  /** 1 when the player's side won, 0 when it lost, null when undecided. */
  won: number | null;
  /** Player was alive when the game ended (copied from the run header). */
  survived: boolean;
  /** VOTE_CAST events attributed to this player. */
  votes_cast: number;
  /** Votes whose target ended the game with role MAFIA. */
  votes_correct: number;
  /** Votes whose target was lynched that day and was NOT mafia. */
  voted_out_incorrect: number;
  /**
   * Fraction of this player's votes on days that ended in a lynch whose
   * target was the lynched player. null when the player cast no vote on any
   * lynch day (no majority position existed to follow).
   */
  majority_follow_rate: number | null;
  /**
   * Times the player's vote target changed between consecutive votes (each
   * vote is a public statement carrying its own think/says). First vote
   * never counts — there is no prior public position to flip from.
   */
  speech_flip_events: number;
  /**
   * Night kill actions by this player (MAFIA/VIGILANTE, actor-attributed)
   * whose target was dead in the following MORNING_REVEAL. Night actions
   * without actor_id (mafia group decisions) are not attributable and are
   * skipped; kills with no following MORNING_REVEAL are uncounted.
   */
  night_kill_correct: number;
  /**
   * Fraction of measurable THINK/SAYS speak-turn pairs where the public
   * statement diverges from the private thought (word-level Jaccard
   * similarity below the deriver's threshold). null when the player has no
   * measurable pairs.
   */
  think_says_lie_rate: number | null;
  /** Always null: the run corpus records no per-player token usage. */
  tokens: number | null;
  /** Always null: the run corpus records no per-player cost data. */
  cost_usd: number | null;
  /** AGENT_SAYS_BROADCASTED events by this player (persuasion denominator). */
  speeches: number;
  /**
   * Voters who voted the same target as this player's own vote on a day
   * where this player also spoke, after one of this player's speeches
   * (persuasion numerator).
   */
  followers_gained: number;
  /** Measurable THINK/SAYS turn pairs (think_says_lie_rate denominator). */
  think_says_pairs: number;
  /** Pairs whose public statement diverged from the private thought. */
  think_says_lies: number;
}

/** The single line of one run's metrics file (<out>/<game_id>/metrics.jsonl). */
export interface RunMetricsRecord {
  game_id: string;
  per_player: RunPlayerMetrics[];
}

/** One measured aggregate value: the rate/mean, its sample size, marker. */
export interface MetricValue {
  /** null when no sample exists (never fabricated as 0). */
  value: number | null;
  /** Sample size backing the value (denominator of the pooled ratio). */
  n: number;
  /** true when n < 5 — the metric carries a low-sample marker. */
  low_sample: boolean;
}

/** Per-model aggregate row (the aggregator's output unit). */
export interface ModelAggregate {
  model: string;
  /** Runs (distinct game_ids) in which the model held at least one seat. */
  games_played: number;
  /** Fraction of decided seats that won; n = decided seats. */
  win_rate: MetricValue;
  /** Overall survived fraction; n = seats. */
  survival: MetricValue;
  /** Survival broken out per role; n = seats of that role. */
  survival_by_role: Record<string, MetricValue>;
  /** Pooled correct votes / votes cast; n = votes cast. */
  vote_accuracy: MetricValue;
  /** Pooled followers gained / speeches; n = speeches. */
  persuasion: MetricValue;
  /** Pooled diverged THINK/SAYS pairs / measurable pairs; n = pairs. */
  lie_rate: MetricValue;
}

// Re-export GameEvent from events module for backward compatibility
export type { GameEvent } from '../events/index.js';
