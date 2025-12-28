/**
 * Roles Module
 * 
 * Role definitions and mechanics for the Mafia AI Benchmark system.
 * Defines behavior, capabilities, and prompts for each role.
 */

import { RoleType, Player, Game, AgentMemory, InternalMonologue } from '../types/index.js';
import { GameEvent } from '../events/index.js';

// Role configuration
export interface RoleConfig {
  type: RoleType;
  team: 'MAFIA' | 'TOWN';
  description: string;
  abilities: RoleAbility[];
  constraints: RoleConstraint[];
  winCondition: WinCondition;
  promptStyle: PromptStyle;
}

export interface RoleAbility {
  name: string;
  description: string;
  frequency: 'nightly' | 'once' | 'always';
  targetType: 'any' | 'alive' | 'self' | 'non-self';
}

export interface RoleConstraint {
  type: 'cannot' | 'must' | 'limited';
  description: string;
  rule: string;
}

export interface WinCondition {
  team: 'MAFIA' | 'TOWN';
  condition: string;
  check: (game: Game, player: Player) => boolean;
}

export interface PromptStyle {
  tone: 'aggressive' | 'defensive' | 'neutral' | 'investigative';
  priorities: string[];
  deceptionLevel: number; // 0-1, how much they should lie
}

// Role definitions
export const ROLES: Map<RoleType, RoleConfig> = new Map([
  ['MAFIA', {
    type: 'MAFIA',
    team: 'MAFIA',
    description: 'A member of the criminal organization working to eliminate the town.',
    abilities: [
      {
        name: 'Kill',
        description: 'Coordinate with other mafia to eliminate one target per night',
        frequency: 'nightly',
        targetType: 'any',
      },
    ],
    constraints: [
      {
        type: 'cannot',
        description: 'Cannot kill other mafia members',
        rule: 'MAFIA_KILL cannot target mafia players',
      },
      {
        type: 'limited',
        description: 'Only one kill per night regardless of number of mafia',
        rule: 'Only one MAFIA_KILL action is processed per night',
      },
    ],
    winCondition: {
      team: 'MAFIA',
      condition: 'Mafia members equal or outnumber town members',
      check: (game: Game) => {
        const alivePlayers = game.players.filter(p => p.isAlive);
        const mafiaAlive = alivePlayers.filter(p => p.role === 'MAFIA').length;
        const townAlive = alivePlayers.filter(p => p.role !== 'MAFIA').length;
        return mafiaAlive >= townAlive;
      },
    },
    promptStyle: {
      tone: 'aggressive',
      priorities: ['survive', 'eliminate town', 'coordinate secretly'],
      deceptionLevel: 1.0,
    },
  }],
  
  ['DOCTOR', {
    type: 'DOCTOR',
    team: 'TOWN',
    description: 'A skilled healer who can protect one player each night from mafia attacks.',
    abilities: [
      {
        name: 'Protect',
        description: 'Protect one player from being killed at night',
        frequency: 'nightly',
        targetType: 'any',
      },
    ],
    constraints: [
      {
        type: 'limited',
        description: 'Cannot protect the same player two nights in a row',
        rule: 'Self-protection rule: If a player is protected two consecutive nights, they are not protected on the second night',
      },
    ],
    winCondition: {
      team: 'TOWN',
      condition: 'All mafia members are eliminated',
      check: (game: Game) => {
        const alivePlayers = game.players.filter(p => p.isAlive);
        return !alivePlayers.some(p => p.role === 'MAFIA');
      },
    },
    promptStyle: {
      tone: 'defensive',
      priorities: ['protect key players', 'stay alive', 'gather information'],
      deceptionLevel: 0.2,
    },
  }],
  
  ['SHERIFF', {
    type: 'SHERIFF',
    team: 'TOWN',
    description: 'A law enforcement officer who can investigate one player each night to determine their affiliation.',
    abilities: [
      {
        name: 'Investigate',
        description: 'Investigate one player to determine if they are mafia',
        frequency: 'nightly',
        targetType: 'any',
      },
    ],
    constraints: [
      {
        type: 'cannot',
        description: 'Cannot investigate the same player twice',
        rule: 'Each player can only be investigated once per game',
      },
    ],
    winCondition: {
      team: 'TOWN',
      condition: 'All mafia members are eliminated',
      check: (game: Game) => {
        const alivePlayers = game.players.filter(p => p.isAlive);
        return !alivePlayers.some(p => p.role === 'MAFIA');
      },
    },
    promptStyle: {
      tone: 'investigative',
      priorities: ['gather evidence', 'reveal mafia', 'stay safe'],
      deceptionLevel: 0.3,
    },
  }],
  
  ['VIGILANTE', {
    type: 'VIGILANTE',
    team: 'TOWN',
    description: 'A lone justice seeker with exactly ONE bullet to eliminate a mafia member.',
    abilities: [
      {
        name: 'Shoot',
        description: 'One-time ability to eliminate any player (town or mafia)',
        frequency: 'once',
        targetType: 'any',
      },
    ],
    constraints: [
      {
        type: 'limited',
        description: 'Can only shoot once total (not per night)',
        rule: 'VIGILANTE_SHOOT can only be used once per game',
      },
      {
        type: 'cannot',
        description: 'Cannot shoot after using their one bullet',
        rule: 'Once VIGILANTE_SHOT_FIRED event occurs, no more shots are possible',
      },
    ],
    winCondition: {
      team: 'TOWN',
      condition: 'All mafia members are eliminated',
      check: (game: Game) => {
        const alivePlayers = game.players.filter(p => p.isAlive);
        return !alivePlayers.some(p => p.role === 'MAFIA');
      },
    },
    promptStyle: {
      tone: 'aggressive',
      priorities: ['find mafia', 'use shot strategically', 'remain hidden'],
      deceptionLevel: 0.5,
    },
  }],
  
  ['VILLAGER', {
    type: 'VILLAGER',
    team: 'TOWN',
    description: 'An ordinary townsperson with no special abilities, but valuable voting power.',
    abilities: [
      {
        name: 'Vote',
        description: 'Participate in day voting to lynch suspected mafia',
        frequency: 'always',
        targetType: 'any',
      },
    ],
    constraints: [],
    winCondition: {
      team: 'TOWN',
      condition: 'All mafia members are eliminated',
      check: (game: Game) => {
        const alivePlayers = game.players.filter(p => p.isAlive);
        return !alivePlayers.some(p => p.role === 'MAFIA');
      },
    },
    promptStyle: {
      tone: 'neutral',
      priorities: ['vote correctly', 'observe behavior', 'trust town'],
      deceptionLevel: 0.0,
    },
  }],
]);

// Role utility functions
export function getRoleConfig(role: RoleType): RoleConfig | undefined {
  return ROLES.get(role);
}

export function getTeam(role: RoleType): 'MAFIA' | 'TOWN' {
  return ROLES.get(role)?.team || 'TOWN';
}

export function isMafia(role: RoleType): boolean {
  return role === 'MAFIA';
}

export function canActAtNight(role: RoleType): boolean {
  return ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE'].includes(role);
}

export function hasNightAbility(role: RoleType): boolean {
  return ['MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE'].includes(role);
}

export function getAbilityFrequency(role: RoleType): 'nightly' | 'once' | 'always' | undefined {
  const config = ROLES.get(role);
  if (!config || config.abilities.length === 0) return undefined;
  
  return config.abilities[0].frequency;
}

export function isAbilityUsed(game: Game, playerId: string, ability: string): boolean {
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.role !== 'VIGILANTE') return false;
  
  // Check if vigilante has already shot
  if (ability === 'SHOOT') {
    return game.events.some(
      e => e.type === 'VIGILANTE_SHOT_FIRED' && 
           (e.data as { vigilanteId: string }).vigilanteId === playerId
    );
  }
  
  return false;
}

// Role-specific behavior functions
export function getMafiaTeammates(game: Game, playerId: string): string[] {
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.role !== 'MAFIA') return [];
  
  return game.players
    .filter(p => p.role === 'MAFIA' && p.id !== playerId && p.isAlive)
    .map(p => p.id);
}

export function getProtectionTarget(game: Game, doctorId: string): string | undefined {
  const nightAction = game.currentState.nightActions.find(
    a => a.actorId === doctorId && a.action === 'DOCTOR_PROTECT'
  );
  return nightAction?.targetId;
}

export function getInvestigationTarget(game: Game, sheriffId: string): string | undefined {
  const nightAction = game.currentState.nightActions.find(
    a => a.actorId === sheriffId && a.action === 'SHERIFF_INVESTIGATE'
  );
  return nightAction?.targetId;
}

export function getInvestigationResult(game: Game, sheriffId: string): 'MAFIA' | 'NOT_MAFIA' | undefined {
  const targetId = getInvestigationTarget(game, sheriffId);
  if (!targetId) return undefined;
  
  const target = game.players.find(p => p.id === targetId);
  if (!target) return undefined;
  
  return target.role === 'MAFIA' ? 'MAFIA' : 'NOT_MAFIA';
}

export function getVigilanteTarget(game: Game, vigilanteId: string): string | undefined {
  const nightAction = game.currentState.nightActions.find(
    a => a.actorId === vigilanteId && a.action === 'VIGILANTE_SHOOT'
  );
  return nightAction?.targetId;
}

// Role prompt generation
export function generateRolePrompt(player: Player, game: Game): string {
  const roleConfig = ROLES.get(player.role);
  if (!roleConfig) return '';
  
  const teammates = player.role === 'MAFIA' ? getMafiaTeammates(game, player.id) : [];
  
  let prompt = `# IDENTITY\n`;
  prompt += `You are playing the game of Mafia.\n`;
  prompt += `Your TRUE IDENTITY is: ${player.role}\n`;
  
  if (player.role === 'MAFIA') {
    prompt += `\n# MAFIA TEAM\n`;
    prompt += `You know your mafia teammates: ${teammates.map(id => game.players.find(p => p.id === id)?.name || id).join(', ')}\n`;
    prompt += `Coordinate with them secretly to eliminate the town.\n`;
  }
  
  prompt += `\n# YOUR ROLE\n`;
  prompt += `${roleConfig.description}\n`;
  
  prompt += `\n# YOUR ABILITIES\n`;
  roleConfig.abilities.forEach(ability => {
    prompt += `- ${ability.name}: ${ability.description}\n`;
    prompt += `  Frequency: ${ability.frequency}\n`;
  });
  
  if (roleConfig.constraints.length > 0) {
    prompt += `\n# CONSTRAINTS\n`;
    roleConfig.constraints.forEach(constraint => {
      prompt += `- ${constraint.description}\n`;
    });
  }
  
  prompt += `\n# BEHAVIOR STYLE\n`;
  prompt += `Tone: ${roleConfig.promptStyle.tone}\n`;
  prompt += `Priorities: ${roleConfig.promptStyle.priorities.join(', ')}\n`;
  prompt += `Deception Level: ${(roleConfig.promptStyle.deceptionLevel * 100)}%\n`;
  
  prompt += `\n# WIN CONDITION\n`;
  prompt += `${roleConfig.winCondition.condition}\n`;
  
  return prompt;
}

// Role-specific memory updates
export function updateRoleMemory(
  role: RoleType,
  memory: AgentMemory,
  game: Game,
  event: GameEvent
): AgentMemory {
  switch (role) {
    case 'MAFIA':
      return updateMafiaMemory(memory, game, event);
    case 'DOCTOR':
      return updateDoctorMemory(memory, game, event);
    case 'SHERIFF':
      return updateSheriffMemory(memory, game, event);
    case 'VIGILANTE':
      return updateVigilanteMemory(memory, game, event);
    default:
      return memory;
  }
}

function updateMafiaMemory(memory: AgentMemory, game: Game, event: GameEvent): AgentMemory {
  // Update internal monologue based on game events
  const alivePlayers = game.players.filter(p => p.isAlive);
  
  // Update suspect list
  const suspects = memory.internalMonologue.currentSuspects.filter(id => {
    const player = game.players.find(p => p.id === id);
    return player && player.isAlive && player.role !== 'MAFIA';
  });
  
  // Add new suspects based on accusations
  if (event.type === 'ACCUSATION_MADE') {
    const accuserId = event.actorId;
    const targetId = event.targetId;
    
    if (accuserId && !suspects.includes(accuserId)) {
      // Accuser might be town, add their targets to suspect list
      if (targetId && !memory.internalMonologue.currentSuspects.includes(targetId)) {
        suspects.push(targetId);
      }
    }
  }
  
  return {
    ...memory,
    internalMonologue: {
      ...memory.internalMonologue,
      currentSuspects: suspects,
    },
  };
}

function updateDoctorMemory(memory: AgentMemory, game: Game, event: GameEvent): AgentMemory {
  // Track who we've protected
  if (event.type === 'DOCTOR_PROTECTION_SUCCESSFUL') {
    return {
      ...memory,
      privateInfo: {
        ...memory.privateInfo,
        protectedBy: event.targetId,
      },
    };
  }
  
  return memory;
}

function updateSheriffMemory(memory: AgentMemory, game: Game, event: GameEvent): AgentMemory {
  // Track investigation results
  if (event.type === 'SHERIFF_INVESTIGATION_RESULT') {
    const data = event.data as { targetId: string; result: 'MAFIA' | 'NOT_MAFIA' };
    
    const newResults = [...memory.privateInfo.investigationResults];
    newResults.push({
      investigatorId: event.actorId!,
      targetId: data.targetId,
      result: data.result,
    });
    
    return {
      ...memory,
      privateInfo: {
        ...memory.privateInfo,
        investigationResults: newResults,
      },
    };
  }
  
  return memory;
}

function updateVigilanteMemory(memory: AgentMemory, game: Game, event: GameEvent): AgentMemory {
  // Track shots remaining
  if (event.type === 'VIGILANTE_SHOT_FIRED') {
    return {
      ...memory,
      privateInfo: {
        ...memory.privateInfo,
        shotsRemaining: 0,
      },
    };
  }
  
  return memory;
}

// All role utilities are defined in this file
// Role-specific modules would be in separate files for a larger codebase
