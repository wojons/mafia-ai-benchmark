import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import { statsAPI, gamesAPI, benchmarkAPI } from '../services/api';
import BenchmarkLeaderboard, {
  normalizeCompareModels,
  type CompareModelRow,
} from './BenchmarkLeaderboard';
import GameHistoryTable, {
  formatDuration,
  type GameHistoryRow,
} from './GameHistoryTable';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler
);

interface GameStats {
  totalGames: number;
  activeGames: number;
  completedGames: number;
  avgDuration: number;
  mafiaWins: number;
  townWins: number;
}

interface MatchupData {
  modelA: string;
  modelB: string;
  gamesPlayed: number;
  modelAWins: number;
  modelBWins: number;
  ties: number;
}

interface GameRecord extends GameHistoryRow {
  config: Record<string, unknown>;
  /** Detail-endpoint-only fields (present when this row was enriched). */
  startedAt?: string | null;
  gameOverAt?: string | null;
}

const BenchmarkDashboard: React.FC = () => {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<CompareModelRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [matchups, setMatchups] = useState<MatchupData[]>([]);
  const [matchupsLoading, setMatchupsLoading] = useState(true);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  useEffect(() => {
    statsAPI.getGameStats().then((res) => setStats((res as Record<string, unknown>).data as GameStats || res as GameStats)).catch(console.error).finally(() => setLoading(false));
  }, []);

  // DF-MAFIA-AI-BENCHMARK-14: the leaderboard is fed by the benchmark compare
  // endpoint, not /stats/models — the live list endpoint returns empty while
  // /benchmark/compare carries the real per-model aggregates.
  useEffect(() => {
    benchmarkAPI
      .compare()
      .then((report) => {
        setModels(normalizeCompareModels(report));
      })
      .catch(console.error)
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    statsAPI
      .getMatchups()
      .then((res) => {
        const data = (res as unknown as Record<string, unknown>).data || res;
        const arr = Array.isArray(data) ? data : ((data as unknown as Record<string, unknown>).data as MatchupData[]) || [];
        setMatchups(arr);
      })
      .catch(console.error)
      .finally(() => setMatchupsLoading(false));
  }, []);

  useEffect(() => {
    gamesAPI
      .getAll({ limit: 50 })
      .then((res) => {
        const data = (res as unknown as Record<string, unknown>).data || res;
        const arr = Array.isArray(data) ? (data as GameRecord[]) : [];
        // DF-MAFIA-AI-BENCHMARK-14: list rows carry createdAt only — an ended
        // game's endedAt comes from its detail endpoint (startedAt/gameOverAt
        // stay null on ended rows, so they are never the duration source).
        const ended = arr.filter((g) => g.status === 'ENDED');
        if (ended.length === 0) {
          setGames(arr);
          return;
        }
        return Promise.all(
          ended.map((g) =>
            gamesAPI
              .get(g.id)
              .then((detail) => {
                const d = detail as unknown as {
                  createdAt?: string | Date;
                  endedAt?: string | Date | null;
                };
                return {
                  id: g.id,
                  createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : g.createdAt,
                  endedAt: d.endedAt ? new Date(d.endedAt).toISOString() : null,
                };
              })
              .catch(() => ({ id: g.id, createdAt: g.createdAt, endedAt: null })),
          ),
        ).then((details) => {
          const byId = new Map(details.map((d) => [d.id, d]));
          setGames(
            arr.map((g) => {
              const d = byId.get(g.id);
              return d ? { ...g, createdAt: d.createdAt, endedAt: d.endedAt } : g;
            }),
          );
        });
      })
      .catch(console.error)
      .finally(() => setGamesLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-10 h-10 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
        <p className="text-[var(--color-text-secondary)]">Loading statistics...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--color-text-muted)]">
        <h2 className="text-xl text-[var(--color-text)] mb-2">No statistics available</h2>
        <p>Play some games to see statistics</p>
      </div>
    );
  }

  const winDoughnutData = {
    labels: ['Town Wins', 'Mafia Wins'],
    datasets: [
      {
        data: [stats.townWins, stats.mafiaWins],
        backgroundColor: ['#4ade80', '#f87171'],
        borderColor: ['#22c55e', '#ef4444'],
        borderWidth: 1,
      },
    ],
  };

  const hasMatchups = matchups.length > 0;
  const matchupLabels = matchups.map((m) => `${m.modelA} vs ${m.modelB}`);
  const lineData = {
    labels: matchupLabels,
    datasets: [
      {
        label: 'Model A Wins',
        data: matchups.map((m) => m.modelAWins),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.1)',
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Model B Wins',
        data: matchups.map((m) => m.modelBWins),
        borderColor: '#f87171',
        backgroundColor: 'rgba(248,113,113,0.1)',
        fill: true,
        tension: 0.3,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: 'var(--color-text-secondary)', font: { size: 12 } },
      },
    },
  };

  const lineOptions = {
    ...chartOptions,
    scales: {
      x: {
        ticks: { color: 'var(--color-text-muted)', font: { size: 10 } },
        grid: { color: 'var(--color-border)' },
      },
      y: {
        ticks: { color: 'var(--color-text-muted)', stepSize: 1 },
        grid: { color: 'var(--color-border)' },
      },
    },
  };

  const completedGames = games.filter((g) => g.status === 'ENDED');

  return (
    <div className="max-w-[1200px]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-[28px] font-bold">Benchmark Dashboard</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Game and model performance metrics</p>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="flex items-center gap-4 p-5 bg-[var(--color-bg)] rounded-xl">
          <span className="text-[32px]">🎮</span>
          <div className="flex flex-col">
            <span className="text-[28px] font-bold">{stats.totalGames}</span>
            <span className="text-xs text-[var(--color-text-muted)]">Total Games</span>
          </div>
        </div>
        <div className="flex items-center gap-4 p-5 bg-[var(--color-bg)] rounded-xl">
          <span className="text-[32px]">🏁</span>
          <div className="flex flex-col">
            <span className="text-[28px] font-bold">{stats.completedGames}</span>
            <span className="text-xs text-[var(--color-text-muted)]">Completed</span>
          </div>
        </div>
        <div className="flex items-center gap-4 p-5 bg-[rgba(239,68,68,0.05)] rounded-xl">
          <span className="text-[32px]">🎭</span>
          <div className="flex flex-col">
            <span className="text-[28px] font-bold">{stats.mafiaWins}</span>
            <span className="text-xs text-[var(--color-text-muted)]">Mafia Wins</span>
          </div>
        </div>
        <div className="flex items-center gap-4 p-5 bg-[rgba(34,197,94,0.05)] rounded-xl">
          <span className="text-[32px]">🏛️</span>
          <div className="flex flex-col">
            <span className="text-[28px] font-bold">{stats.townWins}</span>
            <span className="text-xs text-[var(--color-text-muted)]">Town Wins</span>
          </div>
        </div>
        <div className="flex items-center gap-4 p-5 bg-[rgba(139,92,246,0.05)] rounded-xl">
          <span className="text-[32px]">⏱️</span>
          <div className="flex flex-col">
            <span className="text-[28px] font-bold">{formatDuration(stats.avgDuration * 1000)}</span>
            <span className="text-xs text-[var(--color-text-muted)]">Avg Duration</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Win Distribution Doughnut */}
        <div className="bg-[var(--color-bg)] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Win Distribution</h2>
          {stats.completedGames > 0 ? (
            <div className="h-[280px] flex items-center justify-center">
              <Doughnut data={winDoughnutData} options={chartOptions} />
            </div>
          ) : (
            <div className="text-center text-[var(--color-text-muted)] py-12">
              No completed games yet
            </div>
          )}
        </div>

        {/* Model Leaderboard — fed by GET /api/v1/benchmark/compare (DF-MAFIA-AI-BENCHMARK-14) */}
        <div className="bg-[var(--color-bg)] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Model Leaderboard</h2>
          <BenchmarkLeaderboard payload={models} loading={modelsLoading} />
        </div>
      </div>

      {/* Head-to-Head Matchups */}
      <div className="bg-[var(--color-bg)] rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Head-to-Head Matchups</h2>
        {matchupsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
          </div>
        ) : hasMatchups ? (
          <div className="h-[300px]">
            <Line data={lineData} options={lineOptions} />
          </div>
        ) : (
          <div className="text-center text-[var(--color-text-muted)] py-12">
            Play more games to see matchups
          </div>
        )}
      </div>

      {/* Game History Table */}
      <div className="bg-[var(--color-bg)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Game History</h2>
        <GameHistoryTable games={completedGames} loading={gamesLoading} />
      </div>
    </div>
  );
};

export default BenchmarkDashboard;
