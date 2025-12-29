// ============================================
// COST TRACKING & BUDGET ENFORCEMENT
// Mafia AI Benchmark
// ============================================

const { getDatabase } = require("./modules/database");

/**
 * Cost Tracking System
 *
 * Tracks token usage across games with per-turn, per-player, per-model granularity
 * Enforces budget limits to prevent overspending
 */

class CostTracker {
  constructor(db, budgetLimits = {}) {
    this.db = db;

    // Default budget limits (in USD)
    this.budgetLimits = {
      perPlayerPerTurn: budgetLimits.perPlayerPerTurn || 0.5, // $0.50 per player per turn
      perGameTotal: budgetLimits.perGameTotal || 10.0, // $10 per game total
      perModelPerTurn: budgetLimits.perModelPerTurn || 0.75, // $0.75 per model per turn
      warningThreshold: budgetLimits.warningThreshold || 0.8, // Warn at 80% of budget
      stopThreshold: budgetLimits.stopThreshold || 1.0, // Stop at 100% of budget
    };

    // In-memory tracking
    this.tracking = new Map(); // Map<gameId, CostTrackingState>
  }

  /**
   * Track cost for a single player in a single turn
   */
  trackPlayerTurn(gameId, playerId, playerName, turnData) {
    const {
      phase,
      actionType,
      model,
      provider,
      promptTokens,
      completionTokens,
      prices = {},
    } = turnData;

    const estimatedCost = this._calculateTurnCost(
      promptTokens,
      completionTokens,
      prices,
    );

    // Get or create tracking state for this game
    if (!this.tracking.has(gameId)) {
      this.tracking.set(gameId, {
        gameId,
        playerTracking: new Map(), // Map<playerId, PlayerCostState>
        modelTracking: new Map(), // Map<model, ModelCostState>
        phaseTracking: new Map(), // Map<phase, PhaseCostState>
        totalCost: 0,
        totalTokens: 0,
        warningsTriggered: 0,
        stopsTriggered: 0,
      });
    }

    const state = this.tracking.get(gameId);

    // Update player tracking
    if (!state.playerTracking.has(playerId)) {
      state.playerTracking.set(playerId, {
        playerId,
        playerName,
        totalTurns: 0,
        totalCost: 0,
        totalTokens: 0,
        costsByPhase: new Map(),
        warnings: 0,
        stops: 0,
      });
    }

    const playerState = state.playerTracking.get(playerId);
    playerState.totalTurns++;
    playerState.totalCost += estimatedCost.totalCost;
    playerState.totalTokens += estimatedCost.totalTokens;

    // Update phase-specific tracking
    if (!playerState.costsByPhase.has(phase)) {
      playerState.costsByPhase.set(phase, {
        phase,
        turns: 0,
        totalCost: 0,
        totalTokens: 0,
      });
    }
    const phaseState = playerState.costsByPhase.get(phase);
    phaseState.turns++;
    phaseState.totalCost += estimatedCost.totalCost;
    phaseState.totalTokens += estimatedCost.totalTokens;

    // Update model tracking
    const modelKey = `${provider}:${model}`;
    if (!state.modelTracking.has(modelKey)) {
      state.modelTracking.set(modelKey, {
        provider,
        model,
        totalTurns: 0,
        totalCost: 0,
        totalTokens: 0,
      });
    }
    const modelState = state.modelTracking.get(modelKey);
    modelState.totalTurns++;
    modelState.totalCost += estimatedCost.totalCost;
    modelState.totalTokens += estimatedCost.totalTokens;

    // Update game totals
    state.totalCost += estimatedCost.totalCost;
    state.totalTokens += estimatedCost.totalTokens;

    // Check budget limits
    this._checkBudgetLimits(gameId, playerId, playerState, state);

    return {
      ...estimatedCost,
      warningTriggered: this._wasWarningTriggered(gameId, playerId),
      stopTriggered: this._wasStopTriggered(gameId, playerId),
      remainingBudget: this.budgetLimits.perGameTotal - state.totalCost,
      budgetUsedPct: state.totalCost / this.budgetLimits.perGameTotal,
    };
  }

