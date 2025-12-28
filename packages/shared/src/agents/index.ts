/**
 * Agents Module
 * 
 * AI agent system for the Mafia AI Benchmark.
 * Manages agent lifecycle, memory, and responses.
 */

import { 
  Agent, 
  AgentResponse, 
  AgentAction, 
  AgentMemory, 
  AgentMetadata,
  Player, 
  Game, 
  GameEvent,
  RoleType,
  LLMProvider,
  GamePhase
} from '../types/index.js';
import { 
  generateRolePrompt, 
  getRoleConfig, 
  getMafiaTeammates,
  getInvestigationResult,
  isAbilityUsed 
} from '../roles/index.js';

// Agent interface for implementations
export interface AgentPolicy {
  id: string;
  name: string;
  provider: LLMProvider;
  model: string;
  temperature: number;
  maxTokens: number;
  
  // Core methods
  initialize(gameId: string, player: Player, config: AgentConfig): Promise<void>;
  think(context: AgentContext): Promise<AgentThinking>;
  respond(thinking: AgentThinking, turnContext: TurnContext): Promise<AgentResponse>;
  submitAction(action: AgentAction): Promise<void>;
  reset(): void;
}

// Agent configuration
export interface AgentConfig {
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  customInstructions?: string;
  memoryEnabled?: boolean;
  memoryLimit?: number;
}

// Agent context for thinking
export interface AgentContext {
  game: Game;
  player: Player;
  memory: AgentMemory;
  rolePrompt: string;
  recentEvents: GameEvent[];
  turnNumber: number;
  phase: GamePhase;
}

// Turn context for responding
export interface TurnContext {
  phase: GamePhase;
  turnNumber: number;
  dayNumber: number;
  timeRemaining: number;
  activePlayers: Player[];
  statementHistory: StatementHistory[];
}

export interface StatementHistory {
  playerId: string;
  playerName: string;
  statement: string;
  timestamp: Date;
}

// Agent thinking state
export interface AgentThinking {
  think: string;
  confidence: number;
  strategy: string;
  targets: string[];
  concerns: string[];
  plan: string;
}

// Agent implementation
export class MafiaAgent implements AgentPolicy {
  public id: string;
  public name: string;
  public provider: LLMProvider;
  public model: string;
  public temperature: number = 0.7;
  public maxTokens: number = 2000;
  
  private config: AgentConfig;
  private gameId: string = '';
  private player: Player | null = null;
  private memory: AgentMemory | null = null;
  private rolePrompt: string = '';
  
  constructor(id: string, name: string, provider: LLMProvider, model: string) {
    this.id = id;
    this.name = name;
    this.provider = provider;
    this.model = model;
    this.config = {};
  }
  
  async initialize(gameId: string, player: Player, config: AgentConfig = {}): Promise<void> {
    this.gameId = gameId;
    this.player = player;
    this.config = config;
    
    // Generate role-specific system prompt
    this.rolePrompt = this.generateSystemPrompt(player);
    
    // Initialize memory
    this.memory = this.createInitialMemory(player);
  }
  
  private generateSystemPrompt(player: Player): string {
    const roleConfig = getRoleConfig(player.role);
    if (!roleConfig) return '';
    
    let prompt = `# MAFIA GAME - ${player.role} ROLE\n\n`;
    prompt += `You are ${player.name}, playing as a ${player.role}.\n\n`;
    prompt += `${roleConfig.description}\n\n`;
    
    // Add abilities
    prompt += `## YOUR ABILITIES:\n`;
    roleConfig.abilities.forEach(ability => {
      prompt += `- ${ability.name}: ${ability.description}\n`;
      prompt += `  Frequency: ${ability.frequency}\n\n`;
    });
    
    // Add constraints
    if (roleConfig.constraints.length > 0) {
      prompt += `## CONSTRAINTS:\n`;
      roleConfig.constraints.forEach(constraint => {
        prompt += `- ${constraint.description}\n`;
      });
      prompt += `\n`;
    }
    
    // Add behavior style
    prompt += `## BEHAVIOR STYLE:\n`;
    prompt += `- Tone: ${roleConfig.promptStyle.tone}\n`;
    prompt += `- Priorities: ${roleConfig.promptStyle.priorities.join(', ')}\n`;
    prompt += `- Deception Level: ${roleConfig.promptStyle.deceptionLevel * 100}%\n\n`;
    
    // Add win condition
    prompt += `## WIN CONDITION:\n`;
    prompt += `${roleConfig.winCondition.condition}\n\n`;
    
    // Add custom instructions if provided
    if (this.config.customInstructions) {
      prompt += `## CUSTOM INSTRUCTIONS:\n`;
      prompt += `${this.config.customInstructions}\n\n`;
    }
    
    return prompt;
  }
  
