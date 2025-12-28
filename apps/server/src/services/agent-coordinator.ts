/**
 * Agent Coordinator Service
 * 
 * Manages AI agent execution and coordination.
 */

import { 
  AgentPolicy, 
  AgentResponse, 
  AgentMemory,
  AgentContext,
  Game, 
  Player, 
  GameEvent,
  GamePhase,
  LLMProvider,
  createAgent
} from '@mafia/shared/types';
import { EventBus } from './event-bus.js';
import { StatsCollector } from './stats-collector.js';

export interface AgentConfig {
  id: string;
  name: string;
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface AgentExecutionResult {
  success: boolean;
  response?: AgentResponse;
  error?: string;
  latency: number;
}

export interface AgentThinkResult {
  think: string;
  strategy: string;
  confidence: number;
  targets: string[];
  concerns: string[];
  plan: string[];
}

export class AgentCoordinator {
  private eventBus: EventBus;
  private statsCollector: StatsCollector;
  private agents: Map<string, AgentPolicy>;
  private agentConfigs: Map<string, AgentConfig>;
  private playerAgents: Map<string, string>; // playerId -> agentId
  
  constructor(eventBus: EventBus, statsCollector: StatsCollector) {
    this.eventBus = eventBus;
    this.statsCollector = statsCollector;
    this.agents = new Map();
    this.agentConfigs = new Map();
    this.playerAgents = new Map();
  }
  
  /**
   * Register an agent
   */
  registerAgent(config: AgentConfig): void {
    const agent = createAgent(
      config.id,
      config.name,
      config.provider,
      config.model,
      {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }
    );
    
    this.agents.set(config.id, agent);
    this.agentConfigs.set(config.id, config);
    
    console.log(`[AgentCoordinator] Registered agent ${config.name} (${config.provider}/${config.model})`);
  }
  
  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): boolean {
    const deleted = this.agents.delete(agentId);
    this.agentConfigs.delete(agentId);
    
    if (deleted) {
      console.log(`[AgentCoordinator] Unregistered agent ${agentId}`);
    }
    
    return deleted;
  }
  
  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentPolicy | undefined {
    return this.agents.get(agentId);
  }
  
  /**
   * Assign agent to player
   */
  assignAgent(playerId: string, agentId: string): boolean {
    if (!this.agents.has(agentId)) {
      return false;
    }
    
    this.playerAgents.set(playerId, agentId);
    return true;
  }
  
