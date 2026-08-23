import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useGameStore } from './stores/gameStore';
import { useUIStore } from './stores/uiStore';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import GameList from './components/GameList';
import GameBoard from './components/GameBoard';
import GameWatcher from './components/GameWatcher';
import StatsPanel from './components/StatsPanel';
import BenchmarkDashboard from './components/BenchmarkDashboard';
import Settings from './components/Settings';
import Loading from './components/Loading';
import SplitPaneView from './components/SplitPaneView';
import TimelineView from './components/TimelineView';
// ThreeDViz pulls in three.js (~720 kB minified) — lazy-load so the /3d
// route's chunk is only fetched when the route is actually visited.
const ThreeDViz = lazy(() => import('./components/ThreeDViz'));

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
          <Suspense fallback={<Loading message="Loading view..." />}>
          <Routes>
            <Route path="/" element={<GameList />} />
            <Route path="/game/:gameId" element={<GameBoard />} />
            <Route path="/watch/:gameId" element={<GameWatcher />} />
            <Route path="/observe/:gameId" element={<SplitPaneView />} />
            <Route path="/timeline/:gameId" element={<TimelineView />} />
            <Route path="/3d/:gameId" element={<ThreeDViz />} />
            <Route path="/stats" element={<BenchmarkDashboard />} />
            <Route path="/benchmark" element={<BenchmarkDashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default App;
