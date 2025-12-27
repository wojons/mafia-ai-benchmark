# Mafia AI Benchmark - Stats & Scoring System

## Overview

A comprehensive statistics and scoring system designed to:
- Track real-time metrics during gameplay (tokens, API calls, data transfer)
- Calculate per-model performance scores across all roles
- Enable comparative analysis between models
- Identify role-specific strengths and weaknesses
- Support A/B testing between different model configurations
- Provide aggregate benchmarks over multiple games

---

## 1. Real-Time Metrics Tracking

### 1.1 Token Usage Tracking

```typescript
interface TokenMetrics {
  gameId: string;
  playerId: string;
  model: string;
  provider: string;
  
  // Per-turn token counts
  turns: Array<{
    turnId: string;
    phase: 'night' | 'day' | 'voting';
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    timestamp: number;
    actionType?: 'think' | 'say' | 'night_action' | 'vote';
  }>;
  
  // Aggregate metrics
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  avgTokensPerTurn: number;
  maxTokensInTurn: number;
  minTokensInTurn: number;
  
  // Cost tracking (if available)
  estimatedCost?: {
    currency: string;
    promptCost: number;
    completionCost: number;
    totalCost: number;
  };
}

class TokenTracker {
  private metrics: Map<string, TokenMetrics> = new Map();
  
  trackTurn(
    gameId: string,
    playerId: string,
    turn: {
      promptTokens: number;
      completionTokens: number;
      phase: string;
      actionType: string;
    }
  ): void {
    const key = `${gameId}:${playerId}`;
    let metric = this.metrics.get(key);
    
    if (!metric) {
      metric = {
        gameId,
        playerId,
        model: '',  // Will be filled
        provider: '',
        turns: [],
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        avgTokensPerTurn: 0,
        maxTokensInTurn: 0,
        minTokensInTurn: Infinity
      };
      this.metrics.set(key, metric);
    }
    
    const turnMetrics = {
      turnId: generateTurnId(),
      phase: turn.phase as any,
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      totalTokens: turn.promptTokens + turn.completionTokens,
      timestamp: Date.now(),
      actionType: turn.actionType as any
    };
    
    metric.turns.push(turnMetrics);
    metric.totalPromptTokens += turn.promptTokens;
    metric.totalCompletionTokens += turn.completionTokens;
    metric.totalTokens += turnMetrics.totalTokens;
    
    // Update min/max
    if (turnMetrics.totalTokens > metric.maxTokensInTurn) {
      metric.maxTokensInTurn = turnMetrics.totalTokens;
    }
    if (turnMetrics.totalTokens < metric.minTokensInTurn) {
      metric.minTokensInTurn = turnMetrics.totalTokens;
    }
    
    // Calculate average
    metric.avgTokensPerTurn = metric.totalTokens / metric.turns.length;
  }
  
  getMetrics(gameId: string, playerId: string): TokenMetrics | null {
    return this.metrics.get(`${gameId}:${playerId}`) || null;
  }
  
  getGameMetrics(gameId: string): TokenMetrics[] {
    return Array.from(this.metrics.values())
      .filter(m => m.gameId === gameId);
  }
  
  estimateCost(
    promptCostPer1K: number,
    completionCostPer1K: number,
    currency: string = 'USD'
  ): TokenMetrics[] {
    return Array.from(this.metrics.values()).map(metric => ({
      ...metric,
      estimatedCost: {
        currency,
        promptCost: (metric.totalPromptTokens / 1000) * promptCostPer1K,
        completionCost: (metric.totalCompletionTokens / 1000) * completionCostPer1K,
        totalCost: (metric.totalPromptTokens / 1000) * promptCostPer1K + 
                   (metric.totalCompletionTokens / 1000) * completionCostPer1K
      }
    }));
  }
}
```

### 1.2 API Call Tracking

```typescript
interface APIMetrics {
  gameId: string;
  playerId: string;
  provider: string;
  model: string;
  
  calls: Array<{
    callId: string;
    timestamp: number;
    endpoint: string;
    duration: number;  // ms
    statusCode: number;
    success: boolean;
    retryCount: number;
    payloadSize: number;  // bytes
    responseSize: number;  // bytes
  }>;
  
  aggregate: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    totalPayloadSize: number;
    totalResponseSize: number;
    totalDataTransfer: number;
    avgLatency: number;
  };
}

class APITracker {
  private metrics: Map<string, APIMetrics> = new Map();
  
  trackCall(
    gameId: string,
    playerId: string,
    call: {
      endpoint: string;
      duration: number;
      statusCode: number;
      success: boolean;
      retryCount: number;
      payloadSize: number;
      responseSize: number;
    }
  ): void {
    const key = `${gameId}:${playerId}`;
    let metric = this.metrics.get(key);
    
    if (!metric) {
      metric = {
        gameId,
        playerId,
        provider: '',
        model: '',
        calls: [],
        aggregate: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          avgDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          totalPayloadSize: 0,
          totalResponseSize: 0,
          totalDataTransfer: 0,
          avgLatency: 0
        }
      };
      this.metrics.set(key, metric);
    }
    
    const callRecord = {
      callId: generateCallId(),
      timestamp: Date.now(),
      endpoint: call.endpoint,
      duration: call.duration,
      statusCode: call.statusCode,
      success: call.success,
      retryCount: call.retryCount,
      payloadSize: call.payloadSize,
      responseSize: call.responseSize
    };
    
    metric.calls.push(callRecord);
    
    // Update aggregate
    metric.aggregate.totalCalls++;
    if (call.success) {
      metric.aggregate.successfulCalls++;
    } else {
      metric.aggregate.failedCalls++;
    }
    
    metric.aggregate.totalPayloadSize += call.payloadSize;
    metric.aggregate.totalResponseSize += call.responseSize;
    metric.aggregate.totalDataTransfer = 
      metric.aggregate.totalPayloadSize + metric.aggregate.totalResponseSize;
    
    // Update duration stats
    const durations = metric.calls.map(c => c.duration);
    metric.aggregate.avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    metric.aggregate.minDuration = Math.min(...durations);
    metric.aggregate.maxDuration = Math.max(...durations);
    metric.aggregate.avgLatency = metric.aggregate.avgDuration;
  }
  
  getProviderStats(provider: string): ProviderStats {
    const providerMetrics = Array.from(this.metrics.values())
      .filter(m => m.provider === provider);
    
    const allCalls = providerMetrics.flatMap(m => m.calls);
    
    return {
      provider,
      totalGames: providerMetrics.length,
      totalCalls: allCalls.length,
      successRate: allCalls.filter(c => c.success).length / allCalls.length * 100,
      avgLatency: allCalls.reduce((a, b) => a + b.duration, 0) / allCalls.length,
      totalDataTransfer: allCalls.reduce((a, b) => a + b.payloadSize + b.responseSize, 0),
      failedCalls: allCalls.filter(c => !c.success).length
    };
  }
}
```

