import React from 'react';

export interface CompareBreakdownEntry {
  gamesPlayed: number;
  wins: number;
  winRate: number;
}

export interface CompareModelRow {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokensPerGame?: number;
  avgCostPerGame?: number;
  avgLatency?: number;
  /**
   * DF-39-R3: games the server counted in gamesPlayed but which carry no
   * seat data (no players rows — e.g. legacy token_usage-only games), so
   * they cannot appear in any byNumPlayers bucket. Sum(buckets) +
   * gamesWithoutPlayerCount reconciles with gamesPlayed. Optional so a
   * payload from an older backend still renders.
   */
  gamesWithoutPlayerCount?: number;
  rolePerformance?: Record<string, CompareBreakdownEntry>;
  byNumPlayers?: Record<string, CompareBreakdownEntry>;
}

/**
 * DF-MAFIA-AI-BENCHMARK-12: the count of mock-flagged games the compare
 * report excluded from the model aggregates. Reads it off any accepted
 * payload shape (envelope / bare report); undefined when the server did
 * not send it (older backend) so the UI hides the note instead of lying.
 */
export function extractMockGamesCount(payload: unknown): number | undefined {
  const candidates: unknown[] = [];
  if (payload && typeof payload === 'object') {
    candidates.push(payload);
    const obj = payload as Record<string, unknown>;
    if ('data' in obj && obj.data && typeof obj.data === 'object') {
      candidates.push(obj.data);
    }
  }
  for (const c of candidates) {
    const v = (c as Record<string, unknown>).mockGames;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

const providerColors: Record<string, string> = {
  neuralwatt: '#60a5fa',
  openrouter: '#a78bfa',
};

export function getProviderColor(provider: string): string {
  const key = provider.toLowerCase();
  return providerColors[key] || '#9ca3af';
}

// DF-MAFIA-AI-BENCHMARK-14: GET /api/v1/benchmark/compare returns the
// { success, data: { models, headToHead, trends } } envelope; fetchAPI
// already unwraps it, so accept both the raw envelope and the bare data
// payload here. Anything that does not carry a models array yields zero
// rows — rows are never fabricated.
export function normalizeCompareModels(payload: unknown): CompareModelRow[] {
  if (Array.isArray(payload)) {
    return sanitizeRows(payload);
  }
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  if ('data' in obj && obj.data && typeof obj.data === 'object') {
    return sanitizeRows((obj.data as Record<string, unknown>).models);
  }
  if ('models' in obj) {
    return sanitizeRows(obj.models);
  }
  return [];
}

function sanitizeRows(models: unknown): CompareModelRow[] {
  if (!Array.isArray(models)) return [];
  return models.filter(
    (m): m is CompareModelRow =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as CompareModelRow).model === 'string' &&
      typeof (m as CompareModelRow).provider === 'string',
  );
}

// Leaderboard order: most games played first (wins as tiebreak).
export function sortLeaderboardRows(rows: CompareModelRow[]): CompareModelRow[] {
  return [...rows].sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.wins - a.wins);
}

function formatBreakdownEntry(entry: CompareBreakdownEntry): string {
  return `${entry.gamesPlayed} games, ${entry.wins} wins (${(entry.winRate * 100).toFixed(1)}%)`;
}

function formatPlayerCountLabel(playerCount: string): string {
  return playerCount === 'unknown' ? 'unknown player count' : `${playerCount}-player`;
}

/**
 * DF-39-R3: the seat caveat gate. The caveat renders whenever the blended
 * win rate could mislead a reader into hearing per-seat skill:
 *   - the dominant bucket covers >= 0.9 of gamesPlayed (the original arm),
 *   - OR an explicit uncovered remainder exists (games the server counted
 *     in gamesPlayed but which carry no seat data at all — the mini
 *     4382/3729 case), i.e. the split is seat-INCOMPLETE even when no
 *     single bucket dominates,
 *   - OR the share is unknown (no gamesWithoutPlayerCount declared by an
 *     older backend) while a dominant bucket exists.
 * A row with buckets reconciling fully and no dominant bucket stays
 * silent — a mixed seat profile needs no caveat.
 */
function seatCaveatFor(
  m: Pick<CompareModelRow, 'byNumPlayers' | 'gamesPlayed' | 'gamesWithoutPlayerCount'>,
): { label: string; share: number; unattributed: number } | undefined {
  if (m.gamesPlayed <= 0) return undefined;

  const dominant = Object.entries(m.byNumPlayers ?? {}).reduce<
    [string, CompareBreakdownEntry] | undefined
  >((current, entry) => {
    if (!current || entry[1].gamesPlayed > current[1].gamesPlayed) return entry;
    return current;
  }, undefined);

  // Explicit remainder declared by the server (absent = older backend).
  const unattributed =
    typeof m.gamesWithoutPlayerCount === 'number' &&
    Number.isFinite(m.gamesWithoutPlayerCount) &&
    m.gamesWithoutPlayerCount > 0
      ? m.gamesWithoutPlayerCount
      : 0;

  if (!dominant) return unattributed > 0 ? { label: '', share: 0, unattributed } : undefined;

  const share = dominant[1].gamesPlayed / m.gamesPlayed;
  // Render when the dominant seat dominates OR the tail is unexplained —
  // both make the blended rate unreliable as a skill read.
  if (share < 0.9 && unattributed === 0) return undefined;
  return { label: formatPlayerCountLabel(dominant[0]), share, unattributed };
}

/**
 * DF-39-R3: wording for the seat caveat. The share clause renders only
 * when a dominant bucket exists (share > 0); the unattributed clause
 * renders only when the server declared a positive remainder — so the
 * sentence always explains exactly why the blended rate can mislead.
 */
