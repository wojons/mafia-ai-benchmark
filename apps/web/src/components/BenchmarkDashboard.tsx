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
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { statsAPI, gamesAPI } from '../services/api';
import { formatDistanceToNow } from 'date-fns';

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

interface ModelData {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
}

interface MatchupData {
  modelA: string;
  modelB: string;
  gamesPlayed: number;
  modelAWins: number;
  modelBWins: number;
  ties: number;
}

interface GameRecord {
  id: string;
  status: string;
  players: number;
  createdAt: string;
  config: Record<string, unknown>;
}

const providerColors: Record<string, string> = {
  neuralwatt: '#60a5fa',
  openrouter: '#a78bfa',
};

function getProviderColor(provider: string): string {
  const key = provider.toLowerCase();
  return providerColors[key] || '#9ca3af';
}

function formatDuration(ms: number): string {
  if (!ms || isNaN(ms) || ms <= 0) return '\u2014';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function getWinner(game: GameRecord): string {
  const cfg = game.config || {};
  return (cfg.winner as string) || 'Unknown';
}

function getPlayers(game: GameRecord): string {
  const cfg = game.config || {};
  const names = cfg.playerNames as string[] | undefined;
  if (names && names.length > 0) return names.join(', ');
  return `${game.players} players`;
}

const BenchmarkDashboard: React.FC = () => {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelData[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [matchups, setMatchups] = useState<MatchupData[]>([]);
  const [matchupsLoading, setMatchupsLoading] = useState(true);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  useEffect(() => {
    statsAPI.getGameStats().then((res) => setStats((res as Record<string, unknown>).data as GameStats || res as GameStats)).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    statsAPI
      .getModelComparison()
      .then((res) => {
        const data = (res as unknown as Record<string, unknown>).data || res;
        const arr = Array.isArray(data) ? data : ((data as unknown as Record<string, unknown>).data as ModelData[]) || [];
        setModels(arr);
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
        const arr = Array.isArray(data) ? data : [];
        setGames(arr);
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

  const sortedModels = [...models].sort((a, b) => b.winRate - a.winRate);
  const barData = {
    labels: sortedModels.map((m) => m.model.length > 22 ? m.model.substring(0, 20) + '…' : m.model),
    datasets: [
      {
        label: 'Win Rate %',
        data: sortedModels.map((m) => m.winRate),
        backgroundColor: sortedModels.map((m) => getProviderColor(m.provider)),
        borderRadius: 4,
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

  const barOptions = {
    ...chartOptions,
    indexAxis: 'y' as const,
    scales: {
      x: {
        max: 100,
        ticks: { color: 'var(--color-text-muted)', callback: (v: unknown) => `${v}%` },
        grid: { color: 'var(--color-border)' },
      },
      y: {
        ticks: { color: 'var(--color-text-secondary)', font: { size: 11 } },
        grid: { display: false },
      },
    },
    plugins: {
      ...chartOptions.plugins,
      tooltip: {
        callbacks: {
          label: (ctx: { raw: unknown; dataIndex: number }) => {
            const m = sortedModels[ctx.dataIndex];
            return [`Win Rate: ${(ctx.raw as number).toFixed(1)}%`, `Games: ${m.gamesPlayed}`, `Wins: ${m.wins}`];
          },
        },
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
            <span className="text-[28px] font-bold">{formatDuration(stats.avgDuration)}</span>
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

        {/* Model Leaderboard */}
        <div className="bg-[var(--color-bg)] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Model Leaderboard</h2>
          {modelsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
            </div>
          ) : sortedModels.length > 0 ? (
            <div className="h-[280px]">
              <Bar data={barData} options={barOptions} />
            </div>
          ) : (
            <div className="text-center text-[var(--color-text-muted)] py-12">
              No model data available
            </div>
          )}
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
        {gamesLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
          </div>
        ) : completedGames.length > 0 ? (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="text-left py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
                    Game ID
                  </th>
                  <th className="text-left py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
                    Players
                  </th>
                  <th className="text-center py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
                    Winner
                  </th>
                  <th className="text-right py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
                    Duration
                  </th>
                  <th className="text-right py-3 px-2 font-semibold border-b-2 border-[var(--color-border)] whitespace-nowrap">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {completedGames.map((g) => {
                  const winner = getWinner(g);
                  const duration = (g.config?.duration as number) || 0;
                  return (
                    <tr key={g.id} className="border-b border-[var(--color-border)]">
                      <td className="py-3 px-2 font-mono text-xs text-[var(--color-text-muted)]">
                        {g.id.substring(0, 8)}
                      </td>
                      <td className="py-3 px-2 text-[var(--color-text-secondary)]">{getPlayers(g)}</td>
                      <td className="py-3 px-2 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            winner === 'Mafia'
                              ? 'bg-[rgba(239,68,68,0.1)] text-[var(--color-danger)]'
                              : winner === 'Town'
                              ? 'bg-[rgba(34,197,94,0.1)] text-[var(--color-success)]'
                              : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]'
                          }`}
                        >
                          {winner}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right text-[var(--color-text-secondary)]">
                        {duration > 0 ? formatDuration(duration) : '\u2014'}
                      </td>
                      <td className="py-3 px-2 text-right text-xs text-[var(--color-text-muted)]">
                        {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-[var(--color-text-muted)] py-12">
            No completed games yet
          </div>
        )}
      </div>
    </div>
  );
};

export default BenchmarkDashboard;
