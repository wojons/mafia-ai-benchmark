# Agent Interface Specifications

## Overview
Agents implement the `AgentPolicy` interface to participate in the game. This allows for pluggable strategies, from simple scripted heuristics to complex LLM-based reasoning.

## AgentPolicy Interface

```typescript
export interface AgentPolicy {
  /**
   * Unique identifier for this agent instance
   */
  readonly id: string;

  /**
   * Display name for this agent
   */
  readonly name: string;

  /**
   * Agent role (assigned by game engine)
   */
  role: 'mafia' | 'doctor' | 'sheriff' | 'villager' | null;

  /**
   * Reference to the agent configuration
   */
  config: AgentConfig;
}

export interface AgentPolicy extends AgentBase {
  /**
   * Generate private internal reasoning (THINK stream)
   * Called before each agent action
   */
  think(
    context: GameState,
    privateInfo: PrivateInfo
  ): AsyncGenerator<string>;

  /**
   * Generate public statement (SAYS stream)
   * Called during discussion phase
   */
  say(
    context: GameState,
    publicInfo: PublicInfo
  ): AsyncGenerator<string>;

  /**
   * Submit night action
   * Called during NIGHT_ACTIONS phase
   */
  nightAction(
    context: GameState,
    privateInfo: PrivateInfo
  ): Promise<NightAction>;

  /**
   * Submit vote for elimination
   * Called during DAY_VOTING phase
   */
  vote(
    context: GameState,
    publicInfo: PublicInfo
  ): Promise<VoteAction>;
}
```

## Agent Behavior Contract

### Think Generation Rules
1. **THINK is private**: Only visible to admin/observers
2. **THINK reveals true reasoning**: Should honestly reflect agent's deductions
3. **THINK is streamable**: Returns AsyncGenerator for token-by-token streaming
4. **THINK is called for:**
   - Before night actions
   - Before voting
   - During discussion (planning statement)

### Say Generation Rules
1. **SAYS is public**: Visible to all agents (and players in Town mode)
2. **SAYS may contain lies**: Especially for Mafia
3. **SAYS is streamable**: Returns AsyncGenerator for token-by-token streaming
4. **SAYS is called during:** DAY_DISCUSSION phase
5. **Length constraints:**
   - Minimum: 1 sentence
   - Maximum: 5 sentences
   - Target: 2-3 sentences

### Night Action Rules
1. **Mafia** (if role === 'mafia'):
   - Must select one target to kill
   - Can coordinate with other mafia members
   - Cannot target self
   - Cannot target dead players

2. **Doctor** (if role === 'doctor'):
   - Must select one player to protect
   - Can protect self
   - Cannot protect same player two nights in a row
   - Cannot target dead players

3. **Sheriff** (if role === 'sheriff'):
   - Must select one player to investigate
   - Cannot target self
   - Cannot target dead players
   - Returns { isMafia: boolean }

4. **Villager** (if role === 'villager'):
   - No action (return null)

### Voting Rules
1. **All roles**:
   - Must select one living player to eliminate
   - Can abstain (vote null if self-preservation)
   - Cannot vote for dead players
   - Cannot vote for self

## Agent Config Interface

```typescript
export interface AgentConfig {
  /**
   * Agent policy type
   */
  type: 'scripted' | 'llm';

  /**
   * Optional: LLM configuration
   */
  llmConfig?: {
    model: string;  // e.g., "gpt-4", "claude-3-opus"
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
  };

  /**
   * Scripted agent parameters
   */
  scriptedConfig?: {
    personality?: 'aggressive' | 'cautious' | 'analytical' | 'social';
    lieFrequency?: number;  // 0.0 to 1.0 (Mafia only)
    suspicionThreshold?: number;  // For sheriff/doctor reveals
  };
}
```

## Game State Interfaces

### GameState
```typescript
export interface GameState {
  gameId: string;
  phase: Phase;
  dayNumber: number;
  roundNumber: number;
  players: Player[];
  alivePlayers: Player[];
  deadPlayers: Player[];
  mafiaCount: number;
  townCount: number;
  winner: 'town' | 'mafia' | null;
  lastNightResult: {
    killed: Player | null;
    protected: Player | null;
    prevented: boolean;
  } | null;
  votingHistory: VotingRound[];
}

export interface Player {
  id: string;
  name: string;
  role: 'mafia' | 'doctor' | 'sheriff' | 'villager';
  alive: boolean;
  eliminatedRound: number | null;
}

export type Phase = 
  | 'SETUP'
  | 'NIGHT_ACTIONS'
  | 'MORNING_REVEAL'
  | 'DAY_DISCUSSION'
  | 'DAY_VOTING'
  | 'RESOLUTION'
  | 'END';
```

