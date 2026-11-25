/**
 * Model pricing table (MAF-INIT-001).
 *
 * The single source of truth for deriving a cost_usd from recorded token
 * counts. Every cost figure computed ANYWHERE in the repo flows through
 * `computeCostUsd` — a call site must never inline a per-token number.
 *
 * The table carries PUBLIC LIST sticker prices (USD per 1M tokens,
 * input / output) for the models the benchmark fleet actually runs. Prices
 * drift; a wrong entry produces a wrong (but documented) derivation, while a
 * MISSING entry is the honest outcome: `computeCostUsd` returns `null` and
 * callers must persist nothing (never fabricate a 0). Keep the table
 * conservative — only add a model when its per-token price is a published
 * list price, and cite the price in the entry comment.
 */

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillion: number;
}

/**
 * Public list pricing, USD per 1M tokens (input / output). Keys are bare
 * model ids as recorded in players.model / token_usage.model. Lookups are
 * case-insensitive; provider-qualified ids ('openai/gpt-4o-mini') resolve
 * through their trailing model segment.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // OpenAI (platform.openai.com list prices, per 1M tokens)
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'o3': { inputPerMillion: 2, outputPerMillion: 8 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  // Anthropic (docs.anthropic.com list prices, per 1M tokens)
  'claude-3-5-sonnet-latest': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku-latest': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-sonnet-4': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-4': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-3-haiku-20240307': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  // Google AI Studio list prices (per 1M tokens)
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
  // DeepSeek platform list prices (per 1M tokens)
  'deepseek-chat': { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
};

/** Strip a provider prefix ('openai/gpt-4o' -> 'gpt-4o'). */
function bareModelId(model: string): string {
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/** Look up the table entry for a (provider, model) pair, or undefined. */
export function lookupModelPricing(
  provider: string,
  model: string,
): ModelPrice | undefined {
  const trimmedModel = model.trim();
  if (!trimmedModel) return undefined;
  const table = MODEL_PRICING;

  // 1. Provider-qualified key ('openai/gpt-4o-mini') — some corpus rows
  //    record the full spec string the runner passes, not the bare id.
  const qualified = table[`${provider}/${trimmedModel}`];
  if (qualified) return qualified;

  // 2. Bare model id, exact case.
  const direct = table[trimmedModel];
  if (direct) return direct;

  // 3. Case-insensitive over the bare id (corpus rows mix 'GPT-4o-mini',
  //    'moonshotai/Kimi-K2.6' style ids with lowercase keys).
  const bare = bareModelId(trimmedModel).toLowerCase();
  for (const [key, price] of Object.entries(table)) {
    if (key.toLowerCase() === bare) return price;
  }
  return undefined;
}

/**
 * Derive a cost_usd from recorded token counts via the pricing table.
 *
 * Returns `null` when the model has NO table entry — the honest "not
 * derivable" outcome callers must persist as absence (NULL), never as a
 * fabricated 0. Zero token counts are real data and yield 0.
 */
export function computeCostUsd(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const pricing = lookupModelPricing(provider, model);
  if (!pricing) return null;
  return (
    ((Math.max(0, promptTokens) / 1_000_000) * pricing.inputPerMillion) +
    ((Math.max(0, completionTokens) / 1_000_000) * pricing.outputPerMillion)
  );
}
