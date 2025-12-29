// ============================================
// STATISTICS & SCORING SYSTEM
// Mafia AI Benchmark
// ============================================

const { openDatabase, createGameEvent } = require("./modules/database");

/**
 * Token Metrics Tracking
 *
 * Tracks token usage per player per turn/phase
 */
class TokenTracker {
  constructor(db) {
    this.db = db;
    // In-memory cache for fast queries
    this.metrics = new Map();
  }

  /**
   * Track a single turn's token usage
   */
  trackTurn(gameId, playerId, turn) {
    const key = `${gameId}:${playerId}`;
    let metric = this.metrics.get(key);

    const now = Date.now();
    const turnMetrics = {
      turnId: this._generateId(),
      phase: turn.phase || "unknown",
      promptTokens: turn.promptTokens || 0,
      completionTokens: turn.completionTokens || 0,
      totalTokens: (turn.promptTokens || 0) + (turn.completionTokens || 0),
      timestamp: now,
      actionType: turn.actionType || "unknown",
    };

    if (!metric) {
      // Create temporary object for cost calculation
      const tempMetric = {
        totalPromptTokens: turnMetrics.promptTokens,
        totalCompletionTokens: turnMetrics.completionTokens,
        totalTokens: turnMetrics.totalTokens,
        avgTokensPerTurn: turnMetrics.totalTokens,
        maxTokensInTurn: turnMetrics.totalTokens,
        minTokensInTurn: turnMetrics.totalTokens,
      };

      metric = {
        gameId,
        playerId,
        model: turn.model || "unknown",
        provider: turn.provider || "unknown",
        turns: [turnMetrics],
        totalPromptTokens: turnMetrics.promptTokens,
        totalCompletionTokens: turnMetrics.completionTokens,
        totalTokens: turnMetrics.totalTokens,
        avgTokensPerTurn: turnMetrics.totalTokens,
        maxTokensInTurn: turnMetrics.totalTokens,
        minTokensInTurn: turnMetrics.totalTokens,
        estimatedCost: this._estimateCost(tempMetric, turn.prices || {}),
      };
      this.metrics.set(key, metric);
    } else {
      metric.turns.push(turnMetrics);
      metric.totalPromptTokens += turnMetrics.promptTokens;
      metric.totalCompletionTokens += turnMetrics.completionTokens;
      metric.totalTokens += turnMetrics.totalTokens;
      metric.avgTokensPerTurn = metric.totalTokens / metric.turns.length;
      metric.maxTokensInTurn = Math.max(
        metric.maxTokensInTurn,
        turnMetrics.totalTokens,
      );
      metric.minTokensInTurn = Math.min(
        metric.minTokensInTurn,
        turnMetrics.totalTokens,
      );
      metric.estimatedCost = this._estimateCost(metric, turn.prices || {});
    }

    // Persist to database
    this._persistTurnMetric(gameId, playerId, turnMetrics);

    return metric;
  }

  /**
   * Get metrics for a specific player in a game
   */
  getMetrics(gameId, playerId) {
    return this.metrics.get(`${gameId}:${playerId}`) || null;
  }

  /**
   * Get all metrics for a game
   */
  async getGameMetrics(gameId) {
    // Check cache first
    const cached = Array.from(this.metrics.values()).filter(
      (m) => m.gameId === gameId,
    );
    if (cached.length > 0) {
      return cached;
    }

    // Query from database if not in cache
    const dbMetrics = await this.db.get(
      "SELECT * FROM token_metrics WHERE gameId = ?",
      [gameId],
    );

    return dbMetrics || [];
  }