### 1.3 Real-Time Dashboard Data

```typescript
interface RealtimeDashboard {
  gameId: string;
  lastUpdated: number;
  
  // Live metrics
  live: {
    activePlayers: number;
    phase: string;
    dayNumber: number;
    
    // Token usage (real-time)
    tokenUsage: {
      currentTurn: number;
      totalTokens: number;
      tokensPerSecond: number;
      estimatedCost: number;
    };
    
    // API status
    apiStatus: {
      activeCalls: number;
      avgLatency: number;
      errorRate: number;
      providers: Array<{
        name: string;
        calls: number;
        avgLatency: number;
        errors: number;
      }>;
    };
    
    // Data transfer
    dataTransfer: {
      uploaded: number;
      downloaded: number;
      rate: number;  // bytes per second
    };
  };
  
  // Historical data (for charts)
  history: Array<{
    timestamp: number;
    tokens: number;
    cost: number;
    latency: number;
    activeCalls: number;
  }>;
}

function generateRealtimeDashboard(
  gameId: string,
  tokenTracker: TokenTracker,
  apiTracker: APITracker,
  intervalMs: number = 1000
): RealtimeDashboard {
  const gameTokens = tokenTracker.getGameMetrics(gameId);
  const now = Date.now();
  
  // Calculate current metrics
  const totalTokens = gameTokens.reduce((sum, t) => sum + t.totalTokens, 0);
  const activeCalls = apiTracker.getGameMetrics(gameId)
    .flatMap(m => m.calls)
    .filter(c => c.timestamp > now - intervalMs).length;
  
  const recentCalls = apiTracker.getGameMetrics(gameId)
    .flatMap(m => m.calls)
    .filter(c => c.timestamp > now - 5000);
  
  const avgLatency = recentCalls.length > 0
    ? recentCalls.reduce((a, b) => a + b.duration, 0) / recentCalls.length
    : 0;
  
  const errorRate = recentCalls.length > 0
    ? (recentCalls.filter(c => !c.success).length / recentCalls.length) * 100
    : 0;
  
  return {
    gameId,
    lastUpdated: now,
    
    live: {
      activePlayers: 10,  // Would be dynamic
      phase: 'day_discussion',
      dayNumber: 2,
      
      tokenUsage: {
        currentTurn: 500,
        totalTokens,
        tokensPerSecond: totalTokens / 60,  // Assuming 1 min game
        estimatedCost: estimateTotalCost(totalTokens)
      },
      
      apiStatus: {
        activeCalls,
        avgLatency,
        errorRate,
        providers: [
          { name: 'openai', calls: 45, avgLatency: 150, errors: 0 },
          { name: 'anthropic', calls: 30, avgLatency: 200, errors: 1 },
          { name: 'ollama', calls: 25, avgLatency: 50, errors: 0 }
        ]
      },
      
      dataTransfer: {
        uploaded: 1024 * 1024,  // 1MB
        downloaded: 2048 * 1024,  // 2MB
        rate: 50000  // 50KB/s
      }
    },
    
    history: []  // Would be populated from stored history
  };
}
```

---

## 2. Post-Game Performance Scoring

### 2.1 Per-Game Stats