  /**
   * Execute agent for a player
   */
  async executeAgent(
    game: Game,
    player: Player,
    context: AgentContext
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Get agent
      const agentId = this.playerAgents.get(player.id);
      let agent = agentId ? this.agents.get(agentId) : undefined;
      
      // Create default agent if none assigned
      if (!agent) {
        agent = createAgent(
          player.id,
          player.name,
          'OPENAI',
          'gpt-4-turbo'
        );
      }
      
      // Initialize agent if needed
      await agent.initialize(game.id, player);
      
      // Generate thinking
      const thinking = await agent.think(context);
      
      // Generate response
      const response = await agent.respond(thinking, {
        phase: context.phase,
        turnNumber: context.turnNumber,
        dayNumber: game.currentState.dayNumber,
        timeRemaining: game.currentState.timeRemaining,
        activePlayers: game.currentState.activePlayers.map(id => 
          game.players.find(p => p.id === id)!
        ).filter(Boolean),
        statementHistory: this.getStatementHistory(game.id),
      });
      
      // Record stats
      const latency = Date.now() - startTime;
      this.statsCollector.recordAgentSession({
        gameId: game.id,
        playerId: player.id,
        turnNumber: context.turnNumber,
        phase: context.phase,
        prompt: context.rolePrompt,
        response: JSON.stringify(response),
        think: response.think,
        says: response.says,
        actionType: response.action?.type,
        actionTarget: response.action?.target,
        actionConfidence: response.action?.confidence,
        tokensUsed: response.metadata.tokensUsed,
        promptTokens: response.metadata.promptTokens,
        completionTokens: response.metadata.completionTokens,
        latency,
        cost: response.metadata.cost,
        provider: response.metadata.provider,
        model: response.metadata.model,
      });
      
      // Emit think event (private)
      if (response.think) {
        this.eventBus.publish({
          id: crypto.randomUUID(),
          gameId: game.id,
          type: 'AGENT_THINK_STARTED',
          timestamp: new Date(),
          visibility: 'ADMIN',
          actorId: player.id,
          data: {
            agentId: agentId || player.id,
            playerId: player.id,
            turnNumber: context.turnNumber,
            phase: context.phase,
            promptTokens: response.metadata.promptTokens,
            model: response.metadata.model,
          },
          metadata: {
            turnNumber: context.turnNumber,
            dayNumber: game.currentState.dayNumber,
            phase: context.phase,
            sequence: 0,
          },
        });
      }
      
      // Emit says event (public)
      if (response.says) {
        this.eventBus.publish({
          id: crypto.randomUUID(),
          gameId: game.id,
          type: 'AGENT_SAYS_BROADCASTED',
          timestamp: new Date(),
          visibility: 'PUBLIC',
          actorId: player.id,
          data: {
            agentId: agentId || player.id,
            playerId: player.id,
            turnNumber: context.turnNumber,
            phase: context.phase,
            statement: response.says,
            completionTokens: response.metadata.completionTokens,
            model: response.metadata.model,
          },
          metadata: {
            turnNumber: context.turnNumber,
            dayNumber: game.currentState.dayNumber,
            phase: context.phase,
            sequence: 0,
          },
        });
      }
      
      // Emit action event
      if (response.action) {
        this.eventBus.publish({
          id: crypto.randomUUID(),
          gameId: game.id,
          type: 'AGENT_ACTION_TAKEN',
          timestamp: new Date(),
          visibility: 'PRIVATE',
          actorId: player.id,
          data: {
            agentId: agentId || player.id,
            playerId: player.id,
            action: response.action.type,
            targetId: response.action.target,
            confidence: response.action.confidence,
            reasoning: response.action.reasoning,
            turnNumber: context.turnNumber,
          },
          metadata: {
            turnNumber: context.turnNumber,
            dayNumber: game.currentState.dayNumber,
            phase: context.phase,
            sequence: 0,
          },
        });
      }
      
      return {
        success: true,
        response,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`[AgentCoordinator] Agent execution failed for ${player.name}:`, error);
      
      this.eventBus.publish({
        id: crypto.randomUUID(),
        gameId: game.id,
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        visibility: 'ADMIN',
        actorId: player.id,
        data: {
          playerId: player.id,
          error: errorMessage,
          turnNumber: context.turnNumber,
        },
        metadata: {
          turnNumber: context.turnNumber,
          dayNumber: game.currentState.dayNumber,
          phase: context.phase,
          sequence: 0,
        },
      });
      
      return {
        success: false,
        error: errorMessage,
        latency,
      };
    }
  }
  
  /**
   * Execute all agents for a phase
   */
  async executeAllAgents(
    game: Game,
    phase: GamePhase,
    players: Player[]
  ): Promise<Map<string, AgentExecutionResult>> {
    const results = new Map<string, AgentExecutionResult>();
    
    // Execute agents sequentially to avoid rate limits
    for (const player of players) {
      if (!player.isAlive) continue;
      
      const context = this.buildAgentContext(game, player, phase);
      const result = await this.executeAgent(game, player, context);
      results.set(player.id, result);
      
      // Small delay between agents to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }
  
  /**
   * Build agent context
   */
  private buildAgentContext(
    game: Game,
    player: Player,
    phase: GamePhase
  ): AgentContext {
    return {
      game,
      player,
      rolePrompt: this.generateRolePrompt(player),
      memory: this.createMemory(game, player),
      recentEvents: this.getRecentEvents(game.id, 10),
      turnNumber: game.currentState.turnNumber,
      phase,
    };
  }
  
  /**
   * Generate role-specific prompt
   */
  private generateRolePrompt(player: Player): string {
    const rolePrompts: Record<string, string> = {
      MAFIA: `# MAFIA ROLE

You are a member of the Mafia. Your goals:
1. Eliminate all Town players
2. Survive and avoid suspicion
3. Coordinate with other mafia members

Remember:
- You know who the other mafia members are
- Never reveal your identity publicly
- Coordinate kills with teammates during night
- Defend yourself if accused
- Consider "bussing" teammates (voting to eliminate them) to gain trust`,

      DOCTOR: `# DOCTOR ROLE

You are the Doctor. Your goals:
1. Protect key Town members from being killed
2. Stay alive and gather information
3. Use self-protection strategically

Remember:
- You can protect one player each night
- You cannot protect the same player two nights in a row
- Share information during the day
- Defend yourself if accused`,

      SHERIFF: `# SHERIFF ROLE

You are the Sheriff. Your goals:
1. Investigate players to find Mafia
2. Share findings at strategic moments
3. Stay alive to continue investigating

Remember:
- You can investigate one player each night
- You will learn if they are Mafia or not
- Don't reveal your identity too early
- Consider revealing information near voting deadline`,

      VIGILANTE: `# VIGILANTE ROLE

You are the Vigilante. Your goals:
1. Eliminate one Mafia member with your single bullet
2. Stay hidden about your identity
3. Use your shot strategically

Remember:
- You have exactly ONE shot total
- You can shoot any night
- Your shot cannot be blocked by the Doctor
- Consider revealing and shooting at voting deadline if confident`,

      VILLAGER: `# VILLAGER ROLE

You are a Villager. Your goals:
1. Vote to eliminate Mafia members
2. Observe behavior and gather evidence
3. Trust confirmed Town members

Remember:
- You have no special abilities
- Use logic and observation to find Mafia
- Vote based on evidence
- Support confirmed Town members`,
    };
    
    return rolePrompts[player.role] || rolePrompts.VILLAGER;
  }
  
  /**
   * Create agent memory
   */
  private createMemory(game: Game, player: Player): AgentMemory {
    return {
      gameId: game.id,
      playerId: player.id,
      role: player.role,
      turnNumber: game.currentState.turnNumber,
      gameHistory: [],
      nightContext: {
        kills: [],
        protects: [],
        investigations: [],
      },
      dayContext: {
        votes: [],
        accusations: [],
        roleClaims: [],
        eliminations: [],
      },
      internalMonologue: {
        currentSuspects: [],
        trustMap: new Map(),
        gamePlan: this.generateGamePlan(player.role),
        observations: [],
        nextMoves: [],
      },
      privateInfo: {
        investigationResults: [],
        shotsRemaining: player.role === 'VIGILANTE' ? 1 : undefined,
      },
      teammates: player.role === 'MAFIA' ? game.players
        .filter(p => p.isMafia && p.id !== player.id && p.isAlive)
        .map(p => p.id) : undefined,
    };
  }
  
  /**
   * Generate game plan based on role
   */
  private generateGamePlan(role: string): string {
    const plans: Record<string, string> = {
      MAFIA: 'Establish town trust early. Coordinate with mafia teammates during night. Bus teammates if necessary. Target key town roles strategically.',
      DOCTOR: 'Stay alive and protect valuable targets. Gather information during day discussions. Use self-protection sparingly.',
      SHERIFF: 'Investigate suspicious players. Share findings at strategic moments (especially near voting deadline). Protect identity until late game.',
      VIGILANTE: 'Gather evidence during day. Use shot strategically when confident. Stay hidden about vigilante identity.',
      VILLAGER: 'Observe behavior patterns. Vote based on logic and evidence. Trust confirmed town members.',
    };
    
    return plans[role] || plans.VILLAGER;
  }
  
  /**
   * Get recent game events
   */
  private getRecentEvents(gameId: string, limit: number): GameEvent[] {
    return this.eventBus.getGameEvents(gameId, { limit });
  }
  
  /**
   * Get statement history
   */
  private getStatementHistory(gameId: string): Array<{
    playerId: string;
    playerName: string;
    statement: string;
    timestamp: Date;
  }> {
    const saysEvents = this.eventBus.getGameEvents(gameId, { 
      eventType: 'AGENT_SAYS_BROADCASTED',
      limit: 20 
    });
    
    return saysEvents.map(event => ({
      playerId: event.actorId!,
      playerName: '', // Would need to look up from game
      statement: (event.data as { statement: string }).statement,
      timestamp: event.timestamp,
    }));
  }
  
  /**
   * Get all registered agents
   */
  getAgents(): AgentConfig[] {
    return Array.from(this.agentConfigs.values());
  }
  
  /**
   * Get agent statistics
   */
  getAgentStats(): Array<{
    agentId: string;
    name: string;
    provider: string;
    model: string;
    executions: number;
    successRate: number;
    avgLatency: number;
  }> {
    const stats = this.statsCollector.getAgentStats();
    
    return stats.map(s => ({
      agentId: s.agentId,
      name: this.agentConfigs.get(s.agentId)?.name || 'Unknown',
      provider: s.provider || 'Unknown',
      model: s.model || 'Unknown',
      executions: s.executions,
      successRate: s.executions > 0 ? s.successes / s.executions : 0,
      avgLatency: s.executions > 0 ? s.totalLatency / s.executions : 0,
    }));
  }
}

export default AgentCoordinator;