  /**
   * Calculate cost for a turn
   */
  _calculateTurnCost(promptTokens, completionTokens, prices) {
    const defaultPromptPrice = 0.15;
    const defaultCompletionPrice = 0.6; // $0.60 per 1M tokens
    const inputPricePer1K =
      (prices.promptPricePerMillion || defaultPromptPrice) / 1000;
    const completionPricePer1K =
      (prices.completionPricePerMillion || defaultCompletionPrice) / 1000;

    const promptCost = (promptTokens / 1000) * inputPricePer1K;
    const completionCost = (completionTokens / 1000) * completionPricePer1K;
    const totalCost = promptCost + completionCost;

    return {
      promptCost,
      completionCost,
      totalCost,
      tokens: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  /**
   * Check budget limits and trigger warnings/stops
   */
  _checkBudgetLimits(gameId, playerId, playerState, state) {
    // Check per-player-per-turn limit
    const turnCost = playerState.totalCost / playerState.totalTurns; // Avg cost per turn

    if (this._exceedsLimit(turnCost, this.budgetLimits.perPlayerPerTurn)) {
      playerState.stops++;
      this._recordBudgetEvent(
        gameId,
        playerId,
        "STOP",
        "per-player-per-turn",
        turnCost,
        this.budgetLimits.perPlayerPerTurn,
      );
    } else if (
      this._approachesLimit(turnCost, this.budgetLimits.perPlayerPerTurn)
    ) {
      playerState.warnings++;
      this._recordBudgetEvent(
        gameId,
        playerId,
        "WARNING",
        "per-player-per-turn",
        turnCost,
        this.budgetLimits.perPlayerPerTurn,
      );
    }

    // Check per-game limit
    if (this._exceedsLimit(state.totalCost, this.budgetLimits.perGameTotal)) {
      state.stopsTriggered++;
      this._recordBudgetEvent(
        gameId,
        playerId,
        "STOP",
        "per-game-total",
        state.totalCost,
        this.budgetLimits.perGameTotal,
      );
    } else if (
      this._approachesLimit(state.totalCost, this.budgetLimits.perGameTotal)
    ) {
      state.warningsTriggered++;
      this._recordBudgetEvent(
        gameId,
        playerId,
        "WARNING",
        "per-game-total",
        state.totalCost,
        this.budgetLimits.perGameTotal,
      );
    }
  }

  _exceedsLimit(current, limit) {
    return current >= limit;
  }

  _approachesLimit(current, limit) {
    return current >= limit * this.budgetLimits.warningThreshold;
  }

  _wasWarningTriggered(gameId, playerId) {
    const state = this.tracking.get(gameId);
    return state.warningsTriggered > 0;
  }

  _wasStopTriggered(gameId, playerId) {
    const state = this.tracking.get(gameId);
    return state.stopsTriggered > 0;
  }

  /**
   * Record budget event in database
   */
  _recordBudgetEvent(
    gameId,
    playerId,
    eventType,
    budgetScope,
    currentUsed,
    limit,
  ) {
    this.db.run(
      `INSERT INTO budget_events (
        gameId, playerId, eventType, budgetScope,
        currentUsed, limit, utilizationPct, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gameId,
        playerId,
        eventType, // e.g., 'WARNING', 'STOP'
        budgetScope, // e.g., 'per-player-per-turn', 'per-game-total'
        currentUsed,
        limit,
        currentUsed / limit,
        Date.now(),
      ],
    );
  }

  /**
   * Get cost report for a game
   */
  getCostReport(gameId) {
    if (!this.tracking.has(gameId)) {
      return null;
    }

    const state = this.tracking.get(gameId);

    return {
      gameId,
      totalCost: state.totalCost,
      totalTokens: state.totalTokens,
      budgetUsedPct: state.totalCost / this.budgetLimits.perGameTotal,
      budgetRemaining: this.budgetLimits.perGameTotal - state.totalCost,
      warningsTriggered: state.warningsTriggered,
      stopsTriggered: state.stopsTriggered,

      // Player breakdown
      players: Array.from(state.playerTracking.entries()).map(
        ([id, playerState]) => ({
          playerId: id,
          playerName: playerState.playerName,
          totalTurns: playerState.totalTurns,
          totalCost: playerState.totalCost,
          totalTokens: playerState.totalTokens,
          avgCostPerTurn: playerState.totalCost / playerState.totalTurns,
          warnings: playerState.warnings,
          stops: playerState.stops,
          costsByPhase: Array.from(playerState.costsByPhase.entries()).map(
            ([phase, phaseState]) => ({
              phase,
              turns: phaseState.turns,
              cost: phaseState.totalCost,
              tokens: phaseState.totalTokens,
              avgCostPerTurn: phaseState.totalCost / phaseState.turns,
            }),
          ),
        }),
      ),

      // Model breakdown
      models: Array.from(state.modelTracking.entries()).map(
        ([modelKey, modelState]) => {
          const [provider, model] = modelKey.split(":");
          return {
            provider,
            model,
            totalTurns: modelState.totalTurns,
            totalCost: modelState.totalCost,
            totalTokens: modelState.totalTokens,
            avgCostPerTurn: modelState.totalCost / modelState.totalTurns,
          };
        },
      ),

      // Phase breakdown
      phases: Array.from(state.phaseTracking.entries()).map(
        ([phase, phaseState]) => ({
          phase,
          totalCost: phaseState.totalCost,
          totalTokens: phaseState.totalTokens,
          turns: phaseState.totalTurns,
          avgCostPerTurn: phaseState.totalCost / phaseState.totalTurns,
        }),
      ),
    };
  }

  /**
   * Get cost trends for analysis
   */
  getCostTrends(options = {}) {
    const {
      gameId = null,
      playerId = null,
      model = null,
      limit = 100,
      sortBy = "timestamp",
      sortOrder = "DESC", // or 'ASC'
    } = options;

    let query = `SELECT * FROM budget_events`;
    const params = [];
    const conditions = [];

    if (gameId) {
      conditions.push("gameId = ?");
      params.push(gameId);
    }
    if (playerId) {
      conditions.push("playerId = ?");
      params.push(playerId);
    }
    if (model) {
      conditions.push("model = ?");
      params.push(model);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const sortDir = sortOrder === "DESC" ? "DESC" : "ASC";
    query += ` ORDER BY ${sortBy} ${sortDir} LIMIT ?`;
    params.push(limit);

    return this.db.all(query, params);
  }

  /**
   * Get summary for player prompt (budget status)
   */
  getPlayerBudgetSummary(gameId, playerId) {
    if (!this.db) {
      return "";
    }

    const budget = this.getPlayerBudget(gameId, playerId);

    return `
Budget Status for ${playerId}:
- Remaining: $${budget.remainingPerGame.toFixed(2)} / $${this.budgetLimits.perGameTotal}
- Used: $${budget.usedPerGame.toFixed(2)} (${((budget.usedPerGame / this.budgetLimits.perGameTotal) * 100).toFixed(1)}%)
- Warnings: ${budget.warnings}
- Stops: ${budget.stops}
    `.trim();
  }

  /**
   * Check if player can afford another action
   */
  canAffordAction(gameId, playerId, estimatedCost) {
    const state = this.tracking.get(gameId);
    if (!state) return true;

    // Check budget limits
    const perPlayerRemaining =
      this.budgetLimits.perPlayerPerTurn *
      state.playerTracking.get(playerId)?.totalTurns;
    const gameRemaining = this.budgetLimits.perGameTotal - state.totalCost;

    return (
      estimatedCost.totalCost <= perPlayerRemaining &&
      estimatedCost.totalCost <= gameRemaining
    );
  }

  /**
   * Update budget limits dynamically
   */
  updateBudgetLimits(newLimits) {
    Object.assign(this.budgetLimits, newLimits);
  }

  /**
   * Get remaining budget for a player
   */
  getPlayerBudget(gameId, playerId) {
    const state = this.tracking.get(gameId);
    if (!state || !state.playerTracking.has(playerId)) {
      return {
        remainingPerTurn: this.budgetLimits.perPlayerPerTurn,
        remainingPerGame: this.budgetLimits.perGameTotal,
        usedPerTurn: 0,
        usedPerGame: 0,
        warnings: 0,
        stops: 0,
      };
    }

    const playerState = state.playerTracking.get(playerId);

    return {
      remainingPerTurn: Math.max(
        0,
        this.budgetLimits.perPlayerPerTurn * playerState.totalTurns -
          playerState.totalCost,
      ),
      remainingPerGame: Math.max(
        0,
        this.budgetLimits.perGameTotal - state.totalCost,
      ),
      usedPerTurn: playerState.totalCost / playerState.totalTurns,
      usedPerGame: state.totalCost,
      warnings: playerState.warnings,
      stops: playerState.stops,
    };
  }
}

/**
 * Context Compression System
 *
 * Compresses chat history after each night
 * Maintains important events while reducing token usage
 */

class ContextCompressor {
  constructor() {
    this.compressionStrategies = [
      "remove_voting_redundancies",
      "summarize_repetitive_args",
      "trim_long_messages",
    ];
  }

  /**
   * Compress chat history for a player
   */
  compressHistory(gameState, player, options = {}) {
    const {
      maxChars = gameState.maxContextChars || 50000,
      priority = "evidence", // 'evidence', 'recent', 'all'
      removeVotingDuplicates = true,
      summarizeRepetitiveArgs = true,
      trimLongMessages = true,
    } = options;

    const chatHistory = gameState.chatHistory || [];

    // Step 1: Remove duplicate voting arguments
    if (removeVotingDuplicates) {
      this._removeVotingRedundancies(chatHistory);
    }

    // Step 2: Summarize repetitive arguments
    if (summarizeRepetitiveArgs) {
      this._summarizeRepetitiveArguments(chatHistory, player);
    }

    // Step 3: Trim long messages if needed
    if (trimLongMessages) {
      this._trimLongMessages(chatHistory, maxChars);
    }

    // Step 4: Limit based on priority
    return this._applyPriorityFilter(chatHistory, priority, maxChars);
  }

  /**
   * Remove duplicate voting arguments
   * When multiple players argue about same suspect, keep best representation
   */
  _removeVotingRedundancies(chatHistory) {
    const argumentGroups = new Map(); // Map<targetName, Array<message>>

    // Group messages by target
    for (const msg of chatHistory) {
      if (!msg.message) continue;

      // Check if message accuses someone
      const targetMatch = msg.message.match(
        /I think|I believe|(\w+(?:\s+[a-z]+){1,4})\s+is|I suspect|accuse|susp/i,
      );

      if (targetMatch) {
        const targetName = targetMatch[1];
        if (!argumentGroups.has(targetName)) {
          argumentGroups.set(targetName, []);
        }
        argumentGroups.get(targetName).push(msg);
      }
    }

    // For each target, keep best 2 arguments
    for (const [targetName, messages] of argumentGroups.entries()) {
      // Sort by confidence (longer, more detailed = higher confidence)
      messages.sort((a, b) => {
        const aLength = a.message.length;
        const bLength = b.message.length;
        return bLength - aLength; // Longer = more detail = keep
      });

      // Keep top 2, remove rest
      const keep = messages.slice(0, 2);
      const otherTargets = argumentGroups.get(targetName).slice(2);

      // Mark others for removal
      otherTargets.forEach((msg) => {
        msg._remove = true;
      });
    }

    // Filter out marked messages
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i]._remove) {
        chatHistory.splice(i, 1);
      }
    }
  }

  /**
   * Summarize repetitive arguments
   */
  _summarizeRepetitiveArguments(chatHistory, player) {
    // Count arguments per player
    const argumentCounts = new Map(); // Map<player, argumentCount>

    for (const msg of chatHistory) {
      if (!msg.player) continue;

      if (!argumentCounts.has(msg.player)) {
        argumentCounts.set(msg.player, 0);
      }
      argumentCounts.set(msg.player, argumentCounts.get(msg.player) + 1);
    }

    // Identify players making too many arguments (>5)
    for (const [player, count] of argumentCounts) {
      if (count > 5) {
        // Find their recent arguments and summarize
        const args = chatHistory.filter((m) => m.player === player);
        const summaryMsg = {
          player: player,
          message: `${player} argues repeatedly (made ${count} arguments in this round).`,
        };

        // Remove redundant arguments, add summary
        for (let i = args.length - 1; i >= 0; i--) {
          if (!args[i]._summarized) break; // Don't remove our summaries
          chatHistory.splice(chatHistory.indexOf(args[i]), 1);
        }

        // Add summary
        chatHistory.push(summaryMsg);
      }
    }
  }

  /**
   * Trim long messages
   */
  _trimLongMessages(chatHistory, maxChars) {
    for (const msg of chatHistory) {
      if (!msg.message || msg.message.length <= maxChars) continue;

      // Truncate message and add note
      const truncated =
        msg.message.substring(0, maxChars) ||
        msg.message.substring(0, maxChars);

      msg.message = truncated + "... [TRIMMED]";
    }
  }

  /**
   * Apply priority filter (keeps important events)
   */
  _applyPriorityFilter(chatHistory, priority, maxChars) {
    let filtered = [...chatHistory];

    // Keep evidence-rich messages
    if (priority === "evidence") {
      filtered = filtered.filter(
        (m) =>
          m.message &&
          (m.message.toLowerCase().includes("i think") ||
            m.message.toLowerCase().includes("evidence") ||
            m.message.toLowerCase().includes("suspicious") ||
            m.message.toLowerCase().includes("voted")),
      );
    }

    // Keep recent messages
    if (priority === "recent") {
      const totalSize = JSON.stringify(filtered).length;
      if (totalSize > maxChars) {
        // Trim from middle, keep start and end
        const start = this._trimToLength(filtered, Math.floor(maxChars * 0.4));
        const end = this._trimToLength(
          filtered.slice().reverse(),
          Math.floor(maxChars * 0.4),
        ).reverse();

        filtered = [...start, ...end];
      }
    }

    // 'all' priority - keep everything, just enforce char limit
    if (priority === "all") {
      return this._trimToLength(filtered, maxChars);
    }

    return filtered;
  }

  /**
   * Trim ChatHistory to specific character count
   */
  _trimToLength(chatHistory, maxChars) {
    let totalSize = JSON.stringify(chatHistory).length;

    if (totalSize <= maxChars) {
      return chatHistory;
    }

    // Try to remove messages until we fit (from middle, preserving start and end)
    // This is heuristic - want to keep recent and first parts
    const keepStart = Math.floor(chatHistory.length * 0.4);
    return chatHistory.slice(0, keepStart);
  }
}

/**
 * Event Replay System
 *
 * Enables replay of games from database
 * Capture all game events for replay
 */

const EVENT_RECORD_BUFFER_SIZE = 10000; // Circular buffer for recent events

class EventReplay {
  constructor(db) {
    this.db = db;
    this.buffer = []; // In-memory buffer for recent events
  }

  /**
   * Capture game event for replay
   */
  captureEvent(event, gameState) {
    // Add to buffer
    this.buffer.push({
      ...event,
      gameStateSnapshot: gameState
        ? this._captureGameStateSnapshot(gameState)
        : null,
      timestamp: Date.now(),
    });

    // Keep buffer bounded
    if (this.buffer.length > EVENT_RECORD_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-EVENT_RECORD_BUFFER_SIZE);
    }

    // Save to database
    if (this.db) {
      this.db.run(
        `INSERT INTO game_events_replay (
          gameId, round, phase, playerId, type, visibility,
          content, gameStateSnapshot, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.gameId,
          event.round,
          event.phase,
          event.playerId || null,
          event.type,
          event.visibility,
          JSON.stringify(event.content),
          JSON.stringify(
            gameState ? this._captureGameStateSnapshot(gameState) : null,
          ),
          event.timestamp,
        ],
      );
    }
  }

  /**
   * Replay game from event log
   */
  async replayGame(gameId) {
    if (!this.db) {
      throw new Error("Database not available for replay");
    }

    // Load all events for game
    const events = await this.db.all(
      "SELECT * FROM game_events_replay WHERE gameId = ? ORDER BY timestamp",
      [gameId],
    );

    console.log(`Loaded ${events.length} events for replay`);

    // Reconstruct game state step by step
    for (const event of events) {
      console.log(
        `Replaying: Round ${event.round}, Phase ${event.phase}, Type ${event.type}`,
      );

      // Extract game state snapshot
      if (event.gameStateSnapshot) {
        const snapshot = JSON.parse(event.gameStateSnapshot);
        console.log(`  State: ${JSON.stringify(snapshot, null, 2)}`);
      }
    }
  }

  /**
   * Restore game to specific event point
   */
  async restoreToEvent(gameId, eventId) {
    if (!this.db) {
      throw new Error("Database not available for restore");
    }

    const event = await this.db.get(
      "SELECT * FROM game_events_replay WHERE gameId = ? AND id = ?",
      [gameId, eventId],
    );

    if (!event) {
      throw new Error(`Event ${eventId} not found in game ${gameId}`);
    }

    // Parse snapshot
    const snapshot = event.gameStateSnapshot
      ? JSON.parse(event.gameStateSnapshot)
      : null;

    return {
      event,
      snapshot,
    };
  }

  /**
   * Compare alternate outcomes from same starting point
   */
  compareOutcomes(gameId, snapshotId, variantActions) {
    // Branch from snapshot and play with different actions
    return {};
  }

  /**
   * Capture minimal game state snapshot
   */
  _captureGameStateSnapshot(gameState) {
    return {
      round: gameState.round,
      phase: gameState.phase,
      alivePlayers: gameState.alivePlayers?.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        isAlive: p.isAlive,
      })),
      deadPlayers: gameState.deadPlayers?.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
      })),
      killTarget: gameState.killTarget
        ? { id: gameState.killTarget.id, name: gameState.killTarget.name }
        : null,
      protectedPlayer: gameState.protectedPlayer
        ? {
            id: gameState.protectedPlayer.id,
            name: gameState.protectedPlayer.name,
          }
        : null,
      investigationResult: gameState.investigationResult || null,
    };
  }
}