```typescript
interface GameStats {
  gameId: string;
  seed: number;
  duration: number;  // ms
  
  // Game outcome
  outcome: {
    winner: 'town' | 'mafia';
    mafiaWins: boolean;
    townWins: boolean;
    dayNumber: number;
    totalVotes: number;
    mafiaEliminated: number;
    townEliminated: number;
  };
  
  // Per-player stats
  players: Array<PlayerGameStats>;
  
  // Aggregate metrics
  aggregate: {
    totalTokens: number;
    totalCost: number;
    totalApiCalls: number;
    avgTurnDuration: number;
    dataTransfer: {
      uploaded: number;
      downloaded: number;
    };
  };
  
  // Role performance
  rolePerformance: {
    mafia: RoleStats;
    doctor: RoleStats;
    sheriff: RoleStats;
    vigilante: RoleStats;
    villagers: RoleStats;
  };
}

interface PlayerGameStats {
  playerId: string;
  playerName: string;
  model: string;
  provider: string;
  
  // Role
  assignedRole: string;
  actualRole: string;  // After reveal
  
  // Game result
  status: 'alive' | 'dead' | 'eliminated';
  survived: boolean;
  won: boolean;
  
  // Performance metrics
  performance: {
    // Role-specific score (0-100)
    roleScore: number;
    
    // Action quality (0-100)
    actionQuality: number;
    
    // Strategy score (0-100)
    strategyScore: number;
    
    // Deception score (mafia only) (0-100)
    deceptionScore: number;
    
    // Social deduction (town only) (0-100)
    deductionScore: number;
    
    // Overall score (weighted average)
    overallScore: number;
  };
  
  // Actions taken
  actions: {
    nightKills?: number;
    nightProtects?: number;
    nightInvestigations?: number;
    vigilanteShots?: number;
    votesCast: number;
    accusations: number;
    defenses: number;
    roleClaims: number;
  };
  
  // Communication
  communication: {
    thinkTokens: number;
    sayTokens: number;
    avgThinkLength: number;
    avgSayLength: number;
    publicStatements: number;
    privateMessages: number;  // Mafia team chat
  };
  
  // Timing
  timing: {
    avgTurnDuration: number;
    total思考Time: number;
    total说话Time: number;
    lateVotes: number;
    earlyVotes: number;
  };
  
  // Voting behavior
  voting: {
    votesCast: number;
    votesForMafia: number;
    votesForTown: number;
    votesForTeammate: number;  // Mafia voting for mafia
    correctVotes: number;
    incorrectVotes: number;
    bandwagonVotes: number;
    leaderVotes: number;
    voteChanges: number;
  };
}

interface RoleStats {
  role: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRoleScore: number;
  avgActionQuality: number;
  avgStrategyScore: number;
  commonMistakes: string[];
  strengths: string[];
  weaknesses: string[];
}
```

### 2.2 Scoring Algorithms

```typescript
class PerformanceScorer {
  // Calculate role-specific score
  calculateRoleScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    const role = player.assignedRole;
    
    switch (role) {
      case 'mafia':
        return this.calculateMafiaScore(player, game);
      case 'doctor':
        return this.calculateDoctorScore(player, game);
      case 'sheriff':
        return this.calculateSheriffScore(player, game);
      case 'vigilante':
        return this.calculateVigilanteScore(player, game);
      case 'villager':
        return this.calculateVillagerScore(player, game);
      default:
        return 50;
    }
  }
  
  private calculateMafiaScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    let score = 50;  // Base score
    
    // Win bonus/penalty
    if (player.won) score += 20;
    else score -= 10;
    
    // Mafia-specific metrics
    if (player.actions.nightKills !== undefined) {
      // Good targeting
      score += Math.min(player.actions.nightKills * 5, 15);
    }
    
    // Deception score
    const deceptionBonus = this.calculateDeceptionScore(player, game);
    score += deceptionBonus;
    
    // Team coordination
    if (player.actions.privateMessages > 5) {
      score += 5;  // Active team communication
    }
    
    // Survival (if game ended)
    if (game.outcome.mafiaWins && player.survived) {
      score += 10;  // Survived to victory
    }
    
    // Mistakes
    if (player.voting.votesForTeammate > 0) {
      score -= player.voting.votesForTeammate * 10;  // Voting for teammate is bad
    }
    
    // Clutch plays (e.g., surviving elimination when about to be lynched)
    // Would need additional tracking
    
    return Math.min(100, Math.max(0, score));
  }
  
  private calculateDeceptionScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    // Measure how well the mafia deceived town
    
    let score = 0;
    
    // Town players who were eliminated
    const townEliminated = game.players
      .filter(p => p.assignedRole !== 'mafia' && !p.survived);
    
    // If town eliminated mafia players (good for town, bad for mafia)
    const mafiaEliminated = game.players
      .filter(p => p.assignedRole === 'mafia' && !p.survived);
    
    // Mafia success in eliminating town
    if (townEliminated.length > mafiaEliminated.length) {
      score += 10;
    }
    
    // Successful accusations that led to town lynches
    // Would need to track who influenced votes
    
    // How long mafia survived
    const survivalBonus = player.survived ? 5 : 0;
    score += survivalBonus;
    
    // Avoiding suspicion (low suspicion score at end)
    // Would need suspicion tracking
    
    return Math.min(30, score);  // Max 30 points from deception
  }
  
  private calculateDoctorScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    let score = 50;
    
    // Win bonus
    if (player.won) score += 15;
    else score -= 5;
    
    // Saves
    if (player.actions.nightProtects) {
      // Check if protected players survived
      // Would need to track who was protected
      score += Math.min(player.actions.nightProtects * 8, 20);
    }
    
    // Self-protection strategy
    if (player.survived && game.outcome.mafiaWins === false) {
      score += 10;  // Survived and town won
    }
    
    // Smart protection choices
    // Would need to track protection targets and their roles
    
    // Mistakes
    if (player.actions.nightProtects) {
      // Protected mafia?  (Would be known from flip)
      // Protected same player twice?  (Rule violation)
      // Protected player who died anyway?
      // Need additional tracking
    }
    
    return Math.min(100, Math.max(0, score));
  }
  
  private calculateSheriffScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    let score = 50;
    
    // Win bonus
    if (player.won) score += 15;
    else score -= 5;
    
    // Investigations
    if (player.actions.nightInvestigations) {
      // Investigations that found mafia
      score += Math.min(player.actions.nightInvestigations * 10, 30);
    }
    
    // Information sharing
    if (player.actions.roleClaims > 0) {
      score += 10;  // Shared information with town
    }
    
    // Timing of reveals
    // Revealing at the right time (not too early, not too late)
    // Would need timing analysis
    
    // Mistakes
    // Wrong accusations based on investigation
    // Revealing too early and getting killed
    
    return Math.min(100, Math.max(0, score));
  }
  
  private calculateVigilanteScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    let score = 50;
    
    // Win bonus
    if (player.won) score += 20;
    else score -= 10;
    
    // Shot accuracy
    if (player.actions.vigilanteShots) {
      // Hit mafia?
      score += Math.min(player.actions.vigilanteShots * 15, 30);
    }
    
    // Shot timing
    // Good timing (late game when confident)
    // Bad timing (early game random shot)
    // Would need timing analysis
    
    // Strategic value
    // Shot that turned the tide
    // Shot that eliminated key mafia
    
    // Mistakes
    if (player.actions.vigilanteShots) {
      // Hit town?
      score -= 20;  // Major penalty for hitting town
    }
    
    return Math.min(100, Math.max(0, score));
  }
  
  private calculateVillagerScore(
    player: PlayerGameStats,
    game: GameStats
  ): number {
    let score = 50;
    
    // Win bonus
    if (player.won) score += 15;
    else score -= 5;
    
    // Voting accuracy
    if (player.voting.correctVotes > 0) {
      const accuracy = player.voting.correctVotes / player.voting.votesCast;
      score += Math.min(accuracy * 20, 20);
    }
    
    // Deduction quality
    // Suspicion accuracy
    // Role claims analysis
    
    // Leadership
    if (player.actions.accusations > 3) {
      score += 5;  // Active participation
    }
    
    // Mistakes
    if (player.voting.incorrectVotes > 0) {
      score -= player.voting.incorrectVotes * 3;
    }
    
    // Bandwagoning
    if (player.voting.bandwagonVotes > 2) {
      score -= 5;  // Following without independent thought
    }
    
    return Math.min(100, Math.max(0, score));
  }
  
  // Calculate overall score (weighted average)
  calculateOverallScore(player: PlayerGameStats): number {
    const weights = {
      roleScore: 0.4,
      actionQuality: 0.25,
      strategyScore: 0.2,
      communication: 0.15
    };
    
    return (
      player.performance.roleScore * weights.roleScore +
      player.performance.actionQuality * weights.actionQuality +
      player.performance.strategyScore * weights.strategyScore +
      (player.communication.avgSayLength > 0 ? 50 : 0) * weights.communication  // Placeholder
    );
  }
}
```

