import React from 'react';

export interface CompareModelRow {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokensPerGame?: number;
  avgCostPerGame?: number;
  avgLatency?: number;
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

  if (rows.length === 0) {
    return (
      <div className="text-center text-[var(--color-text-muted)] py-12">
        No model data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
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
          {rows.map((m) => (
            <tr key={`${m.provider}/${m.model}`} className="border-b border-[var(--color-border)]">
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
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default BenchmarkLeaderboard;