/**
 * Database Schema for Cost Tracking, Context Compression, Event Replay
 */
async function initializeSupportingSchema(db) {
  try {
    // Budget Events table
    db.run(`
      CREATE TABLE IF NOT EXISTS budget_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        eventType TEXT NOT NULL CHECK (eventType IN ('WARNING', 'STOP', 'INFO', 'DEBUG')),
        budgetScope TEXT NOT NULL CHECK (budgetScope IN ('per-player-per-turn', 'per-game-total', 'per-model-per-turn', 'per-model-total')),
        currentUsed REAL NOT NULL,
        "limit" REAL NOT NULL,
        utilizationPct REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    // Game Events Replay table
    db.run(`
      CREATE TABLE IF NOT EXISTS game_events_replay (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL,
        round INTEGER NOT NULL,
        phase TEXT NOT NULL,
        playerId TEXT,
        type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        content TEXT NOT NULL,
        gameStateSnapshot TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (gameId) REFERENCES game_sessions(id)
      );
    `);

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_budget_events_game ON budget_events(gameId)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_budget_events_player ON budget_events(playerId)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_budget_events_timestamp ON budget_events(timestamp)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_replay_game ON game_events_replay(gameId)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_replay_timestamp ON game_events_replay(timestamp)`,
    );

    console.log("✅ Supporting schema initialized");
  } catch (error) {
    console.error("[SUPPORT] Failed to initialize schema:", error.message);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  CostTracker,
  ContextCompressor,
  EventReplay,
  initializeSupportingSchema,
};
