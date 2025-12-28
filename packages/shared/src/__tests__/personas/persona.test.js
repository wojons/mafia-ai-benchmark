// Persona Generator - Unit Tests
const { describe, it, expect, beforeEach } = require('vitest');
const PersonaGenerator = require('../persona/persona-generator');

describe('PersonaGenerator', () => {
  let generator;

  beforeEach(() => {
    generator = new PersonaGenerator();
  });

  describe('generateName()', () => {
    it('should generate a valid name', () => {
      const name = generator.generateName();
      expect(name).toBeDefined();
      expect(name.split(' ').length).toBeGreaterThanOrEqual(2);
    });

    it('should sometimes include nicknames', () => {
      // Run multiple times to check probability
      let nicknameCount = 0;
      for (let i = 0; i < 100; i++) {
        const name = generator.generateName();
        if (name.includes('"')) nicknameCount++;
      }
      // Should have nicknames roughly 20% of the time
      expect(nicknameCount).toBeGreaterThan(5);
      expect(nicknameCount).toBeLessThan(35);
    });

    it('should generate unique names across multiple calls', () => {
      const names = new Set();
      for (let i = 0; i < 50; i++) {
        names.add(generator.generateName());
      }
      // Most names should be unique in 50 calls
      expect(names.size).toBeGreaterThan(40);
    });
  });

  describe('generatePersona()', () => {
    it('should create a persona with all required fields', () => {
      const persona = generator.generatePersona('MAFIA');

      // Core Identity
      expect(persona.name).toBeDefined();
      expect(persona.zodiac).toBeDefined();
      expect(persona.origin).toBeDefined();

      // Psychological Profile
      expect(persona.archetype).toBeDefined();
      expect(persona.traits).toBeInstanceOf(Array);
      expect(persona.traits.length).toBeGreaterThanOrEqual(3);
      expect(persona.coreValues).toBeInstanceOf(Array);
      expect(persona.moralAlignment).toBeDefined();

      // Behavioral Model
      expect(persona.communicationStyle).toBeDefined();
      expect(persona.verbalTics).toBeInstanceOf(Array);
      expect(persona.humor).toBeDefined();
      expect(persona.socialTendency).toBeDefined();

      // Relational Profile
      expect(persona.goal).toBeDefined();
      expect(persona.flaw).toBeDefined();
      expect(persona.keyMemory).toBeDefined();

      // Dynamic State
      expect(persona.currentState).toBeDefined();
      expect(persona.currentState.happiness).toBeDefined();
      expect(persona.currentState.stress).toBeDefined();
      expect(persona.currentState.curiosity).toBeDefined();
      expect(persona.currentState.anger).toBeDefined();

      // Role Adjustment
      expect(persona.roleAdjustment).toBeDefined();
      expect(persona.roleAdjustment.secretGoal).toBeDefined();
      expect(persona.roleAdjustment.hidingStrategy).toBeDefined();
    });

    it('should apply role-specific adjustments', () => {
      const roles = ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER'];
      
      roles.forEach(role => {
        const persona = generator.generatePersona(role);
        expect(persona.roleAdjustment).toBeDefined();
        expect(persona.roleAdjustment.secretGoal).toContain(role === 'MAFIA' ? 'Eliminate' : 
                                                           role === 'DOCTOR' ? 'Protect' : 
                                                           role === 'SHERIFF' ? 'Identify' :
                                                           role === 'VIGILANTE' ? 'Eliminate' : 'Find');
      });
    });

    it('should generate diverse archetypes', () => {
      const archetypes = new Set();
      for (let i = 0; i < 100; i++) {
        archetypes.add(generator.generatePersona('VILLAGER').archetype);
      }
      // Should have multiple different archetypes
      expect(archetypes.size).toBeGreaterThan(5);
    });

    it('should generate diverse communication styles', () => {
      const styles = new Set();
      for (let i = 0; i < 100; i++) {
        styles.add(generator.generatePersona('VILLAGER').communicationStyle);
      }
      // Should have multiple communication styles
      expect(styles.size).toBeGreaterThan(3);
    });
  });

  describe('generateGamePersonas()', () => {
    it('should generate correct number of personas', () => {
      const personas6 = generator.generateGamePersonas(6);
      expect(personas6.length).toBe(6);

      const personas10 = generator.generateGamePersonas(10);
      expect(personas10.length).toBe(10);

      const personas12 = generator.generateGamePersonas(12);
      expect(personas12.length).toBe(12);
    });

    it('should assign roles correctly', () => {
      const personas = generator.generateGamePersonas(10);
      
      const mafiaCount = personas.filter(p => p.gameRole === 'MAFIA').length;
      const doctorCount = personas.filter(p => p.gameRole === 'DOCTOR').length;
      const sheriffCount = personas.filter(p => p.gameRole === 'SHERIFF').length;
      const vigilanteCount = personas.filter(p => p.gameRole === 'VIGILANTE').length;
      const villagerCount = personas.filter(p => p.gameRole === 'VILLAGER').length;

      // Should have 2 mafia (10/4 = 2.5 → floor = 2)
      expect(mafiaCount).toBe(2);
      // Should have 1 of each special role
      expect(doctorCount).toBe(1);
      expect(sheriffCount).toBe(1);
      expect(vigilanteCount).toBe(1);
      // Should have remaining as villagers (10 - 2 - 1 - 1 - 1 = 5)
      expect(villagerCount).toBe(5);
    });

    it('should assign player IDs correctly', () => {
      const personas = generator.generateGamePersonas(5);
      
      personas.forEach((persona, index) => {
        expect(persona.playerId).toBe(`player-${index + 1}`);
      });
    });

    it('should generate unique names in a game', () => {
      const personas = generator.generateGamePersonas(10);
      const names = personas.map(p => p.name);
      const uniqueNames = new Set(names);
      
      expect(uniqueNames.size).toBe(10);
    });

    it('should include all persona fields for each player', () => {
      const personas = generator.generateGamePersonas(6);
      
      personas.forEach(persona => {
        expect(persona.name).toBeDefined();
        expect(persona.gameRole).toBeDefined();
        expect(persona.persona).toBeUndefined(); // gameRole, not persona property
      });
    });
  });

  describe('assignRoles()', () => {
    it('should assign correct role distribution for 6 players', () => {
      const roles = generator.assignRoles(6);
      
      expect(roles.filter(r => r === 'MAFIA').length).toBe(1);
      expect(roles.filter(r => r === 'DOCTOR').length).toBe(1);
      expect(roles.filter(r => r === 'SHERIFF').length).toBe(1);
      expect(roles.filter(r => r === 'VIGILANTE').length).toBe(1);
      expect(roles.filter(r => r === 'VILLAGER').length).toBe(2);
    });

    it('should assign correct role distribution for 10 players', () => {
      const roles = generator.assignRoles(10);
      
      expect(roles.filter(r => r === 'MAFIA').length).toBe(2);
      expect(roles.filter(r => r === 'DOCTOR').length).toBe(1);
      expect(roles.filter(r => r === 'SHERIFF').length).toBe(1);
      expect(roles.filter(r => r === 'VIGILANTE').length).toBe(1);
      expect(roles.filter(r => r === 'VILLAGER').length).toBe(5);
    });

    it('should assign correct role distribution for 12 players', () => {
      const roles = generator.assignRoles(12);
      
      expect(roles.filter(r => r === 'MAFIA').length).toBe(3);
      expect(roles.filter(r => r === 'DOCTOR').length).toBe(1);
      expect(roles.filter(r => r === 'SHERIFF').length).toBe(1);
      expect(roles.filter(r => r === 'VIGILANTE').length).toBe(1);
      expect(roles.filter(r => r === 'VILLAGER').length).toBe(6);
    });

    it('should return array of strings', () => {
      const roles = generator.assignRoles(10);
      
      expect(roles).toBeInstanceOf(Array);
      roles.forEach(role => {
        expect(typeof role).toBe('string');
      });
    });
  });

  describe('archetype pools', () => {
    it('should have historical archetypes', () => {
      expect(generator.archetypes.historical.length).toBeGreaterThan(5);
    });

    it('should have fictional archetypes', () => {
      expect(generator.archetypes.fictional.length).toBeGreaterThan(5);
    });

    it('should have anime archetypes', () => {
      expect(generator.archetypes.anime.length).toBeGreaterThan(5);
    });

    it('should have stereotype archetypes', () => {
      expect(generator.archetypes.stereotypes.length).toBeGreaterThan(5);
    });

    it('should have abstract archetypes', () => {
      expect(generator.archetypes.abstract.length).toBeGreaterThan(5);
    });

    it('should have fantasy archetypes', () => {
      expect(generator.archetypes.fantasy.length).toBeGreaterThan(5);
    });
  });

  describe('communication styles', () => {
    it('should have formal communication style', () => {
      const style = generator.communicationStyles.formal;
      expect(style.cadence).toBeDefined();
      expect(style.phrases).toBeInstanceOf(Array);
      expect(style.humor).toBeDefined();
    });

    it('should have casual communication style', () => {
      const style = generator.communicationStyles.casual;
      expect(style.cadence).toBeDefined();
      expect(style.phrases).toBeInstanceOf(Array);
      expect(style.humor).toBeDefined();
    });

    it('should have multiple communication styles', () => {
      const styles = Object.keys(generator.communicationStyles);
      expect(styles.length).toBeGreaterThan(5);
    });
  });

  describe('backstory templates', () => {
    it('should have backstory templates', () => {
      expect(generator.backstoryTemplates.length).toBeGreaterThan(5);
    });

    it('should include diverse backgrounds', () => {
      const backgrounds = generator.backstoryTemplates;
      
      // Check for variety
      const hasSmallTown = backgrounds.some(b => b.toLowerCase().includes('small town'));
      const hasMilitary = backgrounds.some(b => b.toLowerCase().includes('military'));
      const hasStreet = backgrounds.some(b => b.toLowerCase().includes('street'));
      const hasAcademic = backgrounds.some(b => b.toLowerCase().includes('academic'));
      
      expect(hasSmallTown).toBe(true);
      expect(hasMilitary).toBe(true);
      expect(hasStreet).toBe(true);
      expect(hasAcademic).toBe(true);
    });
  });

  describe('name pools', () => {
    it('should have multiple cultural name pools', () => {
      const pools = Object.keys(generator.namePools.firstNames);
      
      expect(pools).toContain('western');
      expect(pools).toContain('eastern');
      expect(pools).toContain('latin');
      expect(pools).toContain('nordic');
      expect(pools).toContain('african');
    });

    it('should have last name pools for each culture', () => {
      const pools = Object.keys(generator.namePools.lastNames);
      
      expect(pools.length).toBeGreaterThan(3);
    });

    it('should have nickname pools', () => {
      expect(generator.namePools.nicknames).toBeDefined();
      expect(generator.namePools.nicknames.playful).toBeInstanceOf(Array);
      expect(generator.namePools.nicknames.playful.length).toBeGreaterThan(3);
    });
  });

  describe('generateSampleDialogue()', () => {
    it('should generate dialogue in specified style', () => {
      const communication = generator.communicationStyles.formal;
      const archetype = { role: 'Leader' };
      
      const dialogue = generator.generateSampleDialogue(communication, archetype);
      
      expect(dialogue).toBeDefined();
      expect(dialogue.length).toBeGreaterThan(20);
      expect(dialogue.length).toBeLessThan(200);
    });
  });

  describe('getRoleAdjustment()', () => {
    it('should return adjustment for each role', () => {
      const roles = ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER'];
      
      roles.forEach(role => {
        const adjustment = generator.getRoleAdjustment(role);
        expect(adjustment).toBeDefined();
        expect(adjustment.secretGoal).toBeDefined();
        expect(adjustment.hidingStrategy).toBeDefined();
      });
    });
  });
});
