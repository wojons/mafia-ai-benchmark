import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICING,
  computeCostUsd,
  lookupModelPricing,
} from '../../providers/model-pricing-table.js';

/**
 * MAF-INIT-001: cost_usd per player derives from the shared model-pricing
 * table — never a magic inline number at a call site. A model with no table
 * entry yields `null` (the honest "not derivable" outcome), never a
 * fabricated 0; zero token counts are real data and yield 0.
 */
describe('model-pricing-table (MAF-INIT-001)', () => {
  it('exposes a typed table of public list prices', () => {
    expect(MODEL_PRICING['gpt-4o-mini']).toEqual({
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    });
    for (const [id, price] of Object.entries(MODEL_PRICING)) {
      expect(id.length).toBeGreaterThan(0);
      expect(price.inputPerMillion).toBeGreaterThan(0);
      expect(price.outputPerMillion).toBeGreaterThan(0);
    }
  });

  it('computes cost from prompt + completion tokens at the listed price', () => {
    // gpt-4o-mini: $0.15/1M in, $0.60/1M out.
    const cost = computeCostUsd('openai', 'gpt-4o-mini', 500_000, 250_000);
    expect(cost).toBeCloseTo(0.075 + 0.15, 12);
  });

  it('is case-insensitive and resolves provider-qualified model ids', () => {
    expect(lookupModelPricing('openai', 'GPT-4o-Mini')).toBeDefined();
    expect(computeCostUsd('openai', 'openai/gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 12);
  });

  it('yields 0 for zero tokens on a priced model (real data, not fabricated)', () => {
    expect(computeCostUsd('openai', 'gpt-4o-mini', 0, 0)).toBe(0);
  });

  it('yields null for a model with no pricing entry (never a fabricated 0)', () => {
    expect(lookupModelPricing('moonshotai', 'Kimi-K2.6')).toBeUndefined();
    expect(computeCostUsd('moonshotai', 'moonshotai/Kimi-K2.6', 1000, 1000)).toBeNull();
  });

  it('yields null for empty attribution', () => {
    expect(computeCostUsd('', '', 1000, 1000)).toBeNull();
    expect(lookupModelPricing('openai', '   ')).toBeUndefined();
  });
});
