import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useGameStore } from './stores/gameStore';
import { useUIStore } from './stores/uiStore';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import GameList from './components/GameList';
import GameBoard from './components/GameBoard';
import GameWatcher from './components/GameWatcher';
import StatsPanel from './components/StatsPanel';
import Settings from './components/Settings';
import Loading from './components/Loading';

function App() {
  const { initialize, connected } = useGameStore();
  const { darkMode, sidebarOpen } = useUIStore();
  
  useEffect(() => {
    initialize();
  }, [initialize]);
  
  useEffect(() => {
    // Apply dark mode
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);
  
  if (!connected) {
    return <Loading message="Connecting to server..." />;
  }
  
  return (
    <div className="app">
      <Header />
      <div className="app-body">
        <Sidebar />
        <main className={`main-content ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
          <Routes>
            <Route path="/" element={<GameList />} />
            <Route path="/game/:gameId" element={<GameBoard />} />
            <Route path="/watch/:gameId" element={<GameWatcher />} />
            <Route path="/stats" element={<StatsPanel />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
