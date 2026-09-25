import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import BenchmarkLeaderboard, {
  normalizeCompareModels,
  sortLeaderboardRows,
  type CompareModelRow,
} from '../components/BenchmarkLeaderboard';

// DF-MAFIA-AI-BENCHMARK-14: the payload shape below mirrors the LIVE
// GET /api/v1/benchmark/compare envelope exactly (verified 2026-09-25):
// { success, data: { models, headToHead, trends } } with rows carrying
// provider/model/gamesPlayed/wins/winRate and possibly real zeros for
// avgTokensPerGame / avgCostPerGame.
const liveShapedEnvelope = {
  success: true,
  data: {
    headToHead: [
      {
        modelA: 'openai/gpt-4o-mini',
        modelB: 'neuralwatt/other-model',
        gamesPlayed: 12,
        modelAWins: 11,
        modelBWins: 1,
        ties: 0,
      },
    ],
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        gamesPlayed: 1364,
        wins: 1361,
        winRate: 0.9978,
        avgTokensPerGame: 0,
        avgCostPerGame: 0.0129,
        avgLatency: 842,
        avgRolePerformance: 0,
        rolePerformance: {},
      },
      {
        provider: 'neuralwatt',
        model: 'glm-5.3-flash',
        gamesPlayed: 2457,
        wins: 2400,
        winRate: 0.978,
        avgTokensPerGame: 5120,
        avgCostPerGame: 0,
        avgLatency: 980,
        avgRolePerformance: 0,
        rolePerformance: {},
      },
    ],
    trends: [],
  },
};

describe('BenchmarkLeaderboard', () => {
  it('renders per-model rows from the live /benchmark/compare envelope, sorted by gamesPlayed desc', () => {
    const html = renderToString(<BenchmarkLeaderboard payload={liveShapedEnvelope} loading={false} />);

    // Both models render, most games played FIRST (2457 > 1364).
    const posGlm = html.indexOf('glm-5.3-flash');
    const posGpt = html.indexOf('gpt-4o-mini');
    expect(posGlm).toBeGreaterThan(-1);
    expect(posGpt).toBeGreaterThan(posGlm);

    // Row metrics render as provided by the API (no fabricated values).
    // NOTE: react-dom/server emits <!-- --> between adjacent text nodes, so
    // assertions target the numeric segments, not combined strings.
    expect(html).toContain('1364');
    expect(html).toContain('1361');
    expect(html).toMatch(/99\.8/); // winRate 0.9978
    expect(html).toContain('2457');
    expect(html).toMatch(/97\.8/); // winRate 0.978
    expect(html).toMatch(/\$0\.0129/);
  });

  it('renders real zero metrics as-is (never as em-dash placeholders)', () => {
    const html = renderToString(<BenchmarkLeaderboard payload={liveShapedEnvelope} loading={false} />);
    // avgTokensPerGame: 0 on the gpt-4o-mini live-shaped row -> literal "0".
    expect(html).toMatch(/<td[^>]*>0<\/td>/);
    // avgCostPerGame: 0 -> "$0.0000".
    expect(html).toContain('$0.0000');
  });

  it('shows the empty state when the payload carries no models', () => {
    const html = renderToString(
      <BenchmarkLeaderboard payload={{ success: true, data: { models: [] } }} loading={false} />,
    );
    expect(html).toContain('No model data available');
    expect(html).not.toContain('data-testid="model-leaderboard"');
  });

  describe('normalizeCompareModels', () => {
    it('unwraps the success/data envelope shape', () => {
      const rows = normalizeCompareModels(liveShapedEnvelope);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini' });
    });

    it('accepts the already-unwrapped bare report', () => {
      const rows = normalizeCompareModels(liveShapedEnvelope.data);
      expect(rows).toHaveLength(2);
    });

    it('returns zero rows for null/garbage payloads — never fabricated rows', () => {
      expect(normalizeCompareModels(null)).toEqual([]);
      expect(normalizeCompareModels({ success: true })).toEqual([]);
      expect(normalizeCompareModels(undefined)).toEqual([]);
    });
  });

  describe('sortLeaderboardRows', () => {
    it('sorts by gamesPlayed desc with wins as tiebreak', () => {
      const rows: CompareModelRow[] = [
        { provider: 'a', model: 'few-games', gamesPlayed: 10, wins: 9, winRate: 0.9 },
        { provider: 'b', model: 'many-games', gamesPlayed: 100, wins: 50, winRate: 0.5 },
        { provider: 'c', model: 'tie-winner', gamesPlayed: 100, wins: 60, winRate: 0.6 },
      ];
      const sorted = sortLeaderboardRows(rows);
      // gamesPlayed desc; the 100-game tie breaks on WINS desc (tie-winner).
      expect(sorted.map((r) => r.model)).toEqual(['tie-winner', 'many-games', 'few-games']);
    });
  });
});