---

## 3. Model Comparison System

### 3.1 Model Performance Database

```typescript
interface ModelPerformance {
  modelId: string;
  modelName: string;
  provider: string;
  
  // Overall stats
  overall: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    winRate: number;
    avgScore: number;
    avgRank: number;
  };
  
  // Role-specific stats
  roles: {
    [role: string]: RoleStats;
  };
  
  // Performance vs other models
  matchups: {
    [opponentModelId: string]: {
      games: number;
      wins: number;
      losses: number;
      winRate: number;
      avgScoreDiff: number;
    };
  };
  
  // Temporal trends
  trends: {
    lastWeek: WeeklyStats;
    lastMonth: MonthlyStats;
    allTime: AggregateStats;
  };
  
  // Strengths and weaknesses
  analysis: {
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
}

interface RoleStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgScore: number;
  avgRoleScore: number;
  bestPerformance: {
    gameId: string;
    score: number;
    date: string;
  };
  worstPerformance: {
    gameId: string;
    score: number;
    date: string;
  };
  commonPatterns: {
    pattern: string;
    frequency: number;
    impact: 'positive' | 'negative' | 'neutral';
  }[];
}

interface MatchupStats {
  opponent: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgScoreWhenWinning: number;
  avgScoreWhenLosing: number;
  commonOutcomes: string[];
}

class ModelComparisonEngine {
  private modelStats: Map<string, ModelPerformance> = new Map();
  
  // Update model stats after a game
  updateModelStats(gameStats: GameStats): void {
    for (const player of gameStats.players) {
      const modelId = `${player.provider}:${player.model}`;
      let stats = this.modelStats.get(modelId);
      
      if (!stats) {
        stats = this.initializeModelStats(player.model, player.provider);
        this.modelStats.set(modelId, stats);
      }
      
      // Update overall stats
      stats.overall.gamesPlayed++;
      if (player.won) stats.overall.wins++;
      else stats.overall.losses++;
      stats.overall.winRate = stats.overall.wins / stats.overall.gamesPlayed;
      stats.overall.avgScore = 
        (stats.overall.avgScore * (stats.overall.gamesPlayed - 1) + player.performance.overallScore) 
        / stats.overall.gamesPlayed;
      
      // Update role stats
      const role = player.assignedRole;
      if (!stats.roles[role]) {
        stats.roles[role] = this.initializeRoleStats(role);
      }
      
      const roleStats = stats.roles[role];
      roleStats.gamesPlayed++;
      if (player.won) roleStats.wins++;
      else roleStats.losses++;
      roleStats.winRate = roleStats.wins / roleStats.gamesPlayed;
      roleStats.avgRoleScore = 
        (roleStats.avgRoleScore * (roleStats.gamesPlayed - 1) + player.performance.roleScore)
        / roleStats.gamesPlayed;
      
      // Update matchups
      for (const opponent of gameStats.players) {
        if (opponent.playerId === player.playerId) continue;
        
        const opponentId = `${opponent.provider}:${opponent.model}`;
        if (!stats.matchups[opponentId]) {
          stats.matchups[opponentId] = {
            opponent: opponent.model,
            games: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winRate: 0,
            avgScoreWhenWinning: 0,
            avgScoreWhenLosing: 0,
            commonOutcomes: []
          };
        }
        
        const matchup = stats.matchups[opponentId];
        matchup.games++;
        if (player.won) {
          matchup.wins++;
          matchup.avgScoreWhenWinning = 
            (matchup.avgScoreWhenWinning * (matchup.wins - 1) + player.performance.overallScore)
            / matchup.wins;
        } else {
          matchup.losses++;
          matchup.avgScoreWhenLosing = 
            (matchup.avgScoreWhenLosing * (matchup.losses - 1) + player.performance.overallScore)
            / matchup.losses;
        }
        matchup.winRate = matchup.wins / matchup.games;
      }
      
      // Analyze patterns
      this.analyzePlayerPatterns(player, stats);
    }
  }
  
  // Get comparison between two models
  compareModels(modelA: string, modelB: string): ModelComparison {
    const statsA = this.modelStats.get(modelA);
    const statsB = this.modelStats.get(modelB);
    
    if (!statsA || !statsB) {
      throw new Error('Model not found');
    }
    
    return {
      modelA: {
        id: modelA,
        overallWinRate: statsA.overall.winRate,
        avgScore: statsA.overall.avgScore,
        bestRole: this.getBestRole(statsA),
        worstRole: this.getWorstRole(statsA),
        headToHead: statsA.matchups[modelB] || null
      },
      modelB: {
        id: modelB,
        overallWinRate: statsB.overall.winRate,
        avgScore: statsB.overall.avgScore,
        bestRole: this.getBestRole(statsB),
        worstRole: this.getWorstRole(statsB),
        headToHead: statsB.matchups[modelA] || null
      },
      winner: statsA.overall.winRate > statsB.overall.winRate ? modelA : modelB,
      analysis: this.generateComparisonAnalysis(statsA, statsB)
    };
  }
  
  // Get leaderboard
  getLeaderboard(options?: {
    sortBy?: 'winRate' | 'avgScore' | 'gamesPlayed';
    role?: string;
    limit?: number;
    minGames?: number;
  }): LeaderboardEntry[] {
    const { sortBy = 'winRate', role, limit = 10, minGames = 5 } = options || {};
    
    let entries = Array.from(this.modelStats.entries())
      .filter(([_, stats]) => stats.overall.gamesPlayed >= minGames)
      .map(([id, stats]) => ({
        rank: 0,
        modelId: id,
        modelName: stats.modelName,
        gamesPlayed: stats.overall.gamesPlayed,
        wins: stats.overall.wins,
        winRate: stats.overall.winRate,
        avgScore: stats.overall.avgScore,
        bestRole: this.getBestRole(stats),
        recentTrend: this.calculateTrend(stats)
      }));
    
    // Sort
    entries.sort((a, b) => {
      if (sortBy === 'winRate') return b.winRate - a.winRate;
      if (sortBy === 'avgScore') return b.avgScore - a.avgScore;
      return b.gamesPlayed - a.gamesPlayed;
    });
    
    // Assign ranks
    entries = entries.map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
    
    // Limit
    return entries.slice(0, limit);
  }
  
  // Get role-specific rankings
  getRoleLeaderboard(role: string, limit: number = 10): LeaderboardEntry[] {
    return Array.from(this.modelStats.entries())
      .filter(([_, stats]) => stats.roles[role])
      .map(([id, stats]) => ({
        rank: 0,
        modelId: id,
        modelName: stats.modelName,
        gamesPlayed: stats.roles[role].gamesPlayed,
        wins: stats.roles[role].wins,
        winRate: stats.roles[role].winRate,
        avgScore: stats.roles[role].avgRoleScore,
        bestRole: role,
        recentTrend: this.calculateTrend(stats)
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
  
  private initializeModelStats(modelName: string, provider: string): ModelPerformance {
    return {
      modelId: `${provider}:${modelName}`,
      modelName,
      provider,
      overall: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgScore: 0,
        avgRank: 0
      },
      roles: {},
      matchups: {},
      trends: {
        lastWeek: { games: 0, winRate: 0, avgScore: 0 },
        lastMonth: { games: 0, winRate: 0, avgScore: 0 },
        allTime: { games: 0, winRate: 0, avgScore: 0 }
      },
      analysis: {
        strengths: [],
        weaknesses: [],
        recommendations: []
      }
    };
  }
  
  private initializeRoleStats(role: string): RoleStats {
    return {
      role,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgScore: 0,
      avgRoleScore: 0,
      bestPerformance: { gameId: '', score: 0, date: '' },
      worstPerformance: { gameId: '', score: 0, date: '' },
      commonPatterns: []
    };
  }
}
```

### 3.2 Benchmark Report Generation

```typescript
interface BenchmarkReport {
  reportId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  
  // Summary
  summary: {
    totalGames: number;
    totalPlayers: number;
    totalModels: number;
    totalTokens: number;
    totalCost: number;
    avgGameDuration: number;
  };
  
  // Leaderboards
  leaderboards: {
    overall: LeaderboardEntry[];
    byRole: {
      mafia: LeaderboardEntry[];
      doctor: LeaderboardEntry[];
      sheriff: LeaderboardEntry[];
      vigilante: LeaderboardEntry[];
      villager: LeaderboardEntry[];
    };
    byProvider: LeaderboardEntry[];
  };
  
  // Insights
  insights: {
    topPerformers: string[];
    biggestSurprises: string[];
    mostConsistent: string[];
    mostVolatile: string[];
    roleSpecialists: string[];
    roleGeneralists: string[];
  };
  
  // Trends
  trends: {
    improvingModels: string[];
    decliningModels: string[];
    risingStars: string[];
    underperformers: string[];
  };
  
  // Model comparisons
  comparisons: ModelComparison[];
  
  // Recommendations
  recommendations: string[];
}

class BenchmarkReporter {
  private comparisonEngine: ModelComparisonEngine;
  
  generateReport(
    startDate: Date,
    endDate: Date = new Date()
  ): BenchmarkReport {
    // Collect data
    const games = this.getGamesInPeriod(startDate, endDate);
    const stats = this.aggregateStats(games);
    const leaderboards = this.generateLeaderboards(stats);
    const insights = this.generateInsights(stats);
    const trends = this.analyzeTrends(stats);
    const comparisons = this.generateKeyComparisons(stats);
    const recommendations = this.generateRecommendations(stats);
    
    return {
      reportId: generateReportId(),
      generatedAt: new Date(),
      period: {
        start: startDate,
        end: endDate
      },
      summary: {
        totalGames: games.length,
        totalPlayers: stats.totalPlayers,
        totalModels: stats.totalModels,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        avgGameDuration: stats.totalDuration / games.length
      },
      leaderboards,
      insights,
      trends,
      comparisons,
      recommendations
    };
  }
  
  generateInsights(stats: AggregateStats): BenchmarkInsights {
    const insights: BenchmarkInsights = {
      topPerformers: [],
      biggestSurprises: [],
      mostConsistent: [],
      mostVolatile: [],
      roleSpecialists: [],
      roleGeneralists: []
    };
    
    // Top performers (highest win rate, min 10 games)
    const topModels = Object.values(stats.models)
      .filter(m => m.overall.gamesPlayed >= 10)
      .sort((a, b) => b.overall.winRate - a.overall.winRate);
    
    insights.topPerformers = topModels.slice(0, 5).map(m => m.modelName);
    
    // Biggest surprises (models that overperformed vs expectations)
    // Would need expected vs actual comparison
    
    // Most consistent (low variance in scores)
    insights.mostConsistent = this.findMostConsistent(stats.models);
    
    // Most volatile (high variance in scores)
    insights.mostVolatile = this.findMostVolatile(stats.models);
    
    // Role specialists (high win rate in one role, lower in others)
    insights.roleSpecialists = this.findRoleSpecialists(stats.models);
    
    // Role generalists (consistent performance across roles)
    insights.roleGeneralists = this.findRoleGeneralists(stats.models);
    
    return insights;
  }
  
  generateRecommendations(stats: AggregateStats): string[] {
    const recommendations: string[] = [];
    
    // Based on analysis
    for (const [modelId, model] of Object.entries(stats.models)) {
      // If low performance in specific role
      const lowRole = this.findLowestRole(model);
      if (lowRole && model.roles[lowRole].winRate < 0.3) {
        recommendations.push(
          `${model.modelName} struggles as ${lowRole} (${Math.round(model.roles[lowRole].winRate * 100)}% win rate). Consider avoiding this role.`
        );
      }
      
      // If high performance in specific role
      const highRole = this.findHighestRole(model);
      if (highRole && model.roles[highRole].winRate > 0.7) {
        recommendations.push(
          `${model.modelName} excels as ${highRole} (${Math.round(model.roles[highRole].winRate * 100)}% win rate). Consider using in this role.`
        );
      }
    }
    
    // Provider recommendations
    // Cost/performance analysis
    
    return recommendations;
  }
  
  exportReport(report: BenchmarkReport, format: 'json' | 'csv' | 'html'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      
      case 'csv':
        return this.toCSV(report);
      
      case 'html':
        return this.toHTML(report);
      
      default:
        return JSON.stringify(report);
    }
  }
}
```

