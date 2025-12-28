import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUIStore } from '../stores/uiStore';
import { useGameStore } from '../stores/gameStore';

const Header: React.FC = () => {
  const location = useLocation();
  const { darkMode, toggleDarkMode, sidebarOpen, toggleSidebar } = useUIStore();
  const { connected, stats } = useGameStore();
  
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
          <span className="stat" title="Active Games">
            🎮 {stats.activeGames}
          </span>
          <span className="stat" title="Total Games">
            📈 {stats.totalGames}
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
