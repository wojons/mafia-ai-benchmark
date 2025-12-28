/**
 * Cost Tracking Service
 * 
 * Tracks API costs for each player, game, and overall.
 * Uses real-time pricing from models.dev API.
 */

import { getModelPricing, getCachedCostEstimate, ModelPricing } from './model-metadata.js';

export interface CostEntry {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
  phase: string;
  action?: string;
}

export interface PlayerCostSummary {
  playerId: string;
  playerName: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  averageCostPerRequest: number;
  modelUsed: string;
}

export interface GameCostSummary {
  gameId: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  playerBreakdown: PlayerCostSummary[];
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface CostTrackerOptions {
  trackPerPlayer: boolean;
  trackPerPhase: boolean;
  trackPerAction: boolean;
  warnThreshold: number; // Cost threshold to warn at
  maxCostPerGame: number; // Hard limit for costs
}

/**
 * Cost Tracker for Mafia AI Benchmark
 */
export class CostTracker {
  private gameId: string;
  private options: CostTrackerOptions;
  private entries: CostEntry[] = [];
  private playerCosts: Map<string, CostEntry[]> = new Map();
  private totalCost: number = 0;
  private startTime: number;
  private warnings: string[] = [];
  
  constructor(gameId: string, options?: Partial<CostTrackerOptions>) {
    this.gameId = gameId;
    this.startTime = Date.now();
    this.options = {
      trackPerPlayer: options?.trackPerPlayer ?? true,
      trackPerPhase: options?.trackPerPhase ?? true,
      trackPerAction: options?.trackPerAction ?? true,
      warnThreshold: options?.warnThreshold ?? 1.0, // Warn at $1
      maxCostPerGame: options?.maxCostPerGame ?? 100, // Hard limit at $100
    };
  }
  
  /**
   * Track a cost entry
   */
  async track(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    phase: string,
    action?: string,
    playerId?: string,
    playerName?: string
  ): Promise<CostEntry> {
    // Calculate cost using real pricing
    const pricing = await getModelPricing(modelId);
    
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    const cost = inputCost + outputCost;
    
    const entry: CostEntry = {
      modelId,
      inputTokens,
      outputTokens,
      cost,
      timestamp: Date.now(),
      phase,
      action,
    };
    
    this.entries.push(entry);
    this.totalCost += cost;
    
    // Track per player if specified
    if (this.options.trackPerPlayer && playerId) {
      const playerEntries = this.playerCosts.get(playerId) || [];
      playerEntries.push(entry);
      this.playerCosts.set(playerId, playerEntries);
    }
    
    // Check warnings
    this.checkWarnings();
    
    return entry;
  }
  
  /**
   * Track a cost entry using cached pricing (no async)
   */
  trackSync(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    phase: string,
    action?: string,
    playerId?: string,
    playerName?: string
  ): CostEntry {
    // Use cached pricing (synchronous)
    const estimate = getCachedCostEstimate(modelId, inputTokens, outputTokens);
    
    const entry: CostEntry = {
      modelId,
      inputTokens,
      outputTokens,
      cost: estimate.cost,
      timestamp: Date.now(),
      phase,
      action,
    };
    
    this.entries.push(entry);
    this.totalCost += entry.cost;
    
    // Track per player if specified
    if (this.options.trackPerPlayer && playerId) {
      const playerEntries = this.playerCosts.get(playerId) || [];
      playerEntries.push(entry);
      this.playerCosts.set(playerId, playerEntries);
    }
    
    // Check warnings
    this.checkWarnings();
    
    return entry;
  }
  
  /**
   * Check for cost warnings
   */
  private checkWarnings(): void {
    // Per-game warning
    if (this.totalCost >= this.options.warnThreshold && this.warnings.length === 0) {
      this.warnings.push(`Game cost reached $${this.totalCost.toFixed(2)} (threshold: $${this.options.warnThreshold})`);
    }
    
    // Per-player warning
    for (const [playerId, entries] of this.playerCosts) {
      const playerTotal = entries.reduce((sum, e) => sum + e.cost, 0);
      if (playerTotal >= this.options.warnThreshold) {
        this.warnings.push(`Player ${playerId} cost reached $${playerTotal.toFixed(2)}`);
      }
    }
    
    // Hard limit check
    if (this.totalCost >= this.options.maxCostPerGame) {
      this.warnings.push(`🚨 HARD LIMIT REACHED: Game cost $${this.totalCost.toFixed(2)} >= max $${this.options.maxCostPerGame}`);
    }
  }
  
  /**
   * Get total cost for the game
   */
  getTotalCost(): number {
    return this.totalCost;
  }
  
  /**
   * Get formatted total cost
   */
  getFormattedTotalCost(): string {
    return this.totalCost < 0.01 
      ? `$${(this.totalCost * 1000).toFixed(4)}`
      : `$${this.totalCost.toFixed(2)}`;
  }
  
