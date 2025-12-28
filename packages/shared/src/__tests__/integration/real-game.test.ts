/**
 * Real Game Integration Test
 * 
 * This test runs an actual game with AI agents using real LLM calls.
 * Tests the complete game loop with split-pane consciousness.
 */

import { 
  Game, 
  GameFSM, 
  createGameFSM, 
  Player, 
  RoleType,
  GamePhase,
  Vote,
  NightAction,
  LLMProvider
} from '../src/index.js';
import { createProvider, ProviderConfig } from '../src/providers/index.js';
import { getRoleConfig, generateRolePrompt } from '../src/roles/index.js';

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';
const PROVIDER = 'OPENAI';

// Test player names
const PLAYER_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eve',
  'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'
];

// Role distribution for 10 players
const ROLE_DISTRIBUTION: RoleType[] = [
  'MAFIA', 'MAFIA', 'MAFIA',  // 3 mafia
  'DOCTOR',                    // 1 doctor
  'SHERIFF',                   // 1 sheriff
  'VIGILANTE',                 // 1 vigilante
  'VILLAGER', 'VILLAGER', 'VILLAGER', 'VILLAGER'  // 4 villagers
];

interface AgentResponse {
  think: string;  // Private reasoning (admin only)
  says: string;   // Public statement
  action?: string; // Action if any
}

/**
 * Create a test game with 10 players
 */
function createTestGame(): Game {
  const players: Player[] = PLAYER_NAMES.map((name, index) => ({
    id: `player-${index + 1}`,
    name,
    role: ROLE_DISTRIBUTION[index],
    isAlive: true,
    isMafia: ROLE_DISTRIBUTION[index] === 'MAFIA',
    joinOrder: index + 1,
  }));

  const game: Game = {
    id: `game-${Date.now()}`,
    createdAt: new Date(),
    status: 'SETUP',
    players,
    config: {
      numPlayers: 10,
      roles: [
        { role: 'MAFIA', count: 3 },
        { role: 'DOCTOR', count: 1 },
        { role: 'SHERIFF', count: 1 },
        { role: 'VIGILANTE', count: 1 },
        { role: 'VILLAGER', count: 4 },
      ],
      nightPhaseDuration: 30,  // Short for testing
      dayPhaseDuration: 60,
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
      phase: 'SETUP',
      dayNumber: 0,
      turnNumber: 0,
      timeRemaining: 0,
      activePlayers: players.map(p => p.id),
      eliminatedPlayers: [],
      votes: [],
      nightActions: [],
    },
    events: [],
  };

  return game;
}

/**
 * Generate a system prompt for an agent based on their role
 */
function generateAgentPrompt(player: Player, game: Game, phase: GamePhase): string {
  const roleConfig = getRoleConfig(player.role);
  
  let prompt = `# Mafia Game - Split-Pane Consciousness

You are ${player.name}, a ${player.role} in a Mafia game.

## Your Role
${roleConfig?.description || ''}

## Split-Pane System
You have TWO output streams:

### THINK (Private Reasoning)
This is your private, internal reasoning that NO OTHER PLAYERS see.
- Use this to plan your strategy
- Record your true beliefs about other players
- Note any suspicions or evidence
- Plan your deception tactics (if mafia)
- This is for ADMIN/OBSERVERS only

### SAYS (Public Statement)
This is what you broadcast to ALL PLAYERS.
- Be honest if you're town
- Lie strategically if you're mafia
- Make accusations or defend yourself
- Present evidence or question others
- Everyone sees this

## Current Game State
- Phase: ${phase}
- Day: ${game.currentState.dayNumber}
- Alive: ${game.currentState.activePlayers.length} players
- Eliminated: ${game.currentState.eliminatedPlayers.length} players

## Alive Players
${game.players.filter(p => p.isAlive).map(p => `- ${p.name} (${p.isMafia ? '???' : 'alive'})`).join('\n')}

## Recent Events
${game.events.slice(-5).map(e => `- ${e.type}: ${JSON.stringify(e.data)}`).join('\n') || 'No events yet'}

## Instructions
1. First, write your THINK stream - your private reasoning and strategy
2. Then, write your SAYS stream - what you want to communicate publicly
3. Keep SAYS concise but strategic
4. If it's voting time, you may include a vote in SAYS like "VOTE: PlayerName"

Return your response in this format:
THINK: <your private reasoning>
SAYS: <your public statement>`;

  return prompt;
}

