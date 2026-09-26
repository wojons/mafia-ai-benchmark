/**
 * Mock-games marker on the benchmark leaderboard (DF-MAFIA-AI-BENCHMARK-12).
 *
 * The compare report now carries a mockGames count (games excluded because
 * every provider call fell back to canned mock). The leaderboard must flag
 * that exclusion honestly instead of letting a placeholder-key install pass
 * as real benchmark data.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import BenchmarkLeaderboard, {
  extractMockGamesCount,
  type CompareModelRow,
} from '../components/BenchmarkLeaderboard';

const envelopeWithMock = {
  success: true,
  data: {
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        gamesPlayed: 3,
        wins: 3,
        winRate: 1,
        avgTokensPerGame: 4500,
        avgCostPerGame: 0.0036,
        avgLatency: 900,
      },
    ],
    headToHead: [],
    mockGames: 12,
    trends: [],
  },
};

describe('mock-games marker on the leaderboard (DF-MAFIA-AI-BENCHMARK-12)', () => {
  describe('extractMockGamesCount', () => {
    it('reads mockGames off the envelope and the bare report', () => {
      expect(extractMockGamesCount(envelopeWithMock)).toBe(12);
      expect(extractMockGamesCount(envelopeWithMock.data)).toBe(12);
    });

    it('returns undefined when the server did not send it (older backend)', () => {
      expect(extractMockGamesCount({ success: true, data: { models: [] } })).toBeUndefined();
      expect(extractMockGamesCount(null)).toBeUndefined();
      expect(extractMockGamesCount(undefined)).toBeUndefined();
      // Negative / non-finite values are not honest counts — hidden.
      expect(extractMockGamesCount({ data: { mockGames: -1 } })).toBeUndefined();
      expect(extractMockGamesCount({ data: { mockGames: 'many' } })).toBeUndefined();
    });
  });

  it('renders the mock-games note above the table when mockGames > 0', () => {
    const html = renderToString(<BenchmarkLeaderboard payload={envelopeWithMock} loading={false} />);
    expect(html).toContain('data-testid="mock-games-note"');
    // NOTE: react-dom/server emits <!-- --> between adjacent text nodes.
    expect(html).toMatch(/12<!-- --> mock game\(s\) excluded/);
    // The rows still render.
    expect(html).toContain('gpt-4o-mini');
  });

  it('hides the note when mockGames is 0 or absent', () => {
    const noMock = {
      success: true,
      data: {
        models: envelopeWithMock.data.models,
        headToHead: [],
        trends: [],
      },
    };
    const html = renderToString(<BenchmarkLeaderboard payload={noMock} loading={false} />);
    expect(html).not.toContain('data-testid="mock-games-note"');
  });

  it('shows the note even when every row was excluded (no model rows)', () => {
    const onlyMock = {
      success: true,
      data: { models: [], headToHead: [], mockGames: 5, trends: [] },
    };
    const html = renderToString(<BenchmarkLeaderboard payload={onlyMock} loading={false} />);
    expect(html).toMatch(/5<!-- --> mock game\(s\) excluded/);
  });

  it('never fabricates the note for garbage payloads', () => {
    const html = renderToString(
      <BenchmarkLeaderboard payload={{ success: true }} loading={false} />,
    );
    expect(html).not.toContain('mock game(s) excluded');
    expect(html).toContain('No model data available');
  });
});

// Re-exported for the shared sort test type import path stability.
export type { CompareModelRow };