function seatCaveatText(caveat: {
  label: string;
  share: number;
  unattributed: number;
}): string {
  const parts: string[] = [];
  if (caveat.share > 0) {
    parts.push(
      `Headline win rate reflects seat assignment: ${(caveat.share * 100).toFixed(1)}% of games used ${caveat.label} seats.`,
    );
  }
  if (caveat.unattributed > 0) {
    parts.push(
      `${caveat.unattributed} games without seat data are excluded from the player-count split.`,
    );
  }
  return parts.join(' ');
}

interface BenchmarkLeaderboardProps {
  /** Raw compare payload: envelope or unwrapped data shape. */
  payload: unknown;
  loading: boolean;
}

const BenchmarkLeaderboard: React.FC<BenchmarkLeaderboardProps> = ({ payload, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
      </div>
    );
  }

  const rows = sortLeaderboardRows(normalizeCompareModels(payload));
  // DF-MAFIA-AI-BENCHMARK-12: mock games the report EXCLUDED — flagged
  // here so a placeholder-key install cannot pass as real benchmark data.
  const mockGames = extractMockGamesCount(payload);

  if (rows.length === 0) {
    return (
      <div className="text-center text-[var(--color-text-muted)] py-12">
        {mockGames !== undefined && mockGames > 0 ? (
          <p data-testid="mock-games-note">
            {mockGames} mock game(s) excluded (every provider call fell back to canned mock)
          </p>
        ) : null}
        No model data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {mockGames !== undefined && mockGames > 0 ? (
        <p
          className="text-[var(--color-text-muted)] text-xs mb-2"
          data-testid="mock-games-note"
        >
          {mockGames} mock game(s) excluded (every provider call fell back to canned mock)
        </p>
      ) : null}
      <table className="w-full border-collapse text-sm" data-testid="model-leaderboard">
        <thead>
          <tr>
            <th className="text-left py-2 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Model
            </th>
            <th className="text-right py-2 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Games
            </th>
            <th className="text-right py-2 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Wins
            </th>
            <th className="text-right py-2 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Win Rate
            </th>
            <th className="text-right py-2 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Avg Tokens/Game
            </th>
            <th className="text-right py-2 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
              Avg Cost/Game
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const roleEntries = Object.entries(m.rolePerformance ?? {});
            const playerCountEntries = Object.entries(m.byNumPlayers ?? {});
            // DF-39-R3: gate on seat-domination OR an explicit uncovered
            // remainder (the live openai/gpt-4o-mini shape: dominant share
            // 0.828 but 653 of 4382 games carry no seat data).
            const dominant = seatCaveatFor(m);
            const hasBreakdown = roleEntries.length > 0 || playerCountEntries.length > 0;

            return (
              <React.Fragment key={`${m.provider}/${m.model}`}>
                <tr className="border-b border-[var(--color-border)]">
                  <td className="py-2 px-2 text-[var(--color-text)] whitespace-nowrap">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: getProviderColor(m.provider) }}
                    />
                    <span className="font-medium">{m.provider}</span>
                    <span className="text-[var(--color-text-muted)]">/{m.model}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-[var(--color-text-secondary)]">{m.gamesPlayed}</td>
                  <td className="py-2 px-2 text-right text-[var(--color-text-secondary)]">{m.wins}</td>
                  <td className="py-2 px-2 text-right text-[var(--color-text-secondary)]">
                    {(m.winRate * 100).toFixed(1)}%
                  </td>
                  {/* Live data can carry real zeros here — render them as-is, never as '—'. */}
                  <td className="py-2 px-2 text-right text-[var(--color-text-secondary)]">
                    {m.avgTokensPerGame ?? '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-[var(--color-text-secondary)]">
                    {m.avgCostPerGame !== undefined ? `$${m.avgCostPerGame.toFixed(4)}` : '—'}
                  </td>
                </tr>
                {/* DF-39-R3: the breakdown row also carries the seat caveat
                    for usage-only rows (empty maps but a declared
                    gamesWithoutPlayerCount) — caveat presence no longer
                    rides on breakdown richness. */}
                {hasBreakdown || dominant ? (
                  <tr className="border-b border-[var(--color-border)]">
                    <td
                      className="py-2 px-2 text-[var(--color-text-secondary)] text-xs"
                      colSpan={6}
                      data-testid={`model-breakdown-${m.provider}-${m.model}`}
                    >
                      <div className="grid gap-1 md:grid-cols-2">
                        {roleEntries.length > 0 ? (
                          <div>
                            <span className="font-semibold">Role breakdown:</span>{' '}
                            {roleEntries.map(([role, entry]) => (
                              <span className="mr-3" key={role}>
                                {role}: {formatBreakdownEntry(entry)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {playerCountEntries.length > 0 ? (
                          <div>
                            <span className="font-semibold">Player-count breakdown:</span>{' '}
                            {playerCountEntries.map(([playerCount, entry]) => (
                              <span className="mr-3" key={playerCount}>
                                {formatPlayerCountLabel(playerCount)}: {formatBreakdownEntry(entry)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {/* DF-39-R3: the note NAMES the model it qualifies
                            (row-level caveat, not a page-level banner), and
                            names the seat-incomplete remainder when the
                            server declared one. */}
                        {dominant ? (
                          <p className="md:col-span-2" data-testid={`seat-assignment-note-${m.provider}-${m.model}`}>
                            <strong>{m.provider}/{m.model}</strong>{' '}
                            {seatCaveatText(dominant)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default BenchmarkLeaderboard;