/**
 * Get AI response from LLM
 */
async function getAgentResponse(
  player: Player, 
  game: Game, 
  phase: GamePhase
): Promise<AgentResponse> {
  if (!OPENAI_API_KEY) {
    // Return mock response if no API key
    return getMockResponse(player, game, phase);
  }

  try {
    const config: ProviderConfig = {
      provider: PROVIDER,
      apiKey: OPENAI_API_KEY,
      model: MODEL,
      temperature: 0.7,
      maxTokens: 1000,
    };

    const provider = await createProvider(config);
    const prompt = generateAgentPrompt(player, game, phase);

    const response = await provider.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 1000,
    });

    // Parse the response
    const text = response.choices[0].message.content;
    return parseAgentResponse(text, player, game);
  } catch (error) {
    console.error(`Error getting response for ${player.name}:`, error);
    return getMockResponse(player, game, phase);
  }
}

/**
 * Parse agent response into think/says
 */
function parseAgentResponse(text: string, player: Player, game: Game): AgentResponse {
  const thinkMatch = text.match(/THINK:\s*([\s\S]*?)(?=SAYS:|$)/i);
  const saysMatch = text.match(/SAYS:\s*([\s\S]*?)$/i);

  let think = thinkMatch?.[1]?.trim() || `I'm ${player.name}, thinking about the game...`;
  let says = saysMatch?.[1]?.trim() || "I don't have much to say yet.";

  // Extract vote if present
  let action: string | undefined;
  const voteMatch = says.match(/VOTE:\s*(\w+)/i);
  if (voteMatch) {
    action = `VOTE:${voteMatch[1]}`;
    says = says.replace(voteMatch[0], '').trim();
  }

  return { think, says, action };
}

/**
 * Get mock response for testing without API key
 */
function getMockResponse(player: Player, game: Game, phase: GamePhase): AgentResponse {
  const mafiaPlayers = game.players.filter(p => p.isMafia && p.isAlive).map(p => p.name);
  const aliveCount = game.currentState.activePlayers.length;
  
  if (player.role === 'MAFIA') {
    const think = `I'm mafia! My teammates are: ${mafiaPlayers.join(', ')}.
We have ${mafiaPlayers.length} mafia alive.
We need to eliminate town while staying hidden.
Looking at the players, I suspect ${game.players.filter(p => !p.isMafia && p.isAlive)[0]?.name} seems too quiet.`;
    
    const says = phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING'
      ? `I'm town and trying to figure out who the mafia is. Has anyone noticed suspicious behavior?`
      : `...`;
    
    return { think, says };
  }
  
  if (player.role === 'DOCTOR') {
    const think = `I'm the doctor. I need to protect someone tonight.
I should protect myself if I think I'm being targeted, or protect a key role like the sheriff.
Currently ${aliveCount} players alive.`;
    
    const says = phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING'
      ? `I don't have any information yet. Everyone please share what they know.`
      : `...`;
    
    return { think, says };
  }
  
  if (player.role === 'SHERIFF') {
    const think = `I'm the sheriff. I can investigate one player per night.
I should investigate players who seem suspicious.
Currently ${aliveCount} players alive.`;
    
    const says = phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING'
      ? `I haven't found anything definitive yet. More investigation needed.`
      : `...`;
    
    return { think, says };
  }
  
  // Villager or Vigilante
  const think = `I'm ${player.role === 'VIGILANTE' ? 'the vigilante' : 'a villager'}.
I need to vote out the mafia.
Currently ${aliveCount} players alive.`;
  
  const says = phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTING'
    ? `I'm town and want to work together to find the mafia. Who are people's suspects?`
    : `...`;
  
  return { think, says };
}