---

## 4. Stats API Endpoints

### 4.1 REST API for Stats

```typescript
// Stats API Endpoints
const STATS_ENDPOINTS = {
  // Game stats
  'GET /api/v1/stats/games/:id': 'Get detailed stats for a specific game',
  'GET /api/v1/stats/games/:id/players/:playerId': 'Get player stats for a game',
  
  // Real-time dashboard
  'GET /api/v1/stats/realtime/:gameId': 'Get real-time dashboard data',
  
  // Model performance
  'GET /api/v1/stats/models/:modelId': 'Get overall model performance',
  'GET /api/v1/stats/models/:modelId/roles': 'Get role-specific model performance',
  'GET /api/v1/stats/models/:modelId/matchups': 'Get model matchup stats',
  
  // Leaderboards
  'GET /api/v1/stats/leaderboard': 'Get overall leaderboard',
  'GET /api/v1/stats/leaderboard/role/:role': 'Get role-specific leaderboard',
  'GET /api/v1/stats/leaderboard/provider/:provider': 'Get provider leaderboard',
  
  // Comparisons
  'GET /api/v1/stats/compare/:modelA/:modelB': 'Compare two models',
  
  // Reports
  'GET /api/v1/stats/reports': 'List available reports',
  'GET /api/v1/stats/reports/:id': 'Get specific report',
  'POST /api/v1/stats/reports/generate': 'Generate new report',
  'GET /api/v1/stats/reports/:id/export': 'Export report (json/csv/html)',
  
  // Aggregates
  'GET /api/v1/stats/aggregate': 'Get aggregate statistics',
  'GET /api/v1/stats/aggregate/tokens': 'Get token usage stats',
  'GET /api/v1/stats/aggregate/cost': 'Get cost statistics',
  'GET /api/v1/stats/aggregate/providers': 'Get provider comparison stats'
};

// Stats API implementation
class StatsAPI {
  async getGameStats(gameId: string): Promise<GameStats> {
    // Retrieve game stats from database
    return this.gameStatsStore.get(gameId);
  }
  
  async getModelStats(modelId: string): Promise<ModelPerformance> {
    return this.comparisonEngine.modelStats.get(modelId);
  }
  
  async getLeaderboard(options: LeaderboardOptions): Promise<LeaderboardEntry[]> {
    return this.comparisonEngine.getLeaderboard(options);
  }
  
  async compareModels(modelA: string, modelB: string): Promise<ModelComparison> {
    return this.comparisonEngine.compareModels(modelA, modelB);
  }
  
  async generateReport(
    startDate: Date,
    endDate: Date,
    options?: ReportOptions
  ): Promise<BenchmarkReport> {
    return this.reporter.generateReport(startDate, endDate);
  }
  
  async exportReport(
    reportId: string,
    format: 'json' | 'csv' | 'html'
  ): Promise<string> {
    const report = await this.reportStore.get(reportId);
    return this.reporter.exportReport(report, format);
  }
}
```