### PublicInfo
```typescript
export interface PublicInfo {
  gameId: string;
  phase: Phase;
  dayNumber: number;
  roundNumber: number;
  alivePlayers: Array<{
    id: string;
    name: string;
  }>;
  deadPlayers: Array<{
    id: string;
    name: string;
    role?: string;  // Only if role was revealed
    eliminatedRound: number;
  }>;
  lastNightResult: {
    killed: string | null;  // Player name if killed
    protected: string | null;  // Player name if protected
    prevented: boolean;
  } | null;
  votingHistory: Array<{
    round: number;
    eliminated: string | null;  // Player name
    votes: Record<string, string>;  // Voter name -> Target name
  }>;
}
```

### PrivateInfo
```typescript
export interface PrivateInfo {
  self: Player;  // This agent's actual role and status
  gameState: GameState;
  privateKnowledge: {
    // Role-specific private knowledge:
    
    // For Mafia:
    mafiaTeammates?: Player[];  // Other mafia members
    
    // For Doctor:
    lastProtected?: string;  // Who was protected last night
    
    // For Sheriff:
    investigationResults: Array<{
      target: Player;
      isMafia: boolean;
      round: number;
    }>;
  };
}
```

## Action Types

```typescript
export interface NightAction {
  actionType: 'KILL' | 'PROTECT' | 'INVESTIGATE';
  targetId: string;
  metadata?: Record<string, any>;  // Optional: reasoning, planning
}

export interface VoteAction {
  targetId: string | null;  // null = abstain
  reason?: string;  // Optional: reasoning for vote
}
```

## Agent Lifecycle

### 1. Initialization
```typescript
// Game creates agents
const agent = new ScriptedAgent({
  id: 'p1',
  name: 'Alice',
  config: { type: 'scripted', scriptedConfig: { personality: 'analytical' } }
});

// Game assigns role
agent.role = 'villager';
```

### 2. Night Phase (if applicable)
```typescript
// Game calls think
for await (const chunk of agent.think(gameState, privateInfo)) {
  // Stream THINK chunks to observers
  emitEvent('AGENT_THINK_STREAM', agent.id, chunk);
}

// Game calls nightAction
const action = await agent.nightAction(gameState, privateInfo);
emitEvent('NIGHT_ACTION_SUBMITTED', agent.id, action);
```

### 3. Day Discussion
```typescript
// Game calls think (planning)
for await (const chunk of agent.think(gameState, privateInfo)) {
  emitEvent('AGENT_THINK_STREAM', agent.id, chunk);
}

// Game calls say (public statement)
for await (const chunk of agent.say(gameState, publicInfo)) {
  emitEvent('AGENT_SAY_STREAM', agent.id, chunk);
}
```

### 4. Day Voting
```typescript
// Game calls think
for await (const chunk of agent.think(gameState, privateInfo)) {
  emitEvent('AGENT_THINK_STREAM', agent.id, chunk);
}

// Game calls vote
const vote = await agent.vote(gameState, publicInfo);
emitEvent('VOTE_CAST', agent.id, vote);
```

### 5. Elimination (if voted out)
- Agent is removed from active players
- Agent's final role revealed (if town votes out)
- Agent no longer receives calls

## Standard Agent Libraries

### Available Context for Decision Making
```typescript
// Game analysis utilities
interface GameAnalysis {
  // Voting patterns
  getVotingHistory(playerId: string): Array<{
    round: number;
    votedFor: string;
    targetRole?: string;  // If known
  }>;
  
  // Suspicions (if role-specific)
  getSuspiciousPlayers(threshold: number): string[];
  
  // Conversation analysis
  getPlayerStatements(playerId: string): Array<{
    round: number;
    type: 'defense' | 'accusation' | 'claim' | 'general';
    target?: string;
    content: string;
  }>;
  
  // Logical relations
  isConfirmedTown(playerId: string): boolean;
  isConfirmedMafia(playerId: string): boolean;
}
```

## Agent Development Guidelines

### For Scripted Agents
1. **Keep it simple**: Use clear heuristic rules
2. **Vary personalities**: Aggressive, cautious, analytical, social
3. **Make mistakes**: Even town agents should sometimes be wrong
4. **React to events**: Adjust behavior based on night kills, investigations
5. **Coordinate carefully**: Mafia agents have private communication

### For LLM Agents
1. **Prompt engineering**: Provide clear game state context
2. **Examples**: Show successful plays from scripted agents
3. **Temperature tuning**: Balance creativity vs consistency
4. **Token limits**: Respect context window
5. **Streaming**: Use streaming responses for THINK/SAYS

### Testing Agents
```typescript
test('villager votes logically', async () => {
  const agent = new VillagerAgent('p1', 'Alice');
  const context = createTestContext({
    phase: 'DAY_VOTING',
    accusations: [{ accuser: 'p2', target: 'p3', reason: 'defended mafia' }],
    suspiciousPlayers: ['p3']
  });
  
  const vote = await agent.vote(context, publicInfo);
  expect(vote.targetId).toBe('p3');
});
```

## Performance Considerations

1. **Async streaming**: Use AsyncGenerator for THINK and SAYS
2. **Batch processing**: Night actions can be resolved in parallel
3. **Caching**: Cache game state snapshots for replay efficiency
4. **Memory limits**: Limit conversation history length
5. **Timeouts**: Set reasonable timeouts for LLM calls