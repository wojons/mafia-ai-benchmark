#!/usr/bin/env node
/**
 * Legacy Usage Collector
 *
 * Collects real per-model usage aggregates from the legacy engine's
 * in-memory trackers (MAF-GAP-012, latency added in MAF-GAP-018).
 *
 * Extracted from legacy-bridge.js so the collection logic can be unit
 * tested without spawning the engine as a child process.
 *
 * The engine's CostTracker keeps per-model state (provider/model/turns/
 * cost/tokens) keyed by `${provider}:${model}`; the TokenTracker keeps
 * per-player metrics keyed by `${gameId}:${playerId}`; the APITracker
 * keeps per-player call records with real per-call durations. All are
 * populated from actual OpenRouter/API responses during play. When the
 * trackers are unavailable (no DB, disabled), fall back to the role-model
 * config from the environment so the server still records which models
 * played (with zero usage — honest, never invented).
 *
 * Returns an array of per-model aggregates:
 *   [{ provider, model, promptTokens, completionTokens, totalTokens,
 *      cost, apiCalls, latencyMs }]
 * where latencyMs is the model's average per-call latency in milliseconds
 * measured at the engine's real LLM call site (0 when unmeasured).
 */

/**
 * Aggregate per-model latency from the engine's APITracker. The tracker
 * records every real HTTP call's duration keyed by game+player with the
 * provider/model of the model that served the call. Returns a Map of
 * `${provider}:${model}` -> { totalMs, calls }.
 *
 * Latency is only ever merged onto usage rows that already exist (from
 * the cost/token trackers); it never creates rows for models that did
 * not play, so failed-call bookkeeping keys cannot fabricate usage.
 */
function collectLatencyByModel(game) {
  const latency = new Map();
  const tracker = game && game.apiTracker;
  if (!tracker || !(tracker.metrics instanceof Map)) return latency;

  for (const metric of tracker.metrics.values()) {
    if (!metric || metric.gameId !== game.gameId) continue;
    const provider = metric.provider || 'unknown';
    const model = metric.model || 'unknown';
    const key = `${provider}:${model}`;
    let entry = latency.get(key);
    if (!entry) {
      entry = { totalMs: 0, calls: 0 };
      latency.set(key, entry);
    }
    for (const call of metric.calls || []) {
      entry.totalMs += call.duration || 0;
      entry.calls += 1;
    }
  }
  return latency;
}

/**
 * Read the game's persisted per-role model assignments
 * (player_model_assignments) from the server DB
 * (DF-MAFIA-AI-BENCHMARK-2).
 *
 * The rows are written by LegacyGameAdapter.startGame under the ADAPTER's
 * game id (passed here via gameIdOverride through the bridge's --game-id
 * arg), NOT the engine's internal game id. The DB path resolves exactly
 * like the server's (process.env.DB_PATH || ./data/mafia.db relative to
 * the bridge cwd).
 *
 * Best-effort and read-only: any failure (module missing, file absent,
 * query error) returns [] so the caller falls through to the DEFAULT_MODEL
 * fallback. Never creates or writes the DB file.
 */
function readPersistedAssignments(game, gameIdOverride) {
  const gameId = gameIdOverride || (game && game.gameId);
  if (!gameId) return [];
  let db = null;
  try {
    // Lazy require so the module still loads where better-sqlite3 is not
    // resolvable (the fallback only needs it when the trackers are absent).
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    const path = require('path');
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'mafia.db');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        'SELECT role, provider, model FROM player_model_assignments WHERE game_id = ?'
      )
      .all(gameId);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  } finally {
    if (db) {
      try {
        db.close();
      } catch (e) {
        // Best-effort close; nothing to do.
      }
    }
  }
}

async function collectUsage(game, gameIdOverride) {
  const usage = [];

  // 1. CostTracker per-model state (authoritative totals when present).
  //    The engine's CostTracker aggregates the same underlying API
  //    responses the TokenTracker sees, so its per-model rows are the
  //    source of truth for totalTokens/cost/apiCalls.
  if (game.costTracker && typeof game.costTracker.getCostReport === 'function') {
    try {
      const report = game.costTracker.getCostReport(game.gameId);
      if (report && Array.isArray(report.models)) {
        for (const m of report.models) {
          usage.push({
            provider: m.provider,
            model: m.model,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: m.totalTokens || 0,
            cost: m.totalCost || 0,
            apiCalls: m.totalTurns || 0,
            latencyMs: 0,
            // Internal marker: totals already authoritative; the token
            // tracker step must not re-add them (double-count guard).
            _costTracked: true,
          });
        }
      }
    } catch (e) {
      // Fall through to token-tracker aggregation below.
    }
  }

  // 2. TokenTracker per-player metrics. When the CostTracker was present,
  //    use these ONLY to fill the prompt/completion split (the totals are
  //    the same data — adding them would double-count). When the CostTracker
  //    was absent, aggregate the metrics into per-model rows directly.
  if (game.tokenTracker && typeof game.tokenTracker.getGameMetrics === 'function') {
    try {
      const metrics = await game.tokenTracker.getGameMetrics(game.gameId);
      if (Array.isArray(metrics)) {
        const byModel = new Map();
        for (const m of usage) byModel.set(`${m.provider}:${m.model}`, m);
        for (const metric of metrics) {
          const key = `${metric.provider || 'unknown'}:${metric.model || 'unknown'}`;
          let row = byModel.get(key);
          if (!row) {
            row = {
              provider: metric.provider || 'unknown',
              model: metric.model || 'unknown',
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cost: 0,
              apiCalls: 0,
              latencyMs: 0,
            };
            byModel.set(key, row);
            usage.push(row);
          }
          row.promptTokens += metric.totalPromptTokens || 0;
          row.completionTokens += metric.totalCompletionTokens || 0;
          if (row._costTracked) {
            // Totals already came from the CostTracker — the metrics below
            // are the same underlying responses, so only fill gaps.
            if (row.totalTokens === 0) row.totalTokens += metric.totalTokens || 0;
            if (row.cost === 0 && metric.estimatedCost && metric.estimatedCost.totalCost) {
              row.cost += metric.estimatedCost.totalCost;
            }
            if (row.apiCalls === 0) row.apiCalls += (metric.turns && metric.turns.length) || 0;
          } else {
            // Token tracker is the only source: accumulate across every
            // player metric for this model.
            row.totalTokens += metric.totalTokens || 0;
            if (metric.estimatedCost && metric.estimatedCost.totalCost) {
              row.cost += metric.estimatedCost.totalCost;
            }
            row.apiCalls += (metric.turns && metric.turns.length) || 0;
          }
        }
      }
    } catch (e) {
      // Fall through to config-derived rows below.
    }
  }

  // 3. Config-derived fallback: the models the game actually ran, with
  //    zero usage (the engine did not track numbers for them). These come
  //    from the game's persisted player_model_assignments rows
  //    (DF-MAFIA-AI-BENCHMARK-2) — the SAME rows LegacyGameAdapter wrote
  //    at startGame from config.roleModels — NOT from this server's
  //    process.env *_MODEL vars, which may be stale host leftovers that
  //    never reached the child (the adapter sanitizes the child env).
  //    Reading the rows keeps the fallback honest: it mirrors what the
  //    child actually resolved, and the adapter's game id (gameIdOverride,
  //    passed through the bridge's --game-id arg) is the key those rows
  //    were written under.
  if (usage.length === 0) {
    const rows = readPersistedAssignments(game, gameIdOverride);
    const seen = new Set();
    for (const row of rows) {
      if (!row || !row.model || seen.has(row.model)) continue;
      seen.add(row.model);
      // MAF-GAP-057: keep the FULL spec as the model string and derive the
      // provider from the spec's first segment, so these rows match the
      // tracker-reported spelling ("openai/gpt-4o") instead of fragmenting
      // into a second key ("gpt-4o"). The stored provider column is used
      // when present (same derivation, written by the adapter).
      const slashIdx = row.model.indexOf('/');
      const provider = row.provider || (slashIdx === -1 ? row.model : row.model.slice(0, slashIdx));
      usage.push({
        provider: provider || 'openai',
        model: row.model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        apiCalls: 0,
        latencyMs: 0,
      });
    }
    // No assignment rows: the whole game ran on the engine default
    // (DEFAULT_MODEL || openai/gpt-4o-mini, game-engine.js ~752-794).
    // Fall back to that default ONCE — never to arbitrary host *_MODEL
    // vars, which would re-introduce exactly the contamination this
    // collector is meant to be immune to.
    if (usage.length === 0) {
      const model = process.env.DEFAULT_MODEL || 'openai/gpt-4o-mini';
      const slashIdx = model.indexOf('/');
      const provider = slashIdx === -1 ? model : model.slice(0, slashIdx);
      usage.push({
        provider: provider || 'openai',
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        apiCalls: 0,
        latencyMs: 0,
      });
    }
  }

  // 4. Real per-model latency (MAF-GAP-018): average per-call duration
  //    from the APITracker, merged onto the rows above. Never creates
  //    new rows — a model with latency data but no token usage did not
  //    measurably play and must not appear.
  const latencyByModel = collectLatencyByModel(game);
  for (const row of usage) {
    const entry = latencyByModel.get(`${row.provider}:${row.model}`);
    if (entry && entry.calls > 0) {
      row.latencyMs = Math.round(entry.totalMs / entry.calls);
    }
    delete row._costTracked; // internal marker, never emitted
  }

  return usage;
}