  /**
   * Get cost summary for the game
   */
  getGameSummary(): GameCostSummary {
    const playerBreakdown: PlayerCostSummary[] = [];
    
    for (const [playerId, entries] of this.playerCosts) {
      const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
      const totalInput = entries.reduce((sum, e) => sum + e.inputTokens, 0);
      const totalOutput = entries.reduce((sum, e) => sum + e.outputTokens, 0);
      
      // Get most used model
      const modelCounts = new Map<string, number>();
      for (const entry of entries) {
        modelCounts.set(entry.modelId, (modelCounts.get(entry.modelId) || 0) + 1);
      }
      let mostUsedModel = '';
      let maxCount = 0;
      for (const [model, count] of modelCounts) {
        if (count > maxCount) {
          mostUsedModel = model;
          maxCount = count;
        }
      }
      
      playerBreakdown.push({
        playerId,
        playerName: `Player ${playerId}`,
        totalCost,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        requestCount: entries.length,
        averageCostPerRequest: entries.length > 0 ? totalCost / entries.length : 0,
        modelUsed: mostUsedModel,
      });
    }
    
    return {
      gameId: this.gameId,
      totalCost: this.totalCost,
      totalInputTokens: this.entries.reduce((sum, e) => sum + e.inputTokens, 0),
      totalOutputTokens: this.entries.reduce((sum, e) => sum + e.outputTokens, 0),
      totalRequests: this.entries.length,
      playerBreakdown,
      startTime: this.startTime,
      endTime: Date.now(),
      duration: Date.now() - this.startTime,
    };
  }
  
  /**
   * Get player cost summary
   */
  getPlayerSummary(playerId: string): PlayerCostSummary | null {
    const entries = this.playerCosts.get(playerId);
    if (!entries || entries.length === 0) return null;
    
    const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
    const totalInput = entries.reduce((sum, e) => sum + e.inputTokens, 0);
    const totalOutput = entries.reduce((sum, e) => sum + e.outputTokens, 0);
    
    // Get most used model
    const modelCounts = new Map<string, number>();
    for (const entry of entries) {
      modelCounts.set(entry.modelId, (modelCounts.get(entry.modelId) || 0) + 1);
    }
    let mostUsedModel = '';
    let maxCount = 0;
    for (const [model, count] of modelCounts) {
      if (count > maxCount) {
        mostUsedModel = model;
        maxCount = count;
      }
    }
    
    return {
      playerId,
      playerName: `Player ${playerId}`,
      totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      requestCount: entries.length,
      averageCostPerRequest: totalCost / entries.length,
      modelUsed: mostUsedModel,
    };
  }
  
  /**
   * Get all warnings
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }
  
  /**
   * Get all entries
   */
  getEntries(): CostEntry[] {
    return [...this.entries];
  }
  
  /**
   * Get entries by phase
   */
  getEntriesByPhase(phase: string): CostEntry[] {
    return this.entries.filter(e => e.phase === phase);
  }
  
  /**
   * Get entries by player
   */
  getEntriesByPlayer(playerId: string): CostEntry[] {
    return this.playerCosts.get(playerId) || [];
  }
  
  /**
   * Format cost for display
   */
  static formatCost(cost: number): string {
    if (cost < 0.001) {
      return `$${(cost * 1000).toFixed(4)}`;
    } else if (cost < 0.01) {
      return `$${cost.toFixed(3)}`;
    } else {
      return `$${cost.toFixed(2)}`;
    }
  }
  
  /**
   * Estimate cost for a prompt
   */
  static async estimateCost(
    modelId: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number
  ): Promise<{ cost: number; formatted: string; hasPricing: boolean }> {
    const pricing = await getModelPricing(modelId);
    
    if (!pricing.hasPricing) {
      return {
        cost: 0,
        formatted: 'No pricing data',
        hasPricing: false,
      };
    }
    
    const inputCost = (estimatedInputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion;
    const total = inputCost + outputCost;
    
    return {
      cost: total,
      formatted: CostTracker.formatCost(total),
      hasPricing: true,
    };
  }
}

/**
 * Global cost tracker registry
 */
class CostTrackerRegistry {
  private trackers: Map<string, CostTracker> = new Map();
  
  createTracker(gameId: string, options?: Partial<CostTrackerOptions>): CostTracker {
    const tracker = new CostTracker(gameId, options);
    this.trackers.set(gameId, tracker);
    return tracker;
  }
  
  getTracker(gameId: string): CostTracker | undefined {
    return this.trackers.get(gameId);
  }
  
  removeTracker(gameId: string): void {
    this.trackers.delete(gameId);
  }
  
  getAllTrackers(): Map<string, CostTracker> {
    return new Map(this.trackers);
  }
  
  getTotalCostAcrossAllGames(): number {
    let total = 0;
    for (const tracker of this.trackers.values()) {
      total += tracker.getTotalCost();
    }
    return total;
  }
}

// Global registry instance
export const costTrackerRegistry = new CostTrackerRegistry();

/**
 * Create a new cost tracker for a game
 */
export function createCostTracker(gameId: string, options?: Partial<CostTrackerOptions>): CostTracker {
  return costTrackerRegistry.createTracker(gameId, options);
}

/**
 * Get cost tracker for a game
 */
export function getCostTracker(gameId: string): CostTracker | undefined {
  return costTrackerRegistry.getTracker(gameId);
}

/**
 * Remove cost tracker for a game
 */
export function removeCostTracker(gameId: string): void {
  costTrackerRegistry.removeTracker(gameId);
}
