/**
 * Cost Tracking Unit Tests
 *
 * Tests for CostTracker class, CostTrackerRegistry, createCostTracker,
 * getCostTracker, removeCostTracker, trackSync, getGameSummary,
 * getPlayerSummary, getEntriesByPhase, getEntriesByPlayer, getWarnings,
 * getFormattedTotalCost, getTotalCost, formatCost (static), getEntries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CostTracker,
  costTrackerRegistry,
  createCostTracker,
  getCostTracker,
  removeCostTracker,
  CostTrackerOptions,
} from '../../providers/cost-tracking.js';

describe('CostTracker', () => {
  describe('constructor', () => {
    it('should create tracker with default options', () => {
      const tracker = new CostTracker('game-1');
      const summary = tracker.getGameSummary();
      expect(summary.gameId).toBe('game-1');
      expect(summary.totalCost).toBe(0);
      expect(summary.totalRequests).toBe(0);
    });

    it('should accept custom options', () => {
      const tracker = new CostTracker('game-2', {
        trackPerPlayer: false,
        warnThreshold: 5.0,
        maxCostPerGame: 50,
      });
      const summary = tracker.getGameSummary();
      expect(summary.gameId).toBe('game-2');
    });
  });

  describe('getTotalCost', () => {
    it('should start at zero', () => {
      const tracker = new CostTracker('game-test');
      expect(tracker.getTotalCost()).toBe(0);
    });
  });

  describe('getFormattedTotalCost', () => {
    it('should format zero cost', () => {
      const tracker = new CostTracker('game-test');
      // 0 < 0.01, so formatted as $0.0000
      expect(tracker.getFormattedTotalCost()).toContain('$');
    });

    it('should format with $ sign', () => {
      const tracker = new CostTracker('game-test');
      const formatted = tracker.getFormattedTotalCost();
      expect(formatted.startsWith('$')).toBe(true);
    });
  });

  describe('trackSync', () => {
    it('should add entry and update total tokens', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('gpt-4o-mini', 100, 50, 'day', 'speak', 'player-1');

      const entries = tracker.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].modelId).toBe('gpt-4o-mini');
      expect(entries[0].inputTokens).toBe(100);
      expect(entries[0].outputTokens).toBe(50);
      expect(entries[0].phase).toBe('day');
      expect(entries[0].action).toBe('speak');
    });

    it('should track multiple entries', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('gpt-4o-mini', 100, 50, 'day', 'speak', 'player-1');
      tracker.trackSync('gpt-4o-mini', 200, 100, 'night', 'vote', 'player-1');

      const entries = tracker.getEntries();
      expect(entries.length).toBe(2);
    });

    it('should track per player', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('model-a', 100, 50, 'day', undefined, 'player-1');
      tracker.trackSync('model-a', 200, 100, 'day', undefined, 'player-2');

      const p1Entries = tracker.getEntriesByPlayer('player-1');
      const p2Entries = tracker.getEntriesByPlayer('player-2');
      expect(p1Entries.length).toBe(1);
      expect(p2Entries.length).toBe(1);
    });

    it('should not track per player when disabled', () => {
      const tracker = new CostTracker('game-test', { trackPerPlayer: false });
      tracker.trackSync('model-a', 100, 50, 'day', undefined, 'player-1');
      expect(tracker.getEntriesByPlayer('player-1').length).toBe(0);
    });
  });

  describe('getEntries', () => {
    it('should return empty array initially', () => {
      const tracker = new CostTracker('game-test');
      expect(tracker.getEntries()).toEqual([]);
    });

    it('should return a copy', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('gpt-4o-mini', 100, 50, 'day');
      const entries1 = tracker.getEntries();
      const entries2 = tracker.getEntries();
      expect(entries1).not.toBe(entries2);
    });
  });

  describe('getEntriesByPhase', () => {
    it('should filter entries by phase', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('model-a', 100, 50, 'day');
      tracker.trackSync('model-a', 200, 100, 'night');
      tracker.trackSync('model-a', 300, 150, 'day');

      const dayEntries = tracker.getEntriesByPhase('day');
      const nightEntries = tracker.getEntriesByPhase('night');
      expect(dayEntries.length).toBe(2);
      expect(nightEntries.length).toBe(1);
    });

    it('should return empty array for unmatched phase', () => {
      const tracker = new CostTracker('game-test');
      expect(tracker.getEntriesByPhase('nonexistent')).toEqual([]);
    });
  });

  describe('getWarnings', () => {
    it('should return empty array initially', () => {
      const tracker = new CostTracker('game-test');
      expect(tracker.getWarnings()).toEqual([]);
    });
  });

  describe('getGameSummary', () => {
    it('should return correct totals', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('model-a', 100, 50, 'day', undefined, 'p1');
      tracker.trackSync('model-a', 200, 100, 'day', undefined, 'p2');

      const summary = tracker.getGameSummary();
      expect(summary.gameId).toBe('game-test');
      expect(summary.totalRequests).toBe(2);
      expect(summary.totalInputTokens).toBe(300);
      expect(summary.totalOutputTokens).toBe(150);
    });

    it('should include player breakdown', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('model-a', 100, 50, 'day', undefined, 'player-1');
      tracker.trackSync('model-a', 200, 100, 'day', undefined, 'player-2');

      const summary = tracker.getGameSummary();
      expect(summary.playerBreakdown.length).toBe(2);
      expect(summary.playerBreakdown[0].playerId).toBe('player-1');
      expect(summary.playerBreakdown[1].playerId).toBe('player-2');
    });

    it('should include duration', () => {
      const tracker = new CostTracker('game-test');
      const summary = tracker.getGameSummary();
      expect(typeof summary.duration).toBe('number');
      expect(summary.duration).toBeGreaterThanOrEqual(0);
    });

    it('should have endTime', () => {
      const tracker = new CostTracker('game-test');
      const summary = tracker.getGameSummary();
      expect(typeof summary.endTime).toBe('number');
    });
  });

  describe('getPlayerSummary', () => {
    it('should return null for unknown player', () => {
      const tracker = new CostTracker('game-test');
      expect(tracker.getPlayerSummary('unknown')).toBeNull();
    });

    it('should return correct player totals', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('model-a', 100, 50, 'day', undefined, 'p1');
      tracker.trackSync('model-a', 300, 150, 'night', undefined, 'p1');

      const summary = tracker.getPlayerSummary('p1');
      expect(summary).not.toBeNull();
      expect(summary!.totalInputTokens).toBe(400);
      expect(summary!.totalOutputTokens).toBe(200);
      expect(summary!.requestCount).toBe(2);
    });

    it('should calculate averageCostPerRequest', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('model-a', 100, 50, 'day', undefined, 'p1');
      tracker.trackSync('model-a', 200, 100, 'day', undefined, 'p1');

      const summary = tracker.getPlayerSummary('p1');
      expect(summary!.averageCostPerRequest).toBeGreaterThanOrEqual(0);
      expect(summary!.requestCount).toBe(2);
    });

    it('should track most used model', () => {
      const tracker = new CostTracker('game-test');
      tracker.trackSync('gpt-4', 100, 50, 'day', undefined, 'p1');
      tracker.trackSync('gpt-4', 100, 50, 'day', undefined, 'p1');
      tracker.trackSync('gpt-3.5', 100, 50, 'day', undefined, 'p1');

      const summary = tracker.getPlayerSummary('p1');
      expect(summary!.modelUsed).toBe('gpt-4');
    });
  });

  describe('formatCost', () => {
    it('should format very small costs', () => {
      // 0.0005 < 0.001 → uses (cost * 1000).toFixed(4) = "0.5000"
      expect(CostTracker.formatCost(0.0005)).toBe('$0.5000');
    });

    it('should format medium costs', () => {
      expect(CostTracker.formatCost(0.005)).toBe('$0.005');
    });

    it('should format larger costs', () => {
      expect(CostTracker.formatCost(1.23)).toBe('$1.23');
    });

    it('should format zero', () => {
      expect(CostTracker.formatCost(0)).toBe('$0.0000');
    });
  });

  describe('static estimateCost', () => {
    it('should return object with correct shape', async () => {
      const result = await CostTracker.estimateCost('gpt-4o-mini', 1000, 500);
      expect(typeof result.cost).toBe('number');
      expect(typeof result.formatted).toBe('string');
      expect(typeof result.hasPricing).toBe('boolean');
    });
  });
});

describe('CostTrackerRegistry', () => {
  beforeEach(() => {
    // Clean up trackers from previous tests
    const allTrackers = costTrackerRegistry.getAllTrackers();
    for (const [id] of allTrackers) {
      costTrackerRegistry.removeTracker(id);
    }
  });

  describe('createTracker', () => {
    it('should create and store a tracker', () => {
      const tracker = costTrackerRegistry.createTracker('registry-test');
      expect(tracker).toBeInstanceOf(CostTracker);
      expect(costTrackerRegistry.getTracker('registry-test')).toBe(tracker);
    });
  });

  describe('getTracker', () => {
    it('should return undefined for unknown game', () => {
      expect(costTrackerRegistry.getTracker('nonexistent-game')).toBeUndefined();
    });
  });

  describe('removeTracker', () => {
    it('should remove a tracker', () => {
      costTrackerRegistry.createTracker('temp-game');
      expect(costTrackerRegistry.getTracker('temp-game')).toBeDefined();

      costTrackerRegistry.removeTracker('temp-game');
      expect(costTrackerRegistry.getTracker('temp-game')).toBeUndefined();
    });
  });

  describe('getAllTrackers', () => {
    it('should return a Map', () => {
      const all = costTrackerRegistry.getAllTrackers();
      expect(all).toBeInstanceOf(Map);
    });
  });

  describe('getTotalCostAcrossAllGames', () => {
    it('should return zero when no trackers', () => {
      expect(costTrackerRegistry.getTotalCostAcrossAllGames()).toBe(0);
    });

    it('should sum costs across all trackers', () => {
      costTrackerRegistry.createTracker('game-a');
      costTrackerRegistry.createTracker('game-b');
      // Both new trackers have 0 cost
      const total = costTrackerRegistry.getTotalCostAcrossAllGames();
      expect(total).toBe(0);
    });
  });
});

describe('createCostTracker factory', () => {
  it('should create and register a tracker', () => {
    const tracker = createCostTracker('factory-game');
    expect(tracker).toBeInstanceOf(CostTracker);
    expect(getCostTracker('factory-game')).toBe(tracker);
  });
});

describe('removeCostTracker factory', () => {
  it('should remove a tracker', () => {
    createCostTracker('removal-game');
    removeCostTracker('removal-game');
    expect(getCostTracker('removal-game')).toBeUndefined();
  });
});