### 4.2 Stats CLI Commands

```bash
# View game stats
mafiactl stats game <gameId>

# View model performance
mafiactl stats model <modelId>

# View leaderboard
mafiactl stats leaderboard --role mafia --limit 10

# Compare models
mafiactl stats compare <modelA> <modelB>

# Generate benchmark report
mafiactl stats report --start 2024-01-01 --end 2024-12-31 --format html

# View real-time dashboard
mafiactl stats realtime <gameId>

# View token usage
mafiactl stats tokens --game <gameId> --player <playerId>

# View provider comparison
mafiactl stats providers --sort-by cost

# Export all stats
mafiactl stats export --format jsonl
```

---

## 5. Database Schema for Stats

```typescript
// Stats tables for SQLite

const STATS_SCHEMA = {
  // Token usage per turn
  token_usage: `
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      action_type TEXT,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      estimated_cost REAL,
      FOREIGN KEY (game_id) REFERENCES games(id),
      INDEX idx_game_player (game_id, player_id),
      INDEX idx_timestamp (timestamp)
    )
  `,
  
  // API call tracking
  api_calls: `
    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status_code INTEGER NOT NULL,
      success INTEGER NOT NULL,
      retry_count INTEGER NOT NULL,
      payload_size INTEGER NOT NULL,
      response_size INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id),
      INDEX idx_game_player (game_id, player_id),
      INDEX idx_provider (provider),
      INDEX idx_timestamp (timestamp)
    )
  `,
  
  // Per-player game stats
  player_game_stats: `
    CREATE TABLE IF NOT EXISTS player_game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      assigned_role TEXT NOT NULL,
      actual_role TEXT NOT NULL,
      status TEXT NOT NULL,
      survived INTEGER NOT NULL,
      won INTEGER NOT NULL,
      role_score REAL NOT NULL,
      action_quality REAL NOT NULL,
      strategy_score REAL NOT NULL,
      deception_score REAL,
      deduction_score REAL,
      overall_score REAL NOT NULL,
      think_tokens INTEGER NOT NULL,
      say_tokens INTEGER NOT NULL,
      night_kills INTEGER,
      night_protects INTEGER,
      night_investigations INTEGER,
      vigilante_shots INTEGER,
      votes_cast INTEGER NOT NULL,
      correct_votes INTEGER NOT NULL,
      incorrect_votes INTEGER NOT NULL,
      accusations INTEGER NOT NULL,
      defenses INTEGER NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id),
      INDEX idx_game_player (game_id, player_id),
      INDEX idx_model (model),
      INDEX idx_role (assigned_role)
    )
  `,
  
  // Model aggregate stats
  model_aggregate_stats: `
    CREATE TABLE IF NOT EXISTS model_aggregate_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL UNIQUE,
      model_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      games_played INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      total_cost REAL NOT NULL,
      avg_score REAL NOT NULL,
      avg_role_score_mafia REAL,
      avg_role_score_doctor REAL,
      avg_role_score_sheriff REAL,
      avg_role_score_vigilante REAL,
      avg_role_score_villager REAL,
      last_updated INTEGER NOT NULL,
      INDEX idx_model (model_id),
      INDEX idx_provider (provider)
    )
  `,
  
  // Model matchups
  model_matchups: `
    CREATE TABLE IF NOT EXISTS model_matchups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      opponent_id TEXT NOT NULL,
      games INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      avg_score_diff REAL NOT NULL,
      last_updated INTEGER NOT NULL,
      FOREIGN KEY (model_id) REFERENCES model_aggregate_stats(model_id),
      UNIQUE (model_id, opponent_id),
      INDEX idx_opponent (opponent_id)
    )
  `,
  
  // Benchmark reports
  benchmark_reports: `
    CREATE TABLE IF NOT EXISTS benchmark_reports (
      id TEXT PRIMARY KEY,
      generated_at INTEGER NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      total_games INTEGER NOT NULL,
      total_players INTEGER NOT NULL,
      total_models INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      total_cost REAL NOT NULL,
      report_data TEXT NOT NULL,
      INDEX idx_generated_at (generated_at)
    )
  `
};
```

---

## 6. Dashboard Visualization

### 6.1 Stats Dashboard Components

