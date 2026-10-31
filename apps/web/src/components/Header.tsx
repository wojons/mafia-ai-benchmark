import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUIStore } from '../stores/uiStore';
import { useGameStore } from '../stores/gameStore';

const Header: React.FC = () => {
  const location = useLocation();
  const { darkMode, toggleDarkMode, sidebarOpen, toggleSidebar } = useUIStore();
  // DF-MAFIA-AI-BENCHMARK-32-R2: the chrome counters read the authoritative
  // /stats headline totals (the same source the Games tab and the Stats tab
  // already use), not the old never-populated `stats` slice that was deleted.
  const { connected, headlineStats, fetchHeadlineStats } = useGameStore();

  // The Header is persistent chrome on EVERY route, so unlike GameList it
  // cannot rely on a sibling tab having fetched the totals: it fetches them
  // itself on mount. Fail-soft — fetchHeadlineStats keeps the previous
  // value (placeholders) on error.
  useEffect(() => {
    fetchHeadlineStats();
  }, [fetchHeadlineStats]);
  
  const navItems = [
    { path: '/', label: 'Games', icon: '🎮' },
    { path: '/stats', label: 'Stats', icon: '📊' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ];
  
  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-toggle" onClick={toggleSidebar} aria-label="Toggle sidebar">
          {sidebarOpen ? '◀' : '▶'}
        </button>
        
        <Link to="/" className="logo">
          <span className="logo-icon">🎭</span>
          <span className="logo-text">Mafia AI</span>
        </Link>
      </div>
      
      <nav className="header-nav">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </Link>
        ))}
      </nav>
      
      <div className="header-right">
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          <span className="status-text">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        
        <div className="stats-summary">
          {/* DF-MAFIA-AI-BENCHMARK-32-R2: live totals from GET /api/v1/stats
              (via gameStore.headlineStats). '—' = no /stats data yet, never
              an invented 0. */}
          <span className="stat" title="Active Games">
            🎮 {headlineStats ? headlineStats.activeGames : '—'}
          </span>
          <span className="stat" title="Total Games">
            📈 {headlineStats ? headlineStats.totalGames : '—'}
          </span>
        </div>
        
        <button
          className="theme-toggle"
          onClick={toggleDarkMode}
          aria-label="Toggle dark mode"
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  );
};

export default Header;
