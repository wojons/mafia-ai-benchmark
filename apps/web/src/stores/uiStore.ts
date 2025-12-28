import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIStoreState {
  // Theme
  darkMode: boolean;
  toggleDarkMode: () => void;
  
  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  toggleSidebarCollapse: () => void;
  
  // Panel visibility
  showChatPanel: boolean;
  showVotePanel: boolean;
  showStatsPanel: boolean;
  showPlayerList: boolean;
  toggleChatPanel: () => void;
  toggleVotePanel: () => void;
  toggleStatsPanel: () => void;
  togglePlayerList: () => void;
  
  // View mode
  viewMode: '2d' | '3d';
  setViewMode: (mode: '2d' | '3d') => void;
  
  // Layout
  layout: 'compact' | 'comfortable' | 'spacious';
  setLayout: (layout: 'compact' | 'comfortable' | 'spacious') => void;
  
  // Notifications
  notifications: Array<{
    id: string;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    timestamp: number;
  }>;
  addNotification: (notification: Omit<UIStoreState['notifications'][0], 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchFilters: Record<string, unknown>;
  setSearchFilters: (filters: Record<string, unknown>) => void;
  
  // Settings
  settings: {
    enableAnimations: boolean;
    enableSound: boolean;
    voiceVolume: number;
    autoScroll: boolean;
    showTimestamps: boolean;
    compactMode: boolean;
  };
  updateSettings: (settings: Partial<UIStoreState['settings']>) => void;
  
  // Reset
  resetUI: () => void;
}

const defaultSettings = {
  enableAnimations: true,
  enableSound: false,
  voiceVolume: 0.5,
  autoScroll: true,
  showTimestamps: true,
  compactMode: false,
};

export const useUIStore = create<UIStoreState>()(
  persist(
    (set, get) => ({
      // Theme
      darkMode: false,
      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
      
      // Sidebar
      sidebarOpen: true,
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleSidebarCollapse: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      // Panel visibility
      showChatPanel: true,
      showVotePanel: true,
      showStatsPanel: false,
      showPlayerList: true,
      toggleChatPanel: () => set((state) => ({ showChatPanel: !state.showChatPanel })),
      toggleVotePanel: () => set((state) => ({ showVotePanel: !state.showVotePanel })),
      toggleStatsPanel: () => set((state) => ({ showStatsPanel: !state.showStatsPanel })),
      togglePlayerList: () => set((state) => ({ showPlayerList: !state.showPlayerList })),
      
      // View mode
      viewMode: '2d',
      setViewMode: (mode) => set({ viewMode: mode }),
      
      // Layout
      layout: 'comfortable',
      setLayout: (layout) => set({ layout }),
      
      // Notifications
      notifications: [],
      addNotification: (notification) => {
        const id = crypto.randomUUID();
        set((state) => ({
          notifications: [
            ...state.notifications,
            { ...notification, id, timestamp: Date.now() },
          ],
        }));
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
          get().removeNotification(id);
        }, 5000);
      },
      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
      clearNotifications: () => set({ notifications: [] }),
      
      // Search
      searchQuery: '',
      setSearchQuery: (query) => set({ searchQuery: query }),
      searchFilters: {},
      setSearchFilters: (filters) => set({ searchFilters: filters }),
      
      // Settings
      settings: defaultSettings,
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
      
      // Reset
      resetUI: () =>
        set({
          darkMode: false,
          sidebarOpen: true,
          sidebarCollapsed: false,
          showChatPanel: true,
          showVotePanel: true,
          showStatsPanel: false,
          showPlayerList: true,
          viewMode: '2d',
          layout: 'comfortable',
          searchQuery: '',
          searchFilters: {},
          settings: defaultSettings,
        }),
    }),
    {
      name: 'mafia-ui-storage',
      partialize: (state) => ({
        darkMode: state.darkMode,
        sidebarCollapsed: state.sidebarCollapsed,
        showChatPanel: state.showChatPanel,
        showVotePanel: state.showVotePanel,
        showStatsPanel: state.showStatsPanel,
        showPlayerList: state.showPlayerList,
        viewMode: state.viewMode,
        layout: state.layout,
        settings: state.settings,
      }),
    }
  )
);

export default useUIStore;