/**
 * Collect real per-player usage aggregates from the engine's trackers
 * (MAF-GAP-029). Where collectUsage() collapses the per-player dimension
 * into per-model rows, this keeps it: one row per engine player id (the
 * same ids that surface as event actor_id and players[].id in the API).
 *
 * Sources (both populated from actual API responses during play):
 *   - TokenTracker.getGameMetrics(gameId): per-player metrics carrying
 *     playerId/model/provider/totalPromptTokens/totalCompletionTokens/
 *     totalTokens/turns/estimatedCost.
 *   - APITracker.metrics: per-player call records with real per-call
 *     durations; supplies apiCalls when the token tracker recorded none
 *     and the average per-call latency (same convention as
 *     collectLatencyByModel — the api tracker never overrides token
 *     counts, only fills gaps).
 *
 * Honesty contract: nothing is invented. Players with no recorded data
 * simply do not appear; every number comes from a tracker record.
 *
 * Returns:
 *   [{ playerId, playerName (best-effort, may be undefined), provider,
 *      model, promptTokens, completionTokens, totalTokens, cost,
 *      apiCalls, latencyMs }]
 */
async function collectUsageByPlayer(game) {
  const rows = new Map(); // playerId -> aggregate row

  // Player names are best-effort display data from the engine roster.
  const nameByPlayerId = new Map();
  if (game && Array.isArray(game.players)) {
    for (const p of game.players) {
      if (p && p.id) nameByPlayerId.set(p.id, p.name);
    }
  }

  // 1. TokenTracker per-player metrics — authoritative token/cost totals.
  if (game.tokenTracker && typeof game.tokenTracker.getGameMetrics === 'function') {
    try {
      const metrics = await game.tokenTracker.getGameMetrics(game.gameId);
      if (Array.isArray(metrics)) {
        for (const metric of metrics) {
          if (!metric || !metric.playerId) continue;
          rows.set(metric.playerId, {
            playerId: metric.playerId,
            playerName: nameByPlayerId.get(metric.playerId) || undefined,
            provider: metric.provider || 'unknown',
            model: metric.model || 'unknown',
            promptTokens: metric.totalPromptTokens || 0,
            completionTokens: metric.totalCompletionTokens || 0,
            totalTokens: metric.totalTokens || 0,
            cost: (metric.estimatedCost && metric.estimatedCost.totalCost) || 0,
            apiCalls: (metric.turns && metric.turns.length) || 0,
            latencyMs: 0,
          });
        }
      }
    } catch (e) {
      // Fall through to the api tracker below.
    }
  }

  // 2. APITracker per-player call records — real wire calls + latency.
  //    Only fills gaps: apiCalls when the token tracker recorded none,
  //    latencyMs as the average per-call duration (0 when unmeasured).
  const tracker = game && game.apiTracker;
  if (tracker && tracker.metrics instanceof Map) {
    for (const metric of tracker.metrics.values()) {
      if (!metric || metric.gameId !== game.gameId || !metric.playerId) continue;
      const calls = metric.calls || [];
      let row = rows.get(metric.playerId);
      if (!row) {
        row = {
          playerId: metric.playerId,
          playerName: nameByPlayerId.get(metric.playerId) || undefined,
          provider: metric.provider || 'unknown',
          model: metric.model || 'unknown',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          apiCalls: 0,
          latencyMs: 0,
        };
        rows.set(metric.playerId, row);
      }
      if (row.apiCalls === 0) row.apiCalls = calls.length;
      if (calls.length > 0) {
        const totalMs = calls.reduce((sum, call) => sum + (call.duration || 0), 0);
        row.latencyMs = Math.round(totalMs / calls.length);
      }
    }
  }

  return Array.from(rows.values());
}

module.exports = { collectUsage, collectLatencyByModel, collectUsageByPlayer };