  /**
   * Get aggregated statistics across multiple games
   */
  async getAggregatedStats(
    filters = { model: null, provider: null, role: null },
  ) {
    let query =
      "SELECT model, provider, SUM(totalTokens) as totalTokens, AVG(avgTokensPerTurn) as avgTokensPerTurn FROM token_metrics";
    const params = [];
    const conditions = [];

    if (filters.model) {
      conditions.push("model = ?");
      params.push(filters.model);
    }
    if (filters.provider) {
      conditions.push("provider = ?");
      params.push(filters.provider);
    }
    if (filters.role) {
      query = `
        SELECT tm.model, tm.provider, SUM(tm.totalTokens) as totalTokens,
               AVG(tm.avgTokensPerTurn) as avgTokensPerTurn,
               p.role
        FROM token_metrics tm
        JOIN players p ON tm.gameId = p.gameId AND tm.playerId = p.id
      `;
      conditions.push("p.role = ?");
      params.push(filters.role);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " GROUP BY model, provider" + (filters.role ? ", p.role" : "");

    const results = await this.db.all(query, params);
    return results || [];
  }

  /**
   * Estimate cost from token metrics
   */
  _estimateCost(metric, prices) {
    // Default prices if not provided (OpenRouter-style pricing per 1M tokens)
    const defaultPromptPrice = 0.15; // $0.15 per 1M tokens
    const defaultCompletionPrice = 0.6; // $0.60 per 1M tokens

    const promptPricePer1K =
      (prices.promptPricePerMillion || defaultPromptPrice) / 1000;
    const completionPricePer1K =
      (prices.completionPricePerMillion || defaultCompletionPrice) / 1000;

    const promptCost = (metric.totalPromptTokens / 1000) * promptPricePer1K;
    const completionCost =
      (metric.totalCompletionTokens / 1000) * completionPricePer1K;

    return {
      currency: "USD",
      promptCost: Math.round(promptCost * 10000) / 10000, // Round to 4 decimals
      completionCost: Math.round(completionCost * 10000) / 10000,
      totalCost: Math.round((promptCost + completionCost) * 10000) / 10000,
    };
  }

  /**
   * Persist turn metrics to database
   */
  _persistTurnMetric(gameId, playerId, turnMetrics) {
    this.db.run(
      `INSERT INTO token_metrics (
        gameId, playerId, model, provider,
        promptTokens, completionTokens, totalTokens, avgTokensPerTurn,
        maxTokensInTurn, minTokensInTurn,
        estimatedPromptCost, estimatedCompletionCost, estimatedTotalCost,
        phase, actionType, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gameId,
        playerId,
        "unknown", // Will be updated when we know the model
        "unknown",
        turnMetrics.promptTokens,
        turnMetrics.completionTokens,
        turnMetrics.totalTokens,
        turnMetrics.totalTokens, // avg = total for single turn
        turnMetrics.totalTokens,
        turnMetrics.totalTokens,
        0,
        0,
        0, // Costs will be calculated in batch
        turnMetrics.phase,
        turnMetrics.actionType,
        turnMetrics.timestamp,
      ],
    );
  }

  _generateId() {
    return "tkt_" + Math.random().toString(36).substr(2, 9);
  }
}

/**
 * API Call Metrics Tracking
 *
 * Tracks API latency, success rates, data transfer
 */
class APITracker {
  constructor(db) {
    this.db = db;
    this.metrics = new Map();
  }

  /**
   * Track a single API call
   */
  trackCall(gameId, playerId, call) {
    const key = `${gameId}:${playerId}`;
    let metric = this.metrics.get(key);

    const callRecord = {
      callId: this._generateId(),
      timestamp: Date.now(),
      endpoint: call.endpoint,
      duration: call.duration || 0,
      statusCode: call.statusCode || 0,
      success: call.success !== false,
      retryCount: call.retryCount || 0,
      payloadSize: call.payloadSize || 0,
      responseSize: call.responseSize || 0,
    };

    if (!metric) {
      metric = {
        gameId,
        playerId,
        provider: call.provider || "unknown",
        model: call.model || "unknown",
        calls: [callRecord],
        aggregate: this._initializeAggregate(),
      };
      this.metrics.set(key, metric);
    } else {
      metric.calls.push(callRecord);
      metric.aggregate = this._updateAggregate(metric.calls);
      metric.provider = call.provider || metric.provider;
      metric.model = call.model || metric.model;
    }

    // Persist to database
    this._persistCallMetric(gameId, playerId, callRecord);

    return metric;
  }

  /**
   * Get API stats for a specific provider
   */
  getProviderStats(provider) {
    const providerMetrics = Array.from(this.metrics.values()).filter(
      (m) => m.provider === provider,
    );

    if (providerMetrics.length === 0) {
      return null;
    }

    const allCalls = providerMetrics.flatMap((m) => m.calls);

    return {
      provider,
      totalGames: providerMetrics.length,
      totalCalls: allCalls.length,
      successRate:
        (allCalls.filter((c) => c.success).length / allCalls.length) * 100,
      avgLatency:
        allCalls.reduce((a, b) => a + b.duration, 0) / allCalls.length,
      totalDataTransfer: allCalls.reduce(
        (a, b) => a + b.payloadSize + b.responseSize,
        0,
      ),
      failedCalls: allCalls.filter((c) => !c.success).length,
    };
  }

  /**
   * Get all provider stats
   */
  getAllProviderStats() {
    const providers = new Set(
      Array.from(this.metrics.values()).map((m) => m.provider),
    );

    return Array.from(providers)
      .map((provider) => this.getProviderStats(provider))
      .filter(Boolean);
  }

  _initializeAggregate() {
    return {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      avgDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      totalPayloadSize: 0,
      totalResponseSize: 0,
      totalDataTransfer: 0,
      avgLatency: 0,
    };
  }

  _updateAggregate(calls) {
    if (calls.length === 0) return this._initializeAggregate();

    const total = calls.reduce(
      (acc, call) => ({
        totalCalls: 1,
        successfulCalls: call.success ? 1 : 0,
        failedCalls: call.success ? 0 : 1,
        avgDuration: call.duration,
        minDuration: Math.min(Infinity, call.duration),
        maxDuration: Math.max(0, call.duration),
        totalPayloadSize: call.payloadSize,
        totalResponseSize: call.responseSize,
        totalDataTransfer: call.payloadSize + call.responseSize,
        avgLatency: call.duration,
      }),
      this._initializeAggregate(),
    );

    const aggregate = {
      totalCalls: calls.length,
      successfulCalls: calls.filter((c) => c.success).length,
      failedCalls: calls.filter((c) => !c.success).length,
      avgDuration: calls.reduce((a, b) => a + b.duration, 0) / calls.length,
      minDuration: Math.min(...calls.map((c) => c.duration)),
      maxDuration: Math.max(...calls.map((c) => c.duration)),
      totalPayloadSize: calls.reduce((a, b) => a + b.payloadSize, 0),
      totalResponseSize: calls.reduce((a, b) => a + b.responseSize, 0),
      totalDataTransfer: calls.reduce(
        (a, b) => a + b.payloadSize + b.responseSize,
        0,
      ),
      avgLatency: calls.reduce((a, b) => a + b.duration, 0) / calls.length,
    };

    return aggregate;
  }

  _persistCallMetric(gameId, playerId, callRecord) {
    this.db.run(
      `INSERT INTO api_metrics (
        gameId, playerId, provider, model,
        endpoint, duration, statusCode, success, retryCount,
        payloadSize, responseSize, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gameId,
        playerId,
        "unknown",
        "unknown",
        callRecord.endpoint,
        callRecord.duration,
        callRecord.statusCode,
        callRecord.success ? 1 : 0,
        callRecord.retryCount,
        callRecord.payloadSize,
        callRecord.responseSize,
        callRecord.timestamp,
      ],
    );
  }

  _generateId() {
    return "api_" + Math.random().toString(36).substr(2, 9);
  }
}

/**
 * Real-Time Dashboard Data Generator
 */
class RealtimeDashboard {
  constructor(tokenTracker, apiTracker) {
    this.tokenTracker = tokenTracker;
    this.apiTracker = apiTracker;
    this.history = [];
  }