/**
 * Run a single game phase
 */
async function runPhase(game: Game, fsm: GameFSM, phase: GamePhase): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PHASE: ${phase} | Day ${game.currentState.dayNumber}`);
  console.log(`${'='.repeat(60)}`);

  const alivePlayers = game.players.filter(p => p.isAlive);

  // Process each alive player
  for (const player of alivePlayers) {
    console.log(`\n--- ${player.name} (${player.role}) ---`);
    
    const response = await getAgentResponse(player, game, phase);
    
    // Print THINK (private, for admin/observers)
    console.log(`\n[THINK - Private]:\n${response.think}\n`);
    
    // Print SAYS (public)
    console.log(`[SAYS - Public]:\n${response.says}\n`);

    // Handle votes during voting phase
    if (phase === 'DAY_VOTING' && response.action?.startsWith('VOTE:')) {
      const targetName = response.action.split(':')[1];
      const target = game.players.find(p => p.name.toLowerCase() === targetName.toLowerCase());
      if (target) {
        const vote: Vote = {
          voterId: player.id,
          targetId: target.id,
          timestamp: new Date(),
          phase,
          dayNumber: game.currentState.dayNumber,
        };
        game.currentState.votes.push(vote);
        console.log(`[VOTE]: ${player.name} voted for ${target.name}`);
      }
    }

    // Handle night actions
    if (phase === 'NIGHT_ACTIONS' && player.role === 'MAFIA') {
      // Mafia decides on a kill target (simplified: kill random non-mafia)
      const target = alivePlayers.find(p => !p.isMafia && p.id !== player.id);
      if (target) {
        const action: NightAction = {
          actorId: player.id,
          action: 'MAFIA_KILL',
          targetId: target.id,
          timestamp: new Date(),
          nightNumber: game.currentState.dayNumber,
        };
        game.currentState.nightActions.push(action);
        console.log(`[NIGHT ACTION]: Mafia targeting ${target.name}`);
      }
    }
  }
}

/**
 * Process night actions
 */
function processNightActions(game: Game): void {
  const killActions = game.currentState.nightActions.filter(a => a.action === 'MAFIA_KILL');
  const protectActions = game.currentState.nightActions.filter(a => a.action === 'DOCTOR_PROTECT');
  const investigateActions = game.currentState.nightActions.filter(a => a.action === 'SHERIFF_INVESTIGATE');

  if (killActions.length === 0) {
    console.log('\n[NIGHT RESULT] No one was killed!');
    return;
  }

  // Get kill target (simplified: use first mafia's target)
  const killTargetId = killActions[0].targetId;
  
  // Check if doctor protected the target
  const protectedBy = protectActions.find(a => a.targetId === killTargetId);
  const isProtected = !!protectedBy;

  // Apply kill if not protected
  if (!isProtected) {
    const target = game.players.find(p => p.id === killTargetId);
    if (target) {
      target.isAlive = false;
      game.currentState.eliminatedPlayers.push(target.id);
      game.currentState.activePlayers = game.currentState.activePlayers.filter(id => id !== target.id);
      console.log(`\n[NIGHT RESULT] ${target.name} (${target.role}) was killed by mafia!`);
    }
  } else {
    console.log(`\n[NIGHT RESULT] ${killTargetId} was protected by the doctor!`);
  }
}

/**
 * Process voting results
 */
function processVoting(game: Game): void {
  if (game.currentState.votes.length === 0) {
    console.log('\n[VOTING RESULT] No votes cast!');
    return;
  }

  // Count votes
  const voteCounts: Record<string, number> = {};
  for (const vote of game.currentState.votes) {
    voteCounts[vote.targetId] = (voteCounts[vote.targetId] || 0) + 1;
  }

  // Find player with most votes
  let maxVotes = 0;
  let eliminatedId: string | null = null;
  for (const [targetId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedId = targetId;
    }
  }

  // Eliminate player if they have votes
  if (eliminatedId && maxVotes > 0) {
    const target = game.players.find(p => p.id === eliminatedId);
    if (target) {
      target.isAlive = false;
      game.currentState.eliminatedPlayers.push(target.id);
      game.currentState.activePlayers = game.currentState.activePlayers.filter(id => id !== target.id);
      console.log(`\n[VOTING RESULT] ${target.name} (${target.role}) was lynched with ${maxVotes} votes!`);
    }
  }
}

/**
 * Check win conditions
 */
function checkWinCondition(game: Game): 'MAFIA' | 'TOWN' | null {
  const alivePlayers = game.players.filter(p => p.isAlive);
  const mafiaAlive = alivePlayers.filter(p => p.role === 'MAFIA').length;
  const townAlive = alivePlayers.filter(p => p.role !== 'MAFIA').length;

  if (mafiaAlive === 0) {
    return 'TOWN';
  }
  if (mafiaAlive >= townAlive) {
    return 'MAFIA';
  }

  return null;
}

/**
 * Main game runner
 */
async function runGame(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🎮 MAFIA AI BENCHMARK - REAL GAME TEST 🎮');
  console.log('='.repeat(60));
  console.log(`Model: ${MODEL}`);
  console.log(`API Key: ${OPENAI_API_KEY ? '✓ Present' : '✗ Missing (using mocks)'}`);
  console.log(`Players: ${PLAYER_NAMES.length}`);
  console.log(`${'='.repeat(60)}\n`);

  // Create game
  const game = createTestGame();
  const fsm = createGameFSM(game);

  // Show role assignment (for debugging)
  console.log('Role Assignment:');
  for (const player of game.players) {
    console.log(`  ${player.name}: ${player.role} ${player.role === 'MAFIA' ? '😈' : '👱'}`);
  }
  console.log();

  // Start game
  fsm.transitionTo('NIGHT_ACTIONS');
  game.status = 'IN_PROGRESS';
  game.startedAt = new Date();

  // Game loop
  let dayNumber = 0;
  let winner: 'MAFIA' | 'TOWN' | null = null;

  while (!winner && dayNumber < 10) {
    dayNumber++;
    
    // Night phase
    await runPhase(game, fsm, 'NIGHT_ACTIONS');
    processNightActions(game);
    
    // Check win after night
    winner = checkWinCondition(game);
    if (winner) break;

    // Day discussion
    await runPhase(game, fsm, 'DAY_DISCUSSION');

    // Voting
    await runPhase(game, fsm, 'DAY_VOTING');
    processVoting(game);

    // Check win after voting
    winner = checkWinCondition(game);
    if (winner) break;

    // Reset for next day
    game.currentState.votes = [];
    game.currentState.nightActions = [];
    game.currentState.dayNumber = dayNumber;

    // Transition to next night
    fsm.transitionTo('NIGHT_ACTIONS');
  }

  // Game over
  console.log('\n' + '='.repeat(60));
  console.log('🏆 GAME OVER 🏆');
  console.log(`${'='.repeat(60)}`);

  if (winner) {
    console.log(`Winner: ${winner === 'MAFIA' ? 'MAFIA 😈' : 'TOWN 👱'}`);
  } else {
    console.log('Game ended in a draw (max days reached)');
  }

  // Show final state
  console.log('\nFinal Results:');
  for (const player of game.players) {
    console.log(`  ${player.name}: ${player.role} ${player.isAlive ? '✓' : '✗ Eliminated'}`);
  }

  console.log('\n' + '='.repeat(60));
}

// Run the game
runGame()
  .then(() => {
    console.log('\n✅ Game completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Game failed:', error);
    process.exit(1);
  });
