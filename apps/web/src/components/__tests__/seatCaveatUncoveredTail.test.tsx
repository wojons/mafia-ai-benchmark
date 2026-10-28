// ch:trace row=DF-MAFIA-AI-BENCHMARK-39-R3 spec=none:leaderboard-seat-caveat wave=mafia-ai-benchmark-foreman-2026-10-28-10-22-22.json#DF-MAFIA-AI-BENCHMARK-39-R3 test=apps/web/src/components/__tests__/seatCaveatUncoveredTail.test.tsx::mini-shaped row with uncovered tail renders the seat caveat evidence=commit commit=21387374a4b3cb7459ce76a206d99682578397ed
// STATUS: complete
// TIER: T2 — compare payload declares per-row gamesWithoutPlayerCount (usage-only tail, measured 3725 players-rows vs 4382 gamesPlayed); seatCaveatFor renders the note on dominant-share>=0.9 OR declared remainder>0, naming the model per row; apps/web vitest 100/100 + apps/server vitest 573 passed | 19 skipped on the implementation commit (observed foreman-side post-rebase).
// EVIDENCE: commit 21387374a4b3cb7459ce76a206d99682578397ed (main, pushed 2026-10-28); seatCaveatUncoveredTail.test.tsx x6 green + benchmark-model-breakdown.test.ts x3 green.
/**
 * DF-MAFIA-AI-BENCHMARK-39-R3 — the seat caveat was suppressed exactly on
 * the row that needed it.
 *
 * Live store truth (GET /api/v1/benchmark/compare, measured 2026-10-28):
 *   openai/gpt-4o-mini: gamesPlayed 4382, wins 3726, winRate 0.8503,
 *   byNumPlayers buckets {5: 3629, 6: 3, 7: 2, 8: 2, 10: 93} — the sum is
 *   3729, so 653 games (14.9%) are counted in gamesPlayed but carry NO
 *   seat data (legacy token_usage-only games with no players rows). The
 *   dominant bucket covers only 3629/4382 = 82.8% < 0.9, so the old
 *   `share >= 0.9` gate suppressed the note — while the same panel shows
 *   mini winning 3628/3629 (100.0%) of its 5-player seats, making the
 *   caveat MORE important here than anywhere else on the page, not less.
 *
 * Contract pinned below:
 *   1. A mini-shaped row (dominant share 0.828 + gamesWithoutPlayerCount
 *      653) DOES render a seat caveat — the uncovered-tail arm, not the
 *      >= 0.9 arm.
 *   2. The note names the model it qualifies (row-level, not page-level).
 *   3. The note includes the unattributed count when declared.
 *   4. A fully reconciled row with no dominant bucket (share < 0.9, no
 *      remainder) stays silent — the caveat never fires on a clean row.
 *   5. A usage-only row (empty breakdown maps, declared remainder) still
 *      renders the caveat — caveat presence no longer rides on
 *      breakdown richness.
 *   6. Note count equals qualifying-row count across a mixed panel.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import BenchmarkLeaderboard from '../../components/BenchmarkLeaderboard';

// Mini-shaped row mirroring the live compare payload EXACTLY (verified
// 2026-10-28): blended winRate 0.8503, dominant 5-player bucket 3629 of
// 4382 games (82.8% < the old 0.9 gate), buckets sum 3729, and the
// server-declared remainder 4382 - 3729 = 653.
const miniShapedRow = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  gamesPlayed: 4382,
  wins: 3726,
  winRate: 0.8503,
  avgTokensPerGame: 5120,
  avgCostPerGame: 0.0129,
  avgLatency: 842,
  avgRolePerformance: 0,
  gamesWithoutPlayerCount: 653,
  rolePerformance: {},
  byNumPlayers: {
    '5': { gamesPlayed: 3629, wins: 3628, winRate: 0.9997 },
    '6': { gamesPlayed: 3, wins: 3, winRate: 1 },
    '7': { gamesPlayed: 2, wins: 2, winRate: 1 },
    '8': { gamesPlayed: 2, wins: 2, winRate: 1 },
    '10': { gamesPlayed: 93, wins: 91, winRate: 0.9785 },
  },
};

const envelopeWith = (models: unknown[]) => ({
  success: true,
  data: { models, headToHead: [], trends: [] },
});

const renderModels = (models: unknown[]): string =>
  renderToString(
    <BenchmarkLeaderboard payload={envelopeWith(models)} loading={false} />,
  ).replace(/<!-- -->/g, '');

describe('DF-39-R3 seat caveat on uncovered-tail rows', () => {
  it('mini-shaped row with uncovered tail renders the seat caveat', () => {
    const html = renderModels([miniShapedRow]);

    // The caveat renders DESPITE dominant share 82.8% < 0.9 — this is the
    // uncovered-tail arm pinning the exact live defect the row was filed
    // for. The old gate (`share >= 0.9`) suppressed the note on this row.
    expect(html).toContain('Headline win rate reflects seat assignment');
    expect(html).toContain('82.8% of games used 5-player seats');
    // The note names the unattributed remainder the server declared.
    expect(html).toContain('653 games without seat data');
    // The caveat is the ONLY reason the note renders here: this row
    // fails the original >= 0.9 arm by construction.
  });

  it('the note names the model it qualifies (row-level, not page-level)', () => {
    const html = renderModels([miniShapedRow]);

    // data-testid is per-row and the strong label carries the key.
    expect(html).toContain('data-testid="seat-assignment-note-openai-gpt-4o-mini"');
    expect(html).toContain('openai/gpt-4o-mini');
  });

  it('a reconciled row with mixed seats and no remainder stays silent', () => {
    // share = 4/10 < 0.9, buckets sum == gamesPlayed, no remainder.
    const html = renderModels([
      {
        provider: 'openai',
        model: 'mixed-clean',
        gamesPlayed: 10,
        wins: 5,
        winRate: 0.5,
        rolePerformance: {},
        byNumPlayers: {
          '5': { gamesPlayed: 4, wins: 4, winRate: 1 },
          '10': { gamesPlayed: 6, wins: 1, winRate: 0.2 },
        },
      },
    ]);

    expect(html).not.toContain('Headline win rate reflects seat assignment');
    expect(html).not.toContain('games without seat data');
    // Breakdown itself still renders.
    expect(html).toContain('Player-count breakdown:');
  });

  it('a usage-only row (empty maps + declared remainder) still renders the caveat', () => {
    const html = renderModels([
      {
        provider: 'openai',
        model: 'usage-only',
        gamesPlayed: 40,
        wins: 0,
        winRate: 0,
        gamesWithoutPlayerCount: 40,
        rolePerformance: {},
        byNumPlayers: {},
      },
    ]);

    // No dominant bucket exists, but the whole denominator carries no seat
    // data — the blended rate is fully unexplained without the caveat.
    expect(html).toContain('data-testid="seat-assignment-note-openai-usage-only"');
    expect(html).toContain('40 games without seat data');
    expect(html).not.toContain('Headline win rate reflects seat assignment:');
  });

  it('note count equals qualifying-row count across a mixed panel', () => {
    const html = renderModels([
      miniShapedRow, // qualifies: uncovered tail
      {
        // qualifies: original >= 0.9 arm, fully reconciled
        provider: 'openai',
        model: 'gpt-4o',
        gamesPlayed: 95,
        wins: 74,
        winRate: 0.7789,
        gamesWithoutPlayerCount: 0,
        rolePerformance: {},
        byNumPlayers: {
          '5': { gamesPlayed: 90, wins: 73, winRate: 0.811 },
          '10': { gamesPlayed: 5, wins: 1, winRate: 0.2 },
        },
      },
      {
        // does NOT qualify: reconciled, mixed seats
        provider: 'neuralwatt',
        model: 'glm-5.3-flash',
        gamesPlayed: 10,
        wins: 5,
        winRate: 0.5,
        rolePerformance: {},
        byNumPlayers: {
          '5': { gamesPlayed: 6, wins: 4, winRate: 0.6667 },
          '7': { gamesPlayed: 4, wins: 1, winRate: 0.25 },
        },
      },
    ]);

    const notes = html.match(/Headline win rate reflects seat assignment/g) ?? [];
    expect(notes).toHaveLength(2);
    expect(html).toContain('data-testid="seat-assignment-note-openai-gpt-4o-mini"');
    expect(html).toContain('data-testid="seat-assignment-note-openai-gpt-4o"');
    // The >= 0.9 arm renders WITHOUT an unattributed clause when the row
    // reconciles (gamesWithoutPlayerCount: 0) — scoped to the gpt-4o note
    // because the mini note on the same panel legitimately carries one.
    const note4o = html
      .split('data-testid="seat-assignment-note-openai-gpt-4o"')[1]
      ?.split('</p>')[0] ?? '';
    expect(note4o).toContain('94.7% of games used 5-player seats');
    expect(note4o).not.toContain('games without seat data');
  });

  it('remains silent when the row fully reconciles and share is below the gate — no regression to the old behavior for clean rows', () => {
    // Old backend shape: no gamesWithoutPlayerCount at all (undefined),
    // buckets sum == gamesPlayed, share < 0.9 -> no caveat (unknown arm
    // only fires when a dominant bucket exists AND something unexplained
    // actually renders; a fully-covered mixed row is honest as-is).
    const html = renderModels([
      {
        provider: 'legacy',
        model: 'old-backend',
        gamesPlayed: 10,
        wins: 5,
        winRate: 0.5,
        rolePerformance: {},
        byNumPlayers: {
          '5': { gamesPlayed: 6, wins: 5, winRate: 0.8333 },
          '7': { gamesPlayed: 4, wins: 0, winRate: 0 },
        },
      },
    ]);

    expect(html).not.toContain('Headline win rate reflects seat assignment');
  });
});