  /**
   * Generate dashboard data for a game
   */
  async generate(gameId, gameState = {}) {
    const gameTokens = await this.tokenTracker.getGameMetrics(gameId);
    const now = Date.now();

    // Calculate token stats
    const totalTokens = gameTokens.reduce((sum, t) => sum + t.totalTokens, 0);

    // Get API stats for last 5 seconds
    const recentCalls = (await this.apiTracker.metrics.values())
      .flatMap((m) => m.calls)
      .filter((c) => c.timestamp > now - 5000);

    const avgLatency =
      recentCalls.length > 0
        ? recentCalls.reduce((a, b) => a + b.duration, 0) / recentCalls.length
        : 0;

    const errorRate =
      recentCalls.length > 0
        ? (recentCalls.filter((c) => !c.success).length / recentCalls.length) *
          100
        : 0;

    const providerStats = this.apiTracker.getAllProviderStats();

    const dashboard = {
      gameId,
      lastUpdated: now,
      live: {
        activePlayers: gameState.alivePlayers?.length || 0,
        phase: gameState.phase || "unknown",
        dayNumber: gameState.dayNumber || 0,
        tokenUsage: {
          currentTurn:
            gameTokens.length > 0
              ? gameTokens[gameTokens.length - 1]?.totalTokens || 0
              : 0,
          totalTokens,
          tokensPerSecond: 0, // Would need a time window for this
          estimatedCost: this._estimateTotalCost(gameTokens),
        },
        apiStatus: {
          activeCalls: recentCalls.length,
          avgLatency,
          errorRate,
          providers: providerStats.map((p) => ({
            name: p.provider,
            calls: p.totalCalls,
            avgLatency: Math.round(p.avgLatency),
            errors: p.failedCalls,
          })),
        },
        dataTransfer: {
          uploaded: recentCalls.reduce((a, b) => a + b.payloadSize, 0),
          downloaded: recentCalls.reduce((a, b) => a + b.responseSize, 0),
          rate: 0, // bytes per second
        },
      },
      history: this.history.slice(-100), // Last 100 data points
    };

    // Add to history
    this.history.push({
      timestamp: now,
      tokens: totalTokens,
      cost: dashboard.live.tokenUsage.estimatedCost,
      latency: avgLatency,
      activeCalls: recentCalls.length,
    });

    return dashboard;
  }

