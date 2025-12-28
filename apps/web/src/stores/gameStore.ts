import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Game, GameState, Player, GameEvent, PlayerStats } from '@mafia/shared/types';
import { api } from '../services/api';
import { websocket } from '../services/websocket';

interface GameStoreState {
  // Connection state
  connected: boolean;
  connecting: boolean;
  
  // Games list
  games: Game[];
  selectedGameId: string | null;
  
  // Current game state
  currentGame: Game | null;
  gameState: GameState | null;
  players: Player[];
  
  // Events
  events: GameEvent[];
  
  // Player stats
  playerStats: Map<string, PlayerStats>;
  
  // Statistics
  stats: {
    totalGames: number;
    activeGames: number;
    mafiaWins: number;
    townWins: number;
  };
  
  // Actions
  initialize: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  
  // Game actions
  fetchGames: (filters?: { status?: string; limit?: number }) => Promise<void>;
  selectGame: (gameId: string) => Promise<void>;
  createGame: (config?: Record<string, unknown>) => Promise<Game>;
  joinGame: (gameId: string, playerName: string) => Promise<void>;
  startGame: (gameId: string) => Promise<void>;
  
  // Game state updates
  updateGameState: (state: GameState) => void;
  updatePlayers: (players: Player[]) => void;
  addEvent: (event: GameEvent) => void;
  updateStats: (stats: GameStoreState['stats']) => void;
  
  // Night actions
  submitNightAction: (gameId: string, playerId: string, action: string, targetId: string) => Promise<void>;
  
  // Voting
  submitVote: (gameId: string, voterId: string, targetId: string) => Promise<void>;
  
  // Accusations
  makeAccusation: (gameId: string, accuserId: string, targetId: string, accusation: string, evidence: string) => Promise<void>;
  
  // Role claims
  claimRole: (gameId: string, playerId: string, role: string) => Promise<void>;
  
  // Cleanup
  clearCurrentGame: () => void;
}

export const useGameStore = create<GameStoreState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    connected: false,
    connecting: false,
    games: [],
    selectedGameId: null,
    currentGame: null,
    gameState: null,
    players: [],
    events: [],
    playerStats: new Map(),
    stats: {
      totalGames: 0,
      activeGames: 0,
      mafiaWins: 0,
      townWins: 0,
    },
    
    // Initialize
    initialize: async () => {
      await get().connect();
      await get().fetchGames();
    },
    
    connect: async () => {
      const { connecting } = get();
      if (connecting || get().connected) return;
      
      set({ connecting: true });
      
      try {
        // Connect to WebSocket
        await websocket.connect();
        
        // Set up event listeners
        websocket.on('GAME_EVENT', (event) => {
          get().addEvent(event);
        });
        
        websocket.on('GAME_STATE', (data) => {
          if (data.state) {
            get().updateGameState(data.state);
          }
        });
        
        websocket.on('CONNECTED', () => {
          set({ connected: true, connecting: false });
        });
        
        websocket.on('DISCONNECTED', () => {
          set({ connected: false });
        });
        
        // Try to connect
        setTimeout(() => {
          if (get().connecting) {
            // If still connecting after timeout, assume connected
            set({ connected: true, connecting: false });
          }
        }, 5000);
        
      } catch (error) {
        console.error('Failed to connect:', error);
        set({ connected: false, connecting: false });
      }
    },
    
    disconnect: () => {
      websocket.disconnect();
      set({ connected: false });
    },
    
    // Fetch games
    fetchGames: async (filters) => {
      try {
        const games = await api.getGames(filters);
        set({ games });
      } catch (error) {
        console.error('Failed to fetch games:', error);
      }
    },
    
    // Select game
    selectGame: async (gameId) => {
      set({ selectedGameId: gameId });
      
      try {
        const game = await api.getGame(gameId);
        if (game) {
          set({
            currentGame: game,
            gameState: game.currentState,
            players: game.players,
          });
          
          // Subscribe to game events
          websocket.send({
            type: 'JOIN_GAME',
            payload: { gameId },
          });
        }
      } catch (error) {
        console.error('Failed to fetch game:', error);
      }
    },
    
    // Create game
    createGame: async (config) => {
      try {
        const game = await api.createGame(config);
        await get().fetchGames();
        return game;
      } catch (error) {
        console.error('Failed to create game:', error);
        throw error;
      }
    },
    
    // Join game
    joinGame: async (gameId, playerName) => {
      try {
        await api.joinGame(gameId, playerName);
        await get().selectGame(gameId);
      } catch (error) {
        console.error('Failed to join game:', error);
        throw error;
      }
    },
    
    // Start game
    startGame: async (gameId) => {
      try {
        await api.startGame(gameId);
        await get().selectGame(gameId);
      } catch (error) {
        console.error('Failed to start game:', error);
        throw error;
      }
    },
    
    // Update game state
    updateGameState: (state) => {
      set({ gameState: state });
    },
    
    // Update players
    updatePlayers: (players) => {
      set({ players });
    },
    
    // Add event
    addEvent: (event) => {
      const { events } = get();
      const newEvents = [...events, event].slice(-100); // Keep last 100 events
      
      // Update game state based on event
      const { gameState } = get();
      if (gameState && event.metadata) {
        if (event.type === 'PHASE_CHANGED') {
          const data = event.data as { toPhase: string };
          set({
            gameState: {
              ...gameState,
              phase: data.toPhase as GameState['phase'],
            },
          });
        }
      }
      
      set({ events: newEvents });
    },
    
    // Update stats
    updateStats: (stats) => {
      set({ stats });
    },
    
    // Submit night action
    submitNightAction: async (gameId, playerId, action, targetId) => {
      try {
        await api.submitNightAction(gameId, playerId, action, targetId);
      } catch (error) {
        console.error('Failed to submit night action:', error);
        throw error;
      }
    },
    
    // Submit vote
    submitVote: async (gameId, voterId, targetId) => {
      try {
        await api.submitVote(gameId, voterId, targetId);
      } catch (error) {
        console.error('Failed to submit vote:', error);
        throw error;
      }
    },
    
    // Make accusation
    makeAccusation: async (gameId, accuserId, targetId, accusation, evidence) => {
      try {
        await api.makeAccusation(gameId, accuserId, targetId, accusation, evidence);
      } catch (error) {
        console.error('Failed to make accusation:', error);
        throw error;
      }
    },
    
    // Claim role
    claimRole: async (gameId, playerId, role) => {
      try {
        await api.claimRole(gameId, playerId, role as 'MAFIA' | 'DOCTOR' | 'SHERIFF' | 'VIGILANTE' | 'VILLAGER');
      } catch (error) {
        console.error('Failed to claim role:', error);
        throw error;
      }
    },
    
    // Clear current game
    clearCurrentGame: () => {
      set({
        currentGame: null,
        gameState: null,
        players: [],
        events: [],
        selectedGameId: null,
      });
    },
  }))
);

export default useGameStore;
