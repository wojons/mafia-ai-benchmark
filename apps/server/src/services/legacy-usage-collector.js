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

async function collectUsage(game) {
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

  // 3. Config-derived fallback: role models from the environment. These
  //    carry no token/cost numbers (the engine did not track them), but
  //    they are the REAL models that played, so the server can record
  //    per-model rows with zero usage instead of nothing.
  if (usage.length === 0) {
    const roleModels = {
      MAFIA: process.env.MAFIA_MODEL,
      DOCTOR: process.env.DOCTOR_MODEL,
      SHERIFF: process.env.SHERIFF_MODEL,
      VIGILANTE: process.env.VIGILANTE_MODEL,
      VILLAGER: process.env.VILLAGER_MODEL,
    };
    const seen = new Set();
    for (const model of Object.values(roleModels)) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const [provider, modelName] = model.split('/');
      usage.push({
        provider: provider || 'openai',
        model: modelName || model,
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

module.exports = { collectUsage, collectLatencyByModel };