  private createInitialMemory(player: Player): AgentMemory {
    return {
      gameId: this.gameId,
      playerId: player.id,
      role: player.role,
      turnNumber: 0,
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
        gamePlan: this.getInitialGamePlan(player.role),
        observations: [],
        nextMoves: [],
      },
      privateInfo: {
        investigationResults: [],
        shotsRemaining: player.role === 'VIGILANTE' ? 1 : undefined,
      },
      teammates: player.role === 'MAFIA' ? [] : undefined,
    };
  }
  
  private getInitialGamePlan(role: RoleType): string {
    switch (role) {
      case 'MAFIA':
        return 'Establish town trust early. Coordinate with mafia teammates during night. Bus teammates when necessary to avoid suspicion. Target key town roles (Doctor, Sheriff) strategically.';
      case 'DOCTOR':
        return 'Stay alive and protect valuable targets. Gather information during day discussions. Use self-protection sparingly. Track who claims to have been attacked.';
      case 'SHERIFF':
        return 'Investigate suspicious players. Share findings at strategic moments (especially near voting deadline). Protect identity until late game.';
      case 'VIGILANTE':
        return 'Gather evidence during day. Use shot strategically when confident. Stay hidden about vigilante identity. Consider shooting at voting deadline for maximum impact.';
      case 'VILLAGER':
        return 'Observe behavior patterns. Vote based on logic and evidence. Trust confirmed town members. Avoid making accusations without evidence.';
      default:
        return 'Play to win.';
    }
  }
  
  async think(context: AgentContext): Promise<AgentThinking> {
    // Analyze current game state
    const suspects = this.analyzeSuspects(context);
    const trustMap = this.buildTrustMap(context);
    const strategy = this.determineStrategy(context);
    const concerns = this.identifyConcerns(context);
    const plan = this.formulatePlan(context);
    
    const think = this.generateThinkingText(context, {
      suspects,
      trustMap,
      strategy,
      concerns,
      plan,
    });
    
    return {
      think,
      confidence: this.calculateConfidence(context),
      strategy,
      targets: suspects,
      concerns,
      plan,
    };
  }
  
  private analyzeSuspects(context: AgentContext): string[] {
    const suspects: string[] = [];
    const { game, player, memory } = context;
    
    // Get alive players excluding self
    const alivePlayers = game.players.filter(
      p => p.isAlive && p.id !== player.id
    );
    
    // Add mafia teammates to trust map
    if (player.role === 'MAFIA') {
      const teammates = getMafiaTeammates(game, player.id);
      teammates.forEach(id => {
        memory.internalMonologue.trustMap.set(id, 1.0);
      });
    }
    
    // Analyze based on behavior
    alivePlayers.forEach(p => {
      const trust = memory.internalMonologue.trustMap.get(p.id) || 0.5;
      
      // Low trust players are suspects
      if (trust < 0.5 && !suspects.includes(p.id)) {
        suspects.push(p.id);
      }
      
      // Players who make accusations are often town
      const accusations = memory.dayContext.accusations.filter(
        a => a.accuserId === p.id
      );
      if (accusations.length > 2) {
        // Likely town, reduce suspicion
        memory.internalMonologue.trustMap.set(p.id, Math.max(trust, 0.7));
      }
    });
    
    return suspects;
  }
  
  private buildTrustMap(context: AgentContext): Map<string, number> {
    const trustMap = new Map<string, number>();
    const { game, player, memory } = context;
    
    // Start with existing trust
    memory.internalMonologue.trustMap.forEach((trust, id) => {
      trustMap.set(id, trust);
    });
    
    // Update based on recent events
    const recentEvents = context.recentEvents.slice(-10);
    
    recentEvents.forEach(event => {
      switch (event.type) {
        case 'ACCUSATION_MADE':
          if (event.actorId && event.targetId) {
            const accuser = game.players.find(p => p.id === event.actorId);
            const target = game.players.find(p => p.id === event.targetId);
            
            if (accuser && target) {
              // Accusers are likely town
              const currentTrust = trustMap.get(event.actorId) || 0.5;
              trustMap.set(event.actorId, Math.min(currentTrust + 0.1, 1.0));
              
              // Targets become more suspicious
              const targetTrust = trustMap.get(event.targetId) || 0.5;
              trustMap.set(event.targetId, Math.max(targetTrust - 0.2, 0.0));
            }
          }
          break;
          
        case 'ROLE_CLAIMED':
          if (event.actorId) {
            const claimedRole = (event.data as { role: RoleType }).role;
            const claimer = game.players.find(p => p.id === event.actorId);
            
            if (claimer) {
              // Role claims increase visibility
              // Don't automatically trust or distrust
            }
          }
          break;
          
        case 'PLAYER_KILLED':
        case 'PLAYER_LYNCHED':
          if (event.targetId) {
            const eliminated = game.players.find(p => p.id === event.targetId);
            if (eliminated) {
              // Eliminate from trust map
              trustMap.delete(event.targetId);
            }
          }
          break;
      }
    });
    
    return trustMap;
  }
  
  private determineStrategy(context: AgentContext): string {
    const { game, player, phase } = context;
    
    // Night phase strategy
    if (phase === 'NIGHT_ACTIONS') {
      switch (player.role) {
        case 'MAFIA':
          return 'Coordinate with teammates to eliminate a valuable target. Prioritize Doctor or Sheriff.';
        case 'DOCTOR':
          return 'Protect the most likely mafia target or self if under suspicion.';
        case 'SHERIFF':
          return 'Investigate a player who seems suspicious or who has been quiet.';
        case 'VIGILANTE':
          if (isAbilityUsed(game, player.id, 'SHOOT')) {
            return 'Shot already used - focus on voting and discussion.';
          }
          return 'Wait for the right moment to use the shot strategically.';
        default:
          return 'Wait for day phase.';
      }
    }
    
    // Day phase strategy
    const dayContext = context.memory.dayContext;
    const recentAccusations = dayContext.accusations.filter(
      a => a.dayNumber === game.currentState.dayNumber
    );
    
    if (recentAccusations.length > 0) {
      return 'Respond to accusations and defend or counter-accuse.';
    }
    
    return 'Observe and gather information before making decisions.';
  }
  
  private identifyConcerns(context: AgentContext): string[] {
    const concerns: string[] = [];
    const { game, player, memory } = context;
    
    // Check if under suspicion
    const accusations = memory.dayContext.accusations.filter(
      a => a.targetId === player.id
    );
    
    if (accusations.length > 0) {
      concerns.push('Under suspicion - need to defend self');
    }
    
    // Check for dangerous players
    const alivePlayers = game.players.filter(p => p.isAlive && p.id !== player.id);
    
    if (player.role !== 'MAFIA') {
      const potentialMafia = alivePlayers.filter(p => {
        const trust = memory.internalMonologue.trustMap.get(p.id) || 0.5;
        return trust < 0.4;
      });
      
      if (potentialMafia.length > 0) {
        concerns.push(`${potentialMafia.length} players identified as potential mafia`);
      }
    }
    
    // Check for confirmed town
    const confirmedTown = alivePlayers.filter(p => {
      const trust = memory.internalMonologue.trustMap.get(p.id) || 0.5;
      return trust > 0.8;
    });
    
    if (confirmedTown.length > 0) {
      concerns.push(`${confirmedTown.length} players confirmed as likely town`);
    }
    
    return concerns;
  }
  
  private formulatePlan(context: AgentContext): string[] {
    const plan: string[] = [];
    const { game, player, phase, memory } = context;
    
    if (phase === 'NIGHT_ACTIONS') {
      switch (player.role) {
        case 'MAFIA':
          plan.push('Select kill target with teammates');
          plan.push('Avoid targeting other mafia');
          plan.push('Prepare defense for next day');
          break;
        case 'DOCTOR':
          const lastProtected = memory.privateInfo.protectedBy;
          const potentialTargets = game.players.filter(
            p => p.isAlive && p.id !== lastProtected
          );
          plan.push(`Select protection target from ${potentialTargets.length} options`);
          break;
        case 'SHERIFF':
          const investigated = memory.privateInfo.investigationResults.map(r => r.targetId);
          const potentialTargets = game.players.filter(
            p => p.isAlive && !investigated.includes(p.id)
          );
          plan.push(`Investigate one of ${potentialTargets.length} uninvolved players`);
          break;
        case 'VIGILANTE':
          if (memory.privateInfo.shotsRemaining && memory.privateInfo.shotsRemaining > 0) {
            plan.push('Decide whether to use shot tonight');
            plan.push('Consider timing for maximum impact');
          } else {
            plan.push('Shot already used - focus on discussion');
          }
          break;
      }
    } else if (phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING') {
      plan.push('Listen to other players');
      plan.push('Evaluate accusations and evidence');
      plan.push('Make voting decision');
      
      if (player.role === 'SHERIFF' && memory.privateInfo.investigationResults.length > 0) {
        plan.push('Consider revealing investigation results');
      }
      
      if (player.role === 'VIGILANTE' && memory.privateInfo.shotsRemaining === 1) {
        plan.push('Consider revealing and shooting if confident');
      }
    }
    
    return plan;
  }
  
  private generateThinkingText(
    context: AgentContext,
    analysis: {
      suspects: string[];
      trustMap: Map<string, number>;
      strategy: string;
      concerns: string[];
      plan: string[];
    }
  ): string {
    const { player, game, phase } = context;
    
    let think = `## Internal Analysis - ${player.name} (${player.role})\n\n`;
    
    think += `### Current Situation\n`;
    think += `- Phase: ${phase}\n`;
    think += `- Day: ${game.currentState.dayNumber}\n`;
    think += `- Alive Players: ${game.currentState.activePlayers.length}\n\n`;
    
    think += `### Strategy\n`;
    think += `${analysis.strategy}\n\n`;
    
    think += `### Suspects (${analysis.suspects.length})\n`;
    analysis.suspects.forEach(id => {
      const p = game.players.find(x => x.id === id);
      const trust = analysis.trustMap.get(id) || 0.5;
      think += `- ${p?.name || id}: Trust ${(trust * 100).toFixed(0)}%\n`;
    });
    think += `\n`;
    
    think += `### Concerns\n`;
    if (analysis.concerns.length > 0) {
      analysis.concerns.forEach(c => think += `- ${c}\n`);
    } else {
      think += `- No major concerns\n`;
    }
    think += `\n`;
    
    think += `### Plan\n`;
    analysis.plan.forEach(p => think += `- ${p}\n`);
    
    return think;
  }
  
  private calculateConfidence(context: AgentContext): number {
    const { player, memory, recentEvents } = context;
    
    // Base confidence
    let confidence = 0.5;
    
    // More information = higher confidence
    const infoGathered = 
      memory.privateInfo.investigationResults.length +
      memory.dayContext.accusations.length +
      memory.dayContext.roleClaims.length;
    
    confidence += Math.min(infoGathered * 0.05, 0.3);
    
    // Game phase affects confidence
    if (context.phase === 'NIGHT_ACTIONS') {
      confidence -= 0.1; // Less information at night
    } else if (context.phase === 'DAY_VOTING') {
      confidence += 0.1; // More information available
    }
    
    // Role-specific adjustments
    if (player.role === 'SHERIFF' && memory.privateInfo.investigationResults.length > 0) {
      confidence += 0.2; // Sheriff has concrete information
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  async respond(thinking: AgentThinking, turnContext: TurnContext): Promise<AgentResponse> {
    // Generate public statement
    const says = this.generatePublicStatement(thinking, turnContext);
    
    // Determine action if any
    const action = this.determineAction(thinking, turnContext);
    
    // Create metadata
    const metadata: AgentMetadata = {
      tokensUsed: 0, // Will be filled by provider
      promptTokens: 0,
      completionTokens: 0,
      latency: 0,
      cost: 0,
      provider: this.provider,
      model: this.model,
      turnNumber: turnContext.turnNumber,
      timestamp: new Date(),
    };
    
    return {
      think: thinking.think,
      says,
      action,
      metadata,
    };
  }
  
  private generatePublicStatement(
    thinking: AgentThinking,
    turnContext: TurnContext
  ): string {
    const { phase, statementHistory, activePlayers } = turnContext;
    
    // Generate context summary
    let context = '';
    
    if (statementHistory.length > 0) {
      const recentStatements = statementHistory.slice(-5);
      context += 'Recent statements:\n';
      recentStatements.forEach(s => {
        context += `- ${s.playerName}: "${s.statement}"\n`;
      });
      context += '\n';
    }
    
    // Generate response based on phase
    if (phase === 'NIGHT_ACTIONS') {
      return this.generateNightAction(thinking);
    }
    
    if (phase === 'DAY_DISCUSSION') {
      return this.generateDayDiscussion(thinking, context, activePlayers);
    }
    
    if (phase === 'DAY_VOTING') {
      return this.generateVotingStatement(thinking, activePlayers);
    }
    
    return 'I have no comment at this time.';
  }
  
  private generateNightAction(thinking: AgentThinking): string {
    // Night actions are private, but we need a placeholder
    return '[Night action submitted privately]';
  }
  
  private generateDayDiscussion(
    thinking: AgentThinking,
    context: string,
    activePlayers: Player[]
  ): string {
    // Generate a discussion statement based on thinking
    const concerns = thinking.concerns.join('. ');
    const targets = thinking.targets
      .map(id => activePlayers.find(p => p.id === id)?.name || id)
      .join(', ');
    
    let statement = '';
    
    if (thinking.concerns.length > 0) {
      statement += `I'm concerned that ${concerns}. `;
    }
    
    if (thinking.targets.length > 0) {
      statement += `I've been observing ${targets} and their behavior seems suspicious. `;
    }
    
    statement += this.generateRoleSpecificDiscussion(thinking, activePlayers);
    
    return statement || 'I need more information before making a decision.';
  }
  
  private generateRoleSpecificDiscussion(
    thinking: AgentThinking,
    activePlayers: Player[]
  ): string {
    // This will be overridden by role-specific agents
    return '';
  }
  
  private generateVotingStatement(
    thinking: AgentThinking,
    activePlayers: Player[]
  ): string {
    if (thinking.targets.length > 0) {
      const target = thinking.targets[0];
      const targetPlayer = activePlayers.find(p => p.id === target);
      if (targetPlayer) {
        return `I vote to lynch ${targetPlayer.name}.`;
      }
    }
    
    return 'I vote to lynch no one.';
  }
  
  private determineAction(
    thinking: AgentThinking,
    turnContext: TurnContext
  ): AgentAction | undefined {
    const { phase, activePlayers } = turnContext;
    
    if (phase === 'NIGHT_ACTIONS') {
      if (thinking.targets.length > 0) {
        return {
          type: this.getNightActionType(),
          target: thinking.targets[0],
          confidence: thinking.confidence,
          reasoning: thinking.strategy,
        };
      }
    }
    
    if (phase === 'DAY_VOTING') {
      if (thinking.targets.length > 0) {
        return {
          type: 'VOTE',
          target: thinking.targets[0],
          confidence: thinking.confidence,
          reasoning: thinking.strategy,
        };
      }
    }
    
    return undefined;
  }
  
  private getNightActionType(): AgentAction['type'] {
    // This will be set by the game engine based on role
    return 'KILL';
  }
  
  async submitAction(action: AgentAction): Promise<void> {
    // Action submission is handled by the game engine
    console.log(`[Agent ${this.name}] Submitting action: ${action.type} -> ${action.target}`);
  }
  
  reset(): void {
    this.memory = null;
    this.player = null;
    this.gameId = '';
  }
}

// Agent factory
export function createAgent(
  id: string,
  name: string,
  provider: LLMProvider,
  model: string,
  config?: Partial<Agent>
): AgentPolicy {
  const agent = new MafiaAgent(id, name, provider, model);
  
  if (config) {
    agent.temperature = config.temperature ?? agent.temperature;
    agent.maxTokens = config.maxTokens ?? agent.maxTokens;
  }
  
  return agent;
}

// All agent utilities are defined in this file for simplicity