```typescript
// Stats Dashboard UI Components

interface StatsDashboardProps {
  gameId?: string;
  startDate?: Date;
  endDate?: Date;
  view: 'realtime' | 'historical' | 'benchmark';
}

class StatsDashboard {
  // Real-time metrics display
  renderRealtimeMetrics(dashboard: RealtimeDashboard): JSX.Element {
    return (
      <div className="realtime-metrics">
        <div className="metric-card">
          <h3>Token Usage</h3>
          <div className="metric-value">
            {dashboard.live.tokenUsage.totalTokens.toLocaleString()}
          </div>
          <div className="metric-detail">
            {dashboard.live.tokenUsage.tokensPerSecond.toFixed(1)}/sec
          </div>
          <div className="metric-cost">
            ${dashboard.live.tokenUsage.estimatedCost.toFixed(4)}
          </div>
        </div>
        
        <div className="metric-card">
          <h3>API Status</h3>
          <div className="metric-value">
            {dashboard.live.apiStatus.activeCalls}
          </div>
          <div className="metric-detail">
            {dashboard.live.apiStatus.avgLatency.toFixed(0)}ms avg
          </div>
          <div className={`metric-error ${dashboard.live.apiStatus.errorRate > 5 ? 'high' : 'low'}`}>
            {dashboard.live.apiStatus.errorRate.toFixed(1)}% errors
          </div>
        </div>
        
        <div className="metric-card">
          <h3>Data Transfer</h3>
          <div className="metric-value">
            {(dashboard.live.dataTransfer.downloaded / 1024 / 1024).toFixed(2)} MB
          </div>
          <div className="metric-detail">
            {(dashboard.live.dataTransfer.rate / 1024).toFixed(1)} KB/s
          </div>
        </div>
        
        {/* Provider breakdown */}
        <div className="providers-breakdown">
          <h3>Providers</h3>
          {dashboard.live.apiStatus.providers.map(provider => (
            <div key={provider.name} className="provider-row">
              <span className="provider-name">{provider.name}</span>
              <div className="provider-stats">
                <span>{provider.calls} calls</span>
                <span>{provider.avgLatency.toFixed(0)}ms</span>
                <span>{provider.errors} errors</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  // Leaderboard display
  renderLeaderboard(entries: LeaderboardEntry[]): JSX.Element {
    return (
      <div className="leaderboard">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Win Rate</th>
              <th>Avg Score</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.modelId}>
                <td className="rank">{entry.rank}</td>
                <td className="model">{entry.modelName}</td>
                <td>{entry.gamesPlayed}</td>
                <td>{entry.wins}</td>
                <td className={entry.winRate > 0.6 ? 'high' : entry.winRate < 0.4 ? 'low' : ''}>
                  {(entry.winRate * 100).toFixed(1)}%
                </td>
                <td>{entry.avgScore.toFixed(1)}</td>
                <td className={`trend ${entry.recentTrend}`}>
                  {entry.recentTrend === 'up' ? '↑' : entry.recentTrend === 'down' ? '↓' : '→'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  
  // Model comparison chart
  renderComparisonChart(comparison: ModelComparison): JSX.Element {
    return (
      <div className="comparison-chart">
        <div className="model-a">
          <h3>{comparison.modelA.id}</h3>
          <div className="stats">
            <div className="stat">
              <span className="label">Win Rate</span>
              <span className="value">{(comparison.modelA.overallWinRate * 100).toFixed(1)}%</span>
            </div>
            <div className="stat">
              <span className="label">Avg Score</span>
              <span className="value">{comparison.modelA.avgScore.toFixed(1)}</span>
            </div>
            <div className="stat">
              <span className="label">Best Role</span>
              <span className="value">{comparison.modelA.bestRole}</span>
            </div>
          </div>
        </div>
        
        <div className="vs-badge">VS</div>
        
        <div className="model-b">
          <h3>{comparison.modelB.id}</h3>
          <div className="stats">
            <div className="stat">
              <span className="label">Win Rate</span>
              <span className="value">{(comparison.modelB.overallWinRate * 100).toFixed(1)}%</span>
            </div>
            <div className="stat">
              <span className="label">Avg Score</span>
              <span className="value">{comparison.modelB.avgScore.toFixed(1)}</span>
            </div>
            <div className="stat">
              <span className="label">Best Role</span>
              <span className="value">{comparison.modelB.bestRole}</span>
            </div>
          </div>
        </div>
        
        <div className="winner">
          Winner: {comparison.winner}
        </div>
        
        <div className="analysis">
          <h4>Analysis</h4>
          <p>{comparison.analysis}</p>
        </div>
      </div>
    );
  }
}
```

---

## 7. Summary

### Stats & Scoring System Provides:

1. **Real-Time Tracking**
   - Token usage per turn
   - API call metrics
   - Data transfer monitoring
   - Provider status

2. **Post-Game Analysis**
   - Per-player performance scores
   - Role-specific metrics
   - Action quality assessment
   - Strategy evaluation

3. **Model Comparison**
   - Win/loss statistics
   - Head-to-head matchups
   - Role-specific performance
   - Trend analysis

4. **Benchmark Reporting**
   - Automated report generation
   - Multiple export formats
   - Insights and recommendations
   - Leaderboards

5. **Visualization**
   - Real-time dashboard
   - Leaderboard displays
   - Comparison charts
   - Performance trends

### Database Tables Created:
- `token_usage` - Turn-by-turn token tracking
- `api_calls` - API call metrics
- `player_game_stats` - Per-player performance
- `model_aggregate_stats` - Model summaries
- `model_matchups` - Head-to-head records
- `benchmark_reports` - Generated reports

This stats system transforms the Mafia AI Benchmark into a comprehensive evaluation platform where you can track, analyze, and compare model performance across all dimensions!