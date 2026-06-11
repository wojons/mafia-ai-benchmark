import React, { useEffect, useState } from 'react';
import { statsAPI } from '../services/api';

interface ModelDataItem {
  provider: string;
  model: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgTokens: number;
  avgCost: number;
  avgLatency?: number;
}

interface BenchmarkReportData {
  summary?: string;
  recommendations?: string[];
  [key: string]: unknown;
}

const StatsPanel: React.FC = () => {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelDataItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [report, setReport] = useState<BenchmarkReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await statsAPI.getGameStats();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const data = await statsAPI.getModelComparison();
        const modelData = Array.isArray(data)
          ? data
          : ((data as Record<string, unknown>).data as ModelDataItem[]) || [];
        setModels(modelData);
      } catch (error) {
        console.error('Failed to fetch model comparison:', error);
      } finally {
        setModelsLoading(false);
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const data = await statsAPI.generateReport();
        setReport(data as BenchmarkReportData);
      } catch (error) {
        console.error('Failed to fetch benchmark report:', error);
      } finally {
        setReportLoading(false);
      }
    };

    fetchReport();
  }, []);

  if (loading) {
    return (
      <div className="stats-page">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>Loading statistics...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="stats-page">
        <div className="empty-state">
          <h2>No statistics available</h2>
          <p>Play some games to see statistics</p>
        </div>
      </div>
    );
  }

  const s = stats as {
    totalGames: number;
    activeGames: number;
    completedGames: number;
    mafiaWins: number;
    townWins: number;
    avgDuration: number;
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const formatNumber = (n: number) => n.toLocaleString();

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    if (cost < 1) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatLatency = (ms?: number) => {
    if (ms === undefined || ms === null) return '\u2014';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  const thStyle: React.CSSProperties = {
    padding: '0.75rem 0.5rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    borderBottom: '2px solid var(--border-color, #333)',
    textAlign: 'left',
  };

  const thCenter: React.CSSProperties = {
    ...thStyle,
    textAlign: 'center',
  };

  const thRight: React.CSSProperties = {
    ...thStyle,
    textAlign: 'right',
  };

  const tdStyle: React.CSSProperties = {
    padding: '0.75rem 0.5rem',
    verticalAlign: 'middle',
    borderBottom: '1px solid var(--border-color, #333)',
  };

  const tdCenter: React.CSSProperties = {
    ...tdStyle,
    textAlign: 'center',
  };

  const tdRight: React.CSSProperties = {
    ...tdStyle,
    textAlign: 'right',
  };

  return (
    <div className="stats-page">
      <div className="page-header">
        <h1>📊 Statistics</h1>
        <p>Game and model performance metrics</p>
      </div>

      {/* Overview Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🎮</div>
          <div className="stat-content">
            <span className="stat-value">{s.totalGames}</span>
            <span className="stat-label">Total Games</span>
          </div>
        </div>

        <div className="stat-card green">
          <div className="stat-icon">🟢</div>
          <div className="stat-content">
            <span className="stat-value">{s.activeGames}</span>
            <span className="stat-label">Active Games</span>
          </div>
        </div>

        <div className="stat-card blue">
          <div className="stat-icon">🏁</div>
          <div className="stat-content">
            <span className="stat-value">{s.completedGames}</span>
            <span className="stat-label">Completed</span>
          </div>
        </div>

        <div className="stat-card red">
          <div className="stat-icon">🎭</div>
          <div className="stat-content">
            <span className="stat-value">{s.mafiaWins}</span>
            <span className="stat-label">Mafia Wins</span>
          </div>
        </div>

        <div className="stat-card blue">
          <div className="stat-icon">🏛️</div>
          <div className="stat-content">
            <span className="stat-value">{s.townWins}</span>
            <span className="stat-label">Town Wins</span>
          </div>
        </div>

        <div className="stat-card purple">
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <span className="stat-value">{formatDuration(s.avgDuration)}</span>
            <span className="stat-label">Avg Duration</span>
          </div>
        </div>
      </div>

      {/* Win Rates */}
      <div className="stats-section">
        <h2>Win Rates</h2>
        <div className="win-rate-bars">
          {s.completedGames > 0 && (
            <>
              <div className="win-rate-bar">
                <div className="bar-label">Mafia</div>
                <div className="bar-container">
                  <div
                    className="bar-fill red"
                    style={{ width: `${(s.mafiaWins / s.completedGames) * 100}%` }}
                  />
                </div>
                <div className="bar-value">
                  {((s.mafiaWins / s.completedGames) * 100).toFixed(1)}%
                </div>
              </div>

              <div className="win-rate-bar">
                <div className="bar-label">Town</div>
                <div className="bar-container">
                  <div
                    className="bar-fill blue"
                    style={{ width: `${(s.townWins / s.completedGames) * 100}%` }}
                  />
                </div>
                <div className="bar-value">
                  {((s.townWins / s.completedGames) * 100).toFixed(1)}%
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Model Performance */}
      <div className="stats-section">
        <h2>Model Performance</h2>
        <p className="section-hint">
          Top performing AI models in Mafia games
        </p>
        {modelsLoading ? (
          <div className="loading-container" style={{ padding: '2rem' }}>
            <div className="loading-spinner" />
            <p>Loading model data...</p>
          </div>
        ) : models.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <p>No model performance data available yet</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Provider</th>
                  <th style={thStyle}>Model</th>
                  <th style={thCenter}>Games Played</th>
                  <th style={thCenter}>Wins</th>
                  <th style={thStyle}>Win Rate</th>
                  <th style={thRight}>Avg Tokens</th>
                  <th style={thRight}>Avg Cost</th>
                  <th style={thRight}>Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={`${m.provider}-${m.model}`}>
                    <td style={tdStyle}>{m.provider}</td>
                    <td style={tdStyle}>{m.model}</td>
                    <td style={tdCenter}>{formatNumber(m.gamesPlayed)}</td>
                    <td style={tdCenter}>{m.wins}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div
                          style={{
                            flex: 1,
                            height: '8px',
                            background: 'var(--border-color, #333)',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            maxWidth: '120px',
                          }}
                        >
                          <div
                            style={{
                              width: `${m.winRate}%`,
                              height: '100%',
                              background: 'var(--accent-color, #4f46e5)',
                              borderRadius: '4px',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                        <span>{m.winRate.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={tdRight}>{formatNumber(m.avgTokens)}</td>
                    <td style={tdRight}>{formatCost(m.avgCost)}</td>
                    <td style={tdRight}>{formatLatency(m.avgLatency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Benchmark Report */}
      <div className="stats-section">
        <h2>Benchmark Report</h2>
        <p className="section-hint">
          Summary of model benchmark results
        </p>
        {reportLoading ? (
          <div className="loading-container" style={{ padding: '2rem' }}>
            <div className="loading-spinner" />
            <p>Loading report...</p>
          </div>
        ) : report && (report.summary || report.recommendations) ? (
          <div style={{ marginTop: '1rem' }}>
            {report.summary && (
              <div style={{ padding: '1rem', borderRadius: '8px', marginBottom: '1rem', lineHeight: 1.6, background: 'var(--card-bg, rgba(255,255,255,0.05))' }}>
                <p>{report.summary}</p>
              </div>
            )}
            {report.recommendations && report.recommendations.length > 0 && (
              <div>
                <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 600 }}>Recommendations</h3>
                <ul style={{ paddingLeft: '1.5rem', lineHeight: 1.8 }}>
                  {report.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <p>No benchmark report available yet</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatsPanel;
