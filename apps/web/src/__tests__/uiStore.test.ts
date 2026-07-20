import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide localStorage mock so zustand persist middleware works cleanly
const localStore: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStore[key] ?? null,
  setItem: (key: string, value: string) => { localStore[key] = value; },
  removeItem: (key: string) => { delete localStore[key]; },
  clear: () => { Object.keys(localStore).forEach(k => { delete localStore[k]; }); },
  get length() { return Object.keys(localStore).length; },
  key: (i: number) => Object.keys(localStore)[i] ?? null,
});

import { useUIStore } from '../stores/uiStore';

const stateInitial = {
  darkMode: false,
  sidebarOpen: true,
  sidebarCollapsed: false,
  showChatPanel: true,
  showVotePanel: true,
  showStatsPanel: false,
  showPlayerList: true,
  viewMode: '2d' as const,
  layout: 'comfortable' as const,
  notifications: [],
  searchQuery: '',
  searchFilters: {},
  settings: {
    enableAnimations: true,
    enableSound: false,
    voiceVolume: 0.5,
    autoScroll: true,
    showTimestamps: true,
    compactMode: false,
  },
};

describe('UIStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useUIStore.setState(stateInitial);
  });

  it('has correct initial state defaults', () => {
    const { darkMode, sidebarOpen, sidebarCollapsed, viewMode, notifications } = useUIStore.getState();
    expect(darkMode).toBe(false);
    expect(sidebarOpen).toBe(true);
    expect(sidebarCollapsed).toBe(false);
    expect(viewMode).toBe('2d');
    expect(notifications).toEqual([]);
  });

  it('toggleDarkMode flips darkMode boolean', () => {
    useUIStore.getState().toggleDarkMode();
    expect(useUIStore.getState().darkMode).toBe(true);

    // Toggling again returns to false
    useUIStore.getState().toggleDarkMode();
    expect(useUIStore.getState().darkMode).toBe(false);
  });

  it('toggleSidebar flips sidebarOpen', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('toggleSidebarCollapse flips sidebarCollapsed', () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    useUIStore.getState().toggleSidebarCollapse();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it('setViewMode updates viewMode to the given value', () => {
    useUIStore.getState().setViewMode('3d');
    expect(useUIStore.getState().viewMode).toBe('3d');
  });

  it('addNotification adds notification with id and timestamp', () => {
    useUIStore.getState().addNotification({
      type: 'info',
      message: 'Test notification',
    });

    const { notifications } = useUIStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('info');
    expect(notifications[0].message).toBe('Test notification');
    expect(typeof notifications[0].id).toBe('string');
    expect(notifications[0].id.length).toBeGreaterThan(0);
    expect(typeof notifications[0].timestamp).toBe('number');
  });

  it('removeNotification removes the notification by id', () => {
    useUIStore.getState().addNotification({ type: 'warning', message: 'Warning' });
    const first = useUIStore.getState().notifications[0];

    useUIStore.getState().removeNotification(first.id);
    expect(useUIStore.getState().notifications).toHaveLength(0);
  });

  it('updateSettings merges partial settings without dropping existing keys', () => {
    useUIStore.getState().updateSettings({ enableSound: true, compactMode: true });

    const { settings } = useUIStore.getState();
    expect(settings.enableSound).toBe(true);
    expect(settings.compactMode).toBe(true);
    // Existing keys must be preserved
    expect(settings.enableAnimations).toBe(true);
    expect(settings.voiceVolume).toBe(0.5);
    expect(settings.autoScroll).toBe(true);
    expect(settings.showTimestamps).toBe(true);
  });

  it('resetUI returns all state to defaults', () => {
    // Mutate several values away from defaults
    useUIStore.getState().toggleDarkMode();
    useUIStore.getState().toggleSidebar();
    useUIStore.getState().setViewMode('3d');

    useUIStore.getState().resetUI();

    const state = useUIStore.getState();
    expect(state.darkMode).toBe(false);
    expect(state.sidebarOpen).toBe(true);
    expect(state.viewMode).toBe('2d');
    expect(state.layout).toBe('comfortable');
    expect(state.notifications).toEqual([]);
  });
});
