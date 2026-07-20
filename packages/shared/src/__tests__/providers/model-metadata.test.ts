/**
 * Model Metadata Unit Tests
 *
 * Tests for model metadata functions: NO_PRICING_MARKER, getModelCapabilities,
 * getModelPricing, calculateCost, getCachedCostEstimate, getCacheStats,
 * clearModelCache, getAllCachedModels, getModelsByProvider, getPopularModels,
 * searchModelsByProvider, getDefaultCapabilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NO_PRICING_MARKER,
  getModelCapabilities,
  getModelPricing,
  calculateCost,
  getCachedCostEstimate,
  clearModelCache,
  getCacheStats,
  getAllCachedModels,
  getModelsByProvider,
  getPopularModels,
  searchModelsByProvider,
} from '../../providers/model-metadata.js';

describe('Model Metadata', () => {
  beforeEach(() => {
    // Clear cache between tests to ensure clean state
    clearModelCache();
  });

  describe('NO_PRICING_MARKER', () => {
    it('should be -6.66', () => {
      expect(NO_PRICING_MARKER).toBe(-6.66);
    });
  });

  describe('getCacheStats', () => {
    it('should return stats with correct structure', () => {
      const stats = getCacheStats();
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.age).toBe('number');
      expect(typeof stats.valid).toBe('boolean');
      expect(typeof stats.pricingCount).toBe('number');
    });

    it('should return size 0 when cache is cleared', () => {
      clearModelCache();
      const stats = getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('clearModelCache', () => {
    it('should reset cache state', () => {
      clearModelCache();
      const stats = getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('getAllCachedModels', () => {
    it('should return an array', () => {
      const models = getAllCachedModels();
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('getModelsByProvider', () => {
    it('should filter by provider name', () => {
      const models = getModelsByProvider('openai');
      // If the model cache has been fetched, filter should work
      expect(Array.isArray(models)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const lower = getModelsByProvider('openai');
      const upper = getModelsByProvider('OPENAI');
      expect(lower.length).toBe(upper.length);
    });
  });

  describe('getModelCapabilities', () => {
    it('should return defaults for gpt-4-like models', async () => {
      const caps = await getModelCapabilities('test-gpt-4-abc123xyz');
      // gpt-4 inference from getDefaultCapabilities
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(true);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.supportsStopTokens).toBe(true);
      expect(caps.maxContextLength).toBeGreaterThan(0);
      expect(caps.maxOutputLength).toBeGreaterThan(0);
    });

    it('should return defaults for claude-like models', async () => {
      const caps = await getModelCapabilities('cust0m-claude-test');
      // claude inference from getDefaultCapabilities
      expect(caps.streaming).toBe(true);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBeGreaterThan(0);
      expect(caps.maxOutputLength).toBeGreaterThan(0);
    });

    it('should return defaults for gemini-like models', async () => {
      const caps = await getModelCapabilities('zz-test-gemini-zz');
      // gemini inference from getDefaultCapabilities
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(true);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBeGreaterThan(0);
      expect(caps.maxOutputLength).toBeGreaterThan(0);
    });

    it('should return generic defaults for unknown model', async () => {
      const caps = await getModelCapabilities('completely-x-unknown-zzz');
      expect(caps.streaming).toBe(true);
      expect(caps.functionCalling).toBe(false);
      expect(caps.systemPrompt).toBe(true);
      expect(caps.maxContextLength).toBe(32768);
      expect(caps.maxOutputLength).toBe(4096);
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.supportsStopTokens).toBe(true);
    });
  });

  describe('getModelPricing', () => {
    it('should return pricing marker for unknown model', async () => {
      const pricing = await getModelPricing('completely-unknown-model');
      expect(pricing.isMissingPricing).toBe(true);
      expect(pricing.hasPricing).toBe(false);
    });

    it('should have correct shape', async () => {
      const pricing = await getModelPricing('some-model');
      expect(typeof pricing.inputPerMillion).toBe('number');
      expect(typeof pricing.outputPerMillion).toBe('number');
      expect(typeof pricing.hasPricing).toBe('boolean');
      expect(typeof pricing.isMissingPricing).toBe('boolean');
    });
  });

  describe('calculateCost', () => {
    it('should return no pricing for uncached model', () => {
      const result = calculateCost('unknown-model', 1000, 500);
      expect(result.cost).toBe(0);
      expect(result.formatted).toBe('No pricing data available');
      expect(result.pricing.isMissingPricing).toBe(true);
    });

    it('should have NO_PRICING_MARKER for uncached model', () => {
      const result = calculateCost('unknown-model', 1000, 500);
      expect(result.pricing.inputPerMillion).toBe(NO_PRICING_MARKER);
      expect(result.pricing.outputPerMillion).toBe(NO_PRICING_MARKER);
    });
  });

  describe('getCachedCostEstimate', () => {
    it('should return no pricing for uncached model', () => {
      const result = getCachedCostEstimate('unknown-model', 1000, 500);
      expect(result.cost).toBe(0);
      expect(result.formatted).toBe('No pricing data');
      expect(result.hasPricing).toBe(false);
    });

    it('should use proper formatting for costs', () => {
      const result = getCachedCostEstimate('unknown-model', 1000, 500);
      expect(typeof result.formatted).toBe('string');
    });
  });

  describe('getPopularModels', () => {
    it('should return an array', async () => {
      const models = await getPopularModels(undefined, 10);
      expect(Array.isArray(models)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const models = await getPopularModels(undefined, 3);
      expect(models.length).toBeLessThanOrEqual(3);
    });

    it('should filter by provider', async () => {
      const models = await getPopularModels('openai', 5);
      // Provider filter is applied via model.provider.toLowerCase()
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('searchModelsByProvider', () => {
    it('should return an array', async () => {
      const models = await searchModelsByProvider('openai');
      expect(Array.isArray(models)).toBe(true);
    });
  });
});
