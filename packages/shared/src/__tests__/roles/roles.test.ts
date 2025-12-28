/**
 * Role System Tests
 * 
 * Tests for role configurations, abilities, and mechanics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getRoleConfig, 
  getTeam, 
  isMafia, 
  canActAtNight,
  hasNightAbility,
  getAbilityFrequency,
  getMafiaTeammates,
  getInvestigationResult,
  generateRolePrompt,
  RoleType,
  Player,
  Game
} from '../../roles/index.js';

describe('Role Configuration', () => {
  describe('getRoleConfig', () => {
    it('should return config for MAFIA role', () => {
      const config = getRoleConfig('MAFIA');
      
      expect(config).toBeDefined();
      expect(config?.type).toBe('MAFIA');
      expect(config?.team).toBe('MAFIA');
      expect(config?.abilities.length).toBeGreaterThan(0);
    });

    it('should return config for DOCTOR role', () => {
      const config = getRoleConfig('DOCTOR');
      
      expect(config).toBeDefined();
      expect(config?.type).toBe('DOCTOR');
      expect(config?.team).toBe('TOWN');
    });

    it('should return config for SHERIFF role', () => {
      const config = getRoleConfig('SHERIFF');
      
      expect(config).toBeDefined();
      expect(config?.type).toBe('SHERIFF');
      expect(config?.team).toBe('TOWN');
    });

    it('should return config for VIGILANTE role', () => {
      const config = getRoleConfig('VIGILANTE');
      
      expect(config).toBeDefined();
      expect(config?.type).toBe('VIGILANTE');
      expect(config?.team).toBe('TOWN');
    });

    it('should return config for VILLAGER role', () => {
      const config = getRoleConfig('VILLAGER');
      
      expect(config).toBeDefined();
      expect(config?.type).toBe('VILLAGER');
      expect(config?.team).toBe('TOWN');
      expect(config?.abilities.length).toBe(0);
    });

    it('should return undefined for invalid role', () => {
      const config = getRoleConfig('INVALID' as RoleType);
      
      expect(config).toBeUndefined();
    });
  });

  describe('Role Teams', () => {
    it('should identify MAFIA as mafia team', () => {
      expect(getTeam('MAFIA')).toBe('MAFIA');
    });

    it('should identify all town roles', () => {
      expect(getTeam('DOCTOR')).toBe('TOWN');
      expect(getTeam('SHERIFF')).toBe('TOWN');
      expect(getTeam('VIGILANTE')).toBe('TOWN');
      expect(getTeam('VILLAGER')).toBe('TOWN');
    });
  });

  describe('isMafia Helper', () => {
    it('should return true for MAFIA role', () => {
      expect(isMafia('MAFIA')).toBe(true);
    });

    it('should return false for town roles', () => {
      expect(isMafia('DOCTOR')).toBe(false);
      expect(isMafia('SHERIFF')).toBe(false);
      expect(isMafia('VIGILANTE')).toBe(false);
      expect(isMafia('VILLAGER')).toBe(false);
    });
  });
});

describe('Night Abilities', () => {
  describe('canActAtNight', () => {
    it('should allow MAFIA to act at night', () => {
      expect(canActAtNight('MAFIA')).toBe(true);
    });

    it('should allow DOCTOR to act at night', () => {
      expect(canActAtNight('DOCTOR')).toBe(true);
    });

    it('should allow SHERIFF to act at night', () => {
      expect(canActAtNight('SHERIFF')).toBe(true);
    });

    it('should allow VIGILANTE to act at night', () => {
      expect(canActAtNight('VIGILANTE')).toBe(true);
    });

    it('should not allow VILLAGER to act at night', () => {
      expect(canActAtNight('VILLAGER')).toBe(false);
    });
  });

  describe('hasNightAbility', () => {
    it('should return true for roles with night abilities', () => {
      expect(hasNightAbility('MAFIA')).toBe(true);
      expect(hasNightAbility('DOCTOR')).toBe(true);
      expect(hasNightAbility('SHERIFF')).toBe(true);
      expect(hasNightAbility('VIGILANTE')).toBe(true);
    });

    it('should return false for VILLAGER', () => {
      expect(hasNightAbility('VILLAGER')).toBe(false);
    });
  });

  describe('getAbilityFrequency', () => {
    it('should return nightly for MAFIA', () => {
      expect(getAbilityFrequency('MAFIA')).toBe('nightly');
    });

    it('should return nightly for DOCTOR', () => {
      expect(getAbilityFrequency('DOCTOR')).toBe('nightly');
    });

    it('should return nightly for SHERIFF', () => {
      expect(getAbilityFrequency('SHERIFF')).toBe('nightly');
    });

    it('should return once for VIGILANTE', () => {
      expect(getAbilityFrequency('VIGILANTE')).toBe('once');
    });
  });
});

describe('Mafia Team Mechanics', () => {
  let mockGame: Game;

  beforeEach(() => {
    mockGame = {
      id: 'test-game',
      createdAt: new Date(),
      status: 'IN_PROGRESS',
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA', isAlive: true, isMafia: true, joinOrder: 1 },
        { id: 'mafia2', name: 'M2', role: 'MAFIA', isAlive: true, isMafia: true, joinOrder: 2 },
        { id: 'mafia3', name: 'M3', role: 'MAFIA', isAlive: false, isMafia: true, joinOrder: 3 }, // Dead
        { id: 'town1', name: 'T1', role: 'DOCTOR', isAlive: true, isMafia: false, joinOrder: 4 },
        { id: 'town2', name: 'T2', role: 'SHERIFF', isAlive: true, isMafia: false, joinOrder: 5 },
        { id: 'town3', name: 'T3', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 6 },
      ],
      config: {
        numPlayers: 6,
        roles: [],
        nightPhaseDuration: 60,
        dayPhaseDuration: 120,
        votingDuration: 30,
        maxPlayers: 15,
        minPlayers: 5,
        allowSelfVote: false,
        tieBreaker: 'RANDOM',
        enable3D: false,
        enableVoice: false,
        logLevel: 'DEBUG',
      },
      currentState: {
        phase: 'NIGHT_ACTIONS',
        dayNumber: 1,
        turnNumber: 1,
        timeRemaining: 60,
        activePlayers: ['mafia1', 'mafia2', 'town1', 'town2', 'town3'],
        eliminatedPlayers: ['mafia3'],
        votes: [],
        nightActions: [],
      },
      events: [],
    };
  });

  describe('getMafiaTeammates', () => {
    it('should return alive mafia teammates', () => {
      const teammates = getMafiaTeammates(mockGame, 'mafia1');
      
      expect(teammates).toContain('mafia2');
      expect(teammates).not.toContain('mafia3'); // Dead
      expect(teammates.length).toBe(1);
    });

    it('should return empty array for non-mafia player', () => {
      const teammates = getMafiaTeammates(mockGame, 'town1');
      
      expect(teammates).toEqual([]);
    });
  });

  describe('getInvestigationResult', () => {
    it('should return MAFIA for mafia target', () => {
      const result = getInvestigationResult(mockGame, 'town2', 'mafia1');
      
      expect(result).toBe('MAFIA');
    });

    it('should return NOT_MAFIA for town target', () => {
      const result = getInvestigationResult(mockGame, 'town2', 'town1');
      
      expect(result).toBe('NOT_MAFIA');
    });

    it('should return undefined for non-sheriff investigator', () => {
      const result = getInvestigationResult(mockGame, 'mafia1', 'town1');
      
      expect(result).toBeUndefined();
    });
  });
});

describe('Role Prompts', () => {
  let mockPlayer: Player;
  let mockGame: Game;

  beforeEach(() => {
    mockPlayer = {
      id: 'test-player',
      name: 'TestPlayer',
      role: 'MAFIA',
      isAlive: true,
      isMafia: true,
      joinOrder: 1,
    };

    mockGame = {
      id: 'test-game',
      createdAt: new Date(),
      status: 'IN_PROGRESS',
      players: [
        mockPlayer,
        { id: 'p2', name: 'Player2', role: 'DOCTOR', isAlive: true, isMafia: false, joinOrder: 2 },
        { id: 'p3', name: 'Player3', role: 'SHERIFF', isAlive: true, isMafia: false, joinOrder: 3 },
        { id: 'p4', name: 'Player4', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 4 },
      ],
      config: {
        numPlayers: 4,
        roles: [],
        nightPhaseDuration: 60,
        dayPhaseDuration: 120,
        votingDuration: 30,
        maxPlayers: 15,
        minPlayers: 5,
        allowSelfVote: false,
        tieBreaker: 'RANDOM',
        enable3D: false,
        enableVoice: false,
        logLevel: 'DEBUG',
      },
      currentState: {
        phase: 'DAY_DISCUSSION',
        dayNumber: 1,
        turnNumber: 1,
        timeRemaining: 120,
        activePlayers: ['test-player', 'p2', 'p3', 'p4'],
        eliminatedPlayers: [],
        votes: [],
        nightActions: [],
      },
      events: [],
    };
  });

  describe('generateRolePrompt', () => {
    it('should generate prompt for MAFIA role', () => {
      const prompt = generateRolePrompt(mockPlayer, mockGame);
      
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('MAFIA');
      expect(prompt).toContain('kill');
    });

    it('should generate prompt for DOCTOR role', () => {
      const doctorPlayer = { ...mockPlayer, role: 'DOCTOR' as RoleType };
      const prompt = generateRolePrompt(doctorPlayer, mockGame);
      
      expect(prompt).toBeDefined();
      expect(prompt).toContain('protect');
    });

    it('should generate prompt for SHERIFF role', () => {
      const sheriffPlayer = { ...mockPlayer, role: 'SHERIFF' as RoleType };
      const prompt = generateRolePrompt(sheriffPlayer, mockGame);
      
      expect(prompt).toBeDefined();
      expect(prompt).toContain('investigate');
    });

    it('should generate prompt for VIGILANTE role', () => {
      const vigPlayer = { ...mockPlayer, role: 'VIGILANTE' as RoleType };
      const prompt = generateRolePrompt(vigPlayer, mockGame);
      
      expect(prompt).toBeDefined();
      expect(prompt).toContain('shoot');
    });

    it('should generate prompt for VILLAGER role', () => {
      const villPlayer = { ...mockPlayer, role: 'VILLAGER' as RoleType };
      const prompt = generateRolePrompt(villPlayer, mockGame);
      
      expect(prompt).toBeDefined();
      expect(prompt).toContain('vote');
    });

    it('should include game context in prompt', () => {
      const prompt = generateRolePrompt(mockPlayer, mockGame);
      
      // Should include day/phase info
      expect(prompt).toContain('Day 1');
    });
  });
});

describe('Role Constraints', () => {
  describe('Mafia Constraints', () => {
    it('should not allow mafia to kill other mafia', () => {
      const config = getRoleConfig('MAFIA');
      const killConstraint = config?.constraints.find(c => c.type === 'cannot');
      
      expect(killConstraint).toBeDefined();
      expect(killConstraint?.description).toContain('Cannot kill other mafia');
    });

    it('should limit mafia to one kill per night', () => {
      const config = getRoleConfig('MAFIA');
      const limitConstraint = config?.constraints.find(c => c.type === 'limited');
      
      expect(limitConstraint).toBeDefined();
      expect(limitConstraint?.description).toContain('Only one kill');
    });
  });
});

describe('Win Conditions', () => {
  let mockGame: Game;

  beforeEach(() => {
    mockGame = {
      id: 'test-game',
      createdAt: new Date(),
      status: 'IN_PROGRESS',
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA', isAlive: true, isMafia: true, joinOrder: 1 },
        { id: 'mafia2', name: 'M2', role: 'MAFIA', isAlive: true, isMafia: true, joinOrder: 2 },
        { id: 'town1', name: 'T1', role: 'DOCTOR', isAlive: true, isMafia: false, joinOrder: 3 },
        { id: 'town2', name: 'T2', role: 'SHERIFF', isAlive: true, isMafia: false, joinOrder: 4 },
        { id: 'town3', name: 'T3', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 5 },
        { id: 'town4', name: 'T4', role: 'VILLAGER', isAlive: true, isMafia: false, joinOrder: 6 },
      ],
      config: {
        numPlayers: 6,
        roles: [],
        nightPhaseDuration: 60,
        dayPhaseDuration: 120,
        votingDuration: 30,
        maxPlayers: 15,
        minPlayers: 5,
        allowSelfVote: false,
        tieBreaker: 'RANDOM',
        enable3D: false,
        enableVoice: false,
        logLevel: 'DEBUG',
      },
      currentState: {
        phase: 'DAY_DISCUSSION',
        dayNumber: 1,
        turnNumber: 1,
        timeRemaining: 120,
        activePlayers: ['mafia1', 'mafia2', 'town1', 'town2', 'town3', 'town4'],
        eliminatedPlayers: [],
        votes: [],
        nightActions: [],
      },
      events: [],
    };
  });

  it('should detect ongoing game (no win condition met)', () => {
    const mafiaConfig = getRoleConfig('MAFIA');
    expect(mafiaConfig).toBeDefined();
    
    // 2 mafia vs 4 town - mafia doesn't win yet
    const mafiaAlive = mockGame.players.filter(p => p.isAlive && p.role === 'MAFIA').length;
    const townAlive = mockGame.players.filter(p => p.isAlive && p.role !== 'MAFIA').length;
    
    expect(mafiaAlive < townAlive).toBe(true);
  });

  it('should have correct win condition logic', () => {
    const config = getRoleConfig('MAFIA');
    expect(config?.winCondition.team).toBe('MAFIA');
    expect(config?.winCondition.condition).toContain('equal or outnumber');
  });
});
