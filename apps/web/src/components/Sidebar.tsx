import React from 'react';
import { Link } from 'react-router-dom';
import { useUIStore } from '../stores/uiStore';

const Sidebar: React.FC = () => {
  const { sidebarOpen, sidebarCollapsed, toggleSidebarCollapse } = useUIStore();
  
  if (!sidebarOpen) return null;
  
  const quickActions = [
    { path: '/?action=new', label: 'New Game', icon: '➕', color: 'green' },
    { path: '/benchmark', label: 'Benchmark', icon: '📊', color: 'blue' },
    { path: '/settings', label: 'Settings', icon: '⚙️', color: 'gray' },
  ];
  
  const helpItems = [
    { label: 'How to Play', icon: '❓', action: () => console.log('Help') },
    { label: 'Keyboard Shortcuts', icon: '⌨️', action: () => console.log('Shortcuts') },
    { label: 'About', icon: 'ℹ️', action: () => console.log('About') },
  ];
  
  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-content">
        {/* Quick Actions */}
        <div className="sidebar-section">
          <h3 className="section-title">Quick Actions</h3>
          <div className="action-list">
            {quickActions.map((action) => (
              <Link
                key={action.path}
                to={action.path}
                className={`action-item color-${action.color}`}
              >
                <span className="action-icon">{action.icon}</span>
                <span className="action-label">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
        
        {/* Game Controls */}
        <div className="sidebar-section">
          <h3 className="section-title">Game Controls</h3>
          <div className="control-list">
            <button className="control-item" onClick={toggleSidebarCollapse}>
              <span className="control-icon">
                {sidebarCollapsed ? '📤' : '📥'}
              </span>
              <span className="control-label">
                {sidebarCollapsed ? 'Expand' : 'Collapse'}
              </span>
            </button>
          </div>
        </div>
        
        {/* Help */}
        <div className="sidebar-section">
          <h3 className="section-title">Help</h3>
          <div className="help-list">
            {helpItems.map((item, index) => (
              <button
                key={index}
                className="help-item"
                onClick={item.action}
              >
                <span className="help-icon">{item.icon}</span>
                <span className="help-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        
        {/* Footer Info */}
        <div className="sidebar-footer">
          <div className="version">v1.0.0</div>
          <div className="links">
            <a href="https://github.com/wojons/mafia-ai-benchmark" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <span>•</span>
            <a href="https://github.com/wojons/mafia-ai-benchmark/issues" target="_blank" rel="noopener noreferrer">
              Issues
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
