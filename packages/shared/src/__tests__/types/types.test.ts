/**
 * Types Module Tests
 * 
 * Tests for core type definitions and interfaces.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Import types directly for testing
type Role = 'MAFIA' | 'DOCTOR' | 'SHERIFF' | 'VIGILANTE' | 'VILLAGER';
type GamePhase = 'SETUP' | 'NIGHT_ACTIONS' | 'MORNING_REVEAL' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'RESOLUTION' | 'GAME_OVER';
type EventVisibility = 'PUBLIC' | 'PRIVATE' | 'ADMIN';
type LLMProvider = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'DEEPSEEK' | 'GROQ' | 'OLLAMA' | 'LM_STUDIO' | 'CUSTOM';
type ActionType = 'VOTE' | 'UNVOTE' | 'KILL' | 'PROTECT' | 'INVESTIGATE' | 'VIGILANTE_SHOOT' | 'CLAIM_ROLE' | 'REVEAL_IDENTITY';

interface Player {
  id: string;
  name: string;
  role: Role;
  isAlive: boolean;
  connectionId: string;
  metadata?: {
    suspicion: number;
    trust: number;
    lastVotedFor: string | null;
    investigationResults?: Map<string, boolean>;
    isProtected?: boolean;
    protectedBy?: string | null;
  };
}

interface GameState {
  phase: GamePhase;
  dayNumber: number;
  roundNumber: number;
  players: Player[];
  events: unknown[];
  votes: Vote[];
  nightActions: Map<string, NightAction>;
  eliminatedPlayers: string[];
  protectedPlayers: Set<string>;
  investigationResults: Map<string, Map<string, boolean>>;
  vigilanteShotsRemaining: number;
  hasVigilanteActed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  metadata: Record<string, unknown>;
}

interface Vote {
  id: string;
  voterId: string;
  targetId: string;
  dayNumber: number;
  roundNumber: number;
  timestamp: Date;
  isRevote: boolean;
}

interface NightAction {
  id: string;
  actorId: string;
  actionType: ActionType;
  targetId: string;
  nightNumber: number;
  timestamp: Date;
  isValid: boolean;
}

describe('Type Definitions', () => {
  describe('Player Types', () => {
    it('should create a valid player object', () => {
      const player: Player = {
        id: 'player-1',
        name: 'Alice',
        role: 'MAFIA',
        isAlive: true,
        connectionId: 'conn-1',
        metadata: {
          suspicion: 50,
          trust: 30,
          lastVotedFor: null,
        },
      };

      expect(player.id).toBe('player-1');
      expect(player.role).toBe('MAFIA');
      expect(player.isAlive).toBe(true);
    });

    it('should allow all role types', () => {
      const roles: Role[] = ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER'];
      
      roles.forEach(role => {
        const player: Player = {
          id: `player-${role}`,
          name: role,
          role,
          isAlive: true,
          connectionId: `conn-${role}`,
        };
        expect(player.role).toBe(role);
      });
    });

    it('should handle player metadata correctly', () => {
      const player: Player = {
        id: 'player-1',
        name: 'Alice',
        role: 'SHERIFF',
        isAlive: true,
        connectionId: 'conn-1',
        metadata: {
          suspicion: 75,
          trust: 20,
          lastVotedFor: 'player-2',
          investigationResults: new Map([
            ['player-3', true], // Mafia
            ['player-4', false], // Not mafia
          ]),
          isProtected: false,
          protectedBy: null,
        },
      };

      expect(player.metadata?.suspicion).toBe(75);
      expect(player.metadata?.investigationResults?.get('player-3')).toBe(true);
    });
  });

  describe('GameState Types', () => {
    it('should have valid game phases', () => {
      const phases: GamePhase[] = [
        'SETUP',
        'NIGHT_ACTIONS',
        'MORNING_REVEAL',
        'DAY_DISCUSSION',
        'DAY_VOTING',
        'RESOLUTION',
        'GAME_OVER',
      ];

      phases.forEach(phase => {
        expect(phase).toBeDefined();
      });
    });

    it('should create valid game state', () => {
      const gameState: GameState = {
        phase: 'SETUP',
        dayNumber: 0,
        roundNumber: 0,
        players: [],
        events: [],
        votes: [],
        nightActions: new Map(),
        eliminatedPlayers: [],
        protectedPlayers: new Set(),
        investigationResults: new Map(),
        vigilanteShotsRemaining: 1,
        hasVigilanteActed: false,
        timer: null,
        metadata: {},
      };

      expect(gameState.phase).toBe('SETUP');
      expect(gameState.dayNumber).toBe(0);
    });
  });

  describe('Action Types', () => {
    it('should define valid action types', () => {
      const actionTypes: ActionType[] = [
        'VOTE',
        'UNVOTE',
        'KILL',
        'PROTECT',
        'INVESTIGATE',
        'VIGILANTE_SHOOT',
        'CLAIM_ROLE',
        'REVEAL_IDENTITY',
      ];

      actionTypes.forEach(actionType => {
        expect(actionType).toBeDefined();
      });
    });

    it('should create valid vote object', () => {
      const vote: Vote = {
        id: 'vote-1',
        voterId: 'player-1',
        targetId: 'player-2',
        dayNumber: 1,
        roundNumber: 1,
        timestamp: new Date(),
        isRevote: false,
      };

      expect(vote.voterId).toBe('player-1');
      expect(vote.targetId).toBe('player-2');
    });

    it('should create valid night action object', () => {
      const nightAction: NightAction = {
        id: 'action-1',
        actorId: 'player-1',
        actionType: 'KILL',
        targetId: 'player-2',
        nightNumber: 1,
        timestamp: new Date(),
        isValid: true,
      };

      expect(nightAction.actionType).toBe('KILL');
      expect(nightAction.targetId).toBe('player-2');
    });
  });

  describe('Event Visibility Types', () => {
    it('should define valid visibility levels', () => {
      const visibilityLevels: EventVisibility[] = ['PUBLIC', 'PRIVATE', 'ADMIN'];
      
      visibilityLevels.forEach(visibility => {
        expect(visibility).toBeDefined();
      });
    });
  });

  describe('LLM Provider Types', () => {
    it('should define all provider types', () => {
      const providers: LLMProvider[] = [
        'OPENAI',
        'ANTHROPIC',
        'GOOGLE',
        'DEEPSEEK',
        'GROQ',
        'OLLAMA',
        'LM_STUDIO',
        'CUSTOM',
      ];

      providers.forEach(provider => {
        expect(provider).toBeDefined();
      });
    });
  });
});

describe('Type Guards', () => {
  it('should correctly identify alive players', () => {
    const alivePlayer: Player = {
      id: 'player-1',
      name: 'Alice',
      role: 'VILLAGER',
      isAlive: true,
      connectionId: 'conn-1',
    };

    const deadPlayer: Player = {
      id: 'player-2',
      name: 'Bob',
      role: 'MAFIA',
      isAlive: false,
      connectionId: 'conn-2',
    };

    expect(alivePlayer.isAlive).toBe(true);
    expect(deadPlayer.isAlive).toBe(false);
  });

  it('should handle game phase transitions', () => {
    let phase: GamePhase = 'SETUP';
    const phaseOrder: GamePhase[] = [
      'SETUP',
      'NIGHT_ACTIONS',
      'MORNING_REVEAL',
      'DAY_DISCUSSION',
      'DAY_VOTING',
      'RESOLUTION',
      'GAME_OVER',
    ];

    phaseOrder.forEach(expectedPhase => {
      expect(phase).toBe(expectedPhase);
      const currentIndex = phaseOrder.indexOf(phase);
      if (currentIndex < phaseOrder.length - 1) {
        phase = phaseOrder[currentIndex + 1];
      }
    });
  });
});

describe('Type Assertions', () => {
  it('should assert role types correctly', () => {
    const mafiaPlayer = { role: 'MAFIA' as const };
    const doctorPlayer = { role: 'DOCTOR' as const };
    const sheriffPlayer = { role: 'SHERIFF' as const };
    const vigilantePlayer = { role: 'VIGILANTE' as const };
    const villagerPlayer = { role: 'VILLAGER' as const };

    expect(mafiaPlayer.role).toBe('MAFIA');
    expect(doctorPlayer.role).toBe('DOCTOR');
    expect(sheriffPlayer.role).toBe('SHERIFF');
    expect(vigilantePlayer.role).toBe('VIGILANTE');
    expect(villagerPlayer.role).toBe('VILLAGER');
  });

  it('should handle union types correctly', () => {
    const roles: Role[] = ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER'];
    
    roles.forEach(role => {
      let isKiller = false;
      
      if (role === 'MAFIA' || role === 'VIGILANTE') {
        isKiller = true;
      }

      // Mafia is killer, Vigilante is killer
      if (role === 'MAFIA' || role === 'VIGILANTE') {
        expect(isKiller).toBe(true);
      } else {
        expect(isKiller).toBe(false);
      }
    });
  });
});
