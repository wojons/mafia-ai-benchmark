import React from 'react';
import { useUIStore } from '../stores/uiStore';

const Settings: React.FC = () => {
  const { settings, updateSettings, darkMode, toggleDarkMode, resetUI } = useUIStore();
  
  const handleSettingChange = (key: string, value: unknown) => {
    updateSettings({ [key]: value });
  };
  
  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>⚙️ Settings</h1>
        <p>Configure your Mafia AI Benchmark experience</p>
      </div>
      
      {/* Appearance */}
      <div className="settings-section">
        <h2>🎨 Appearance</h2>
        
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-label">Dark Mode</span>
            <span className="setting-description">Use dark color scheme</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={darkMode}
              onChange={toggleDarkMode}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-label">Layout</span>
            <span className="setting-description">Choose interface density</span>
          </div>
          <select
            value={settings.compactMode ? 'compact' : 'comfortable'}
            onChange={(e) =>
              handleSettingChange('compactMode', e.target.value === 'compact')
            }
            className="select-input"
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
      </div>
      
      {/* Behavior */}
      <div className="settings-section">
        <h2>⚡ Behavior</h2>
        
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-label">Enable Animations</span>
            <span className="setting-description">Show transitions and effects</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enableAnimations}
              onChange={(e) =>
                handleSettingChange('enableAnimations', e.target.checked)
              }
            />
            <span className="toggle-slider" />
          </label>
        </div>
        
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-label">Auto-scroll</span>
            <span className="setting-description">Automatically scroll to new content</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.autoScroll}
              onChange={(e) => handleSettingChange('autoScroll', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-label">Show Timestamps</span>
            <span className="setting-description">Display time in messages</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.showTimestamps}
              onChange={(e) =>
                handleSettingChange('showTimestamps', e.target.checked)
              }
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
      
      {/* Audio */}
      <div className="settings-section">
        <h2>🔊 Audio</h2>
        
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-label">Enable Sound</span>
            <span className="setting-description">Play notification sounds</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enableSound}
              onChange={(e) => handleSettingChange('enableSound', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        
        {settings.enableSound && (
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-label">Volume</span>
              <span className="setting-description">Notification sound volume</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.voiceVolume * 100}
              onChange={(e) =>
                handleSettingChange('voiceVolume', e.target.value / 100)
              }
              className="range-input"
            />
            <span className="range-value">{Math.round(settings.voiceVolume * 100)}%</span>
          </div>
        )}
      </div>
      
      {/* Data */}
      <div className="settings-section">
        <h2>💾 Data</h2>
        
        <div className="setting-item danger">
          <div className="setting-info">
            <span className="setting-label">Reset Settings</span>
            <span className="setting-description">
              Restore all settings to defaults
            </span>
          </div>
          <button className="btn btn-danger" onClick={resetUI}>
            Reset
          </button>
        </div>
      </div>
      
      {/* About */}
      <div className="settings-section">
        <h2>ℹ️ About</h2>
        <div className="about-info">
          <p>
            <strong>Mafia AI Benchmark</strong> v1.0.0
          </p>
          <p>A multi-agent AI game benchmark with THINK vs SAYS split-pane consciousness</p>
          <p className="links">
            <a
              href="https://github.com/wojons/mafia-ai-benchmark"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <span>•</span>
            <a
              href="https://github.com/wojons/mafia-ai-benchmark/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report Issue
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
