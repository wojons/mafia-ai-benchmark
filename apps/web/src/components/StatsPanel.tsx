import React, { useEffect, useState } from 'react';
import { statsAPI } from '../services/api';

const StatsPanel: React.FC = () => {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  
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
        <button className="btn btn-primary">
          View Full Leaderboard →
        </button>
      </div>
    </div>
  );
};

export default StatsPanel;