  _estimateTotalCost(gameTokens) {
    return gameTokens.reduce((sum, t) => {
      return sum + (t.estimatedCost?.totalCost || 0);
    }, 0);
  }

  clearHistory() {
    this.history = [];
  }
}

/**
 * Database Schema for Statistics
 */
async function initializeStatisticsSchema(db) {
  try {
    // Token Metrics Table
    db.run(`
      CREATE TABLE IF NOT EXISTS token_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        promptTokens INTEGER NOT NULL DEFAULT 0,
        completionTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        avgTokensPerTurn REAL NOT NULL DEFAULT 0,
        maxTokensInTurn INTEGER NOT NULL DEFAULT 0,
        minTokensInTurn INTEGER NOT NULL DEFAULT 0,
        estimatedPromptCost REAL NOT NULL DEFAULT 0,
        estimatedCompletionCost REAL NOT NULL DEFAULT 0,
        estimatedTotalCost REAL NOT NULL DEFAULT 0,
        phase TEXT,
        actionType TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (gameId) REFERENCES game_sessions(id),
        FOREIGN KEY (playerId) REFERENCES players(id)
      )
    `);

    // API Metrics Table
    db.run(`
      CREATE TABLE IF NOT EXISTS api_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        endpoint TEXT NOT NULL,
        duration INTEGER NOT NULL DEFAULT 0,
        statusCode INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 0,
        retryCount INTEGER NOT NULL DEFAULT 0,
        payloadSize INTEGER NOT NULL DEFAULT 0,
        responseSize INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (gameId) REFERENCES game_sessions(id),
        FOREIGN KEY (playerId) REFERENCES players(id)
      )
    `);

    // Per-Game Stats Table (aggregated)
    db.run(`
      CREATE TABLE IF NOT EXISTS game_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL UNIQUE,
        seed INTEGER,
        winner TEXT NOT NULL,
        totalRounds INTEGER NOT NULL,
        totalTimeMs INTEGER NOT NULL,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        totalCost REAL NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (gameId) REFERENCES game_sessions(id)
      )
    `);

    // Per-Player Stats Table (aggregated per game)
    db.run(`
      CREATE TABLE IF NOT EXISTS player_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        player TEXT NOT NULL,
        role TEXT NOT NULL,
        team TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        alive INTEGER NOT NULL DEFAULT 0,
        won INTEGER NOT NULL DEFAULT 0,
        totalTurns INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        totalCost REAL NOT NULL DEFAULT 0,
        avgTokensPerTurn REAL NOT NULL DEFAULT 0,
        deathRound INTEGER,
        deathCause TEXT,
        FOREIGN KEY (gameId) REFERENCES game_sessions(id),
        UNIQUE(gameId, playerId)
      )
    `);

    // Per-Model Win Rates
    db.run(`
      CREATE TABLE IF NOT EXISTS model_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL UNIQUE,
        totalGames INTEGER NOT NULL DEFAULT 0,
        mafiaWins INTEGER NOT NULL DEFAULT 0,
        townWins INTEGER NOT NULL DEFAULT 0,
        winRateAsMafia REAL NOT NULL DEFAULT 0,
        winRateAsTown REAL NOT NULL DEFAULT 0,
        overallWinRate REAL NOT NULL DEFAULT 0,
        avgRoundsToWin REAL,
        lastUpdated INTEGER NOT NULL
      )
    `);

    // Create indexes
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_token_metrics_game ON token_metrics(gameId)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_token_metrics_player ON token_metrics(playerId)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_api_metrics_game ON api_metrics(gameId)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_game_stats_game ON game_stats(gameId)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_player_stats_game ON player_stats(gameId)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_player_stats_model ON player_stats(model)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_model_performance_model ON model_performance(model, provider)`,
    );

    console.log("✅ Statistics database schema initialized");
  } catch (error) {
    console.error(
      "[STATS] Failed to initialize database schema:",
      error.message,
    );
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  TokenTracker,
  APITracker,
  RealtimeDashboard,
  initializeStatisticsSchema,
};
