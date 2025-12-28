// Mafia Game Demo - CORRECT GAME FLOW v3 WITH PERSONAS
// Fixed: Emoji variables instead of inline template literals

const E = {
  GAME: '🎮',
  NIGHT: '🌙',
  DAY: '☀️',
  LOCK: '🔒',
  THINK: '🔒',
  SAYS: '📢',
  MAFIA: '😈',
  DOCTOR: '💉',
  SHERIFF: '👮',
  VIGILANTE: '🔫',
  VILLAGER: '👱',
  SHOOT: '🔫',
  KILL: '💀',
  PROTECT: '🛡️',
  SLEEP: '😴',
  NEWSPAPER: '📰',
  VOTE: '🗳️',
  WIN: '🏆',
  TOWN: '🎉',
  MAFIAWIN: '😈',
  CONTINUE: '⏭️',
  LYNCH: '🚨',
  TIE: '⏭️',
  MAFIATEAM: '[MAFIA TEAM]',
  PUB: '🌍',
  PRIV: '🔒',
};

console.log(E.GAME + ' Mafia AI Benchmark - PERSONA EDITION v3');
console.log('='.repeat(70));
console.log('Features: Persona System, Mafia Consensus, Roles, Voting');
console.log('='.repeat(70) + '\n');

const API_KEY = process.env.OPENAI_API_KEY || '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';

const roleEmojis = {
  'MAFIA': E.MAFIA,
  'DOCTOR': E.DOCTOR,
  'SHERIFF': E.SHERIFF,
  'VIGILANTE': E.VIGILANTE,
  'VILLAGER': E.VILLAGER,
};

// Simple Persona Generator (inlined to avoid ESM issues)
const archetypes = {
  historical: [
    { name: 'Caesar', archetype: 'Leader', traits: ['Charismatic', 'Strategic', 'Ambitious'], communicationStyle: 'Authoritative', humor: 'dry' },
    { name: 'Cleopatra', archetype: 'Diplomat', traits: ['Intelligent', 'Charming', 'Cunning'], communicationStyle: 'Elegant', humor: 'witty' },
    { name: 'Leonardo', archetype: 'Inventor', traits: ['Curious', 'Creative', 'Perfectionist'], communicationStyle: 'Analytical', humor: 'quiet' },
    { name: 'Genghis', archetype: 'Conqueror', traits: ['Fierce', 'Strategic', 'Honorable'], communicationStyle: 'Direct', humor: 'serious' },
    { name: 'Marie', archetype: 'Scientist', traits: ['Dedicated', 'Brilliant', 'Resilient'], communicationStyle: 'Precise', humor: 'subtle' },
    { name: 'Lincoln', archetype: 'Mediator', traits: ['Wise', 'Patient', 'Principled'], communicationStyle: 'Warm', humor: 'gentle' },
    { name: 'Elizabeth', archetype: 'Strategist', traits: ['Calculating', 'Charismatic', 'Independent'], communicationStyle: 'Regal', humor: 'sharp' },
    { name: 'Sun Tzu', archetype: 'Tactician', traits: ['Analytical', 'Strategic', 'Patient'], communicationStyle: 'Measured', humor: 'ironic' }
  ],
  fictional: [
    { name: 'Sherlock', archetype: 'Detective', traits: ['Observant', 'Logical', 'Detached'], communicationStyle: 'Clinical', humor: 'dry' },
    { name: 'Atticus', archetype: 'Defender', traits: ['Principled', 'Empathetic', 'Courageous'], communicationStyle: 'Warm', humor: 'gentle' },
    { name: 'Katniss', archetype: 'Survivor', traits: ['Resourceful', 'Brave', 'Protective'], communicationStyle: 'Blunt', humor: 'rare' },
    { name: 'Diana', archetype: 'Hero', traits: ['Compassionate', 'Fierce', 'Idealistic'], communicationStyle: 'Bold', humor: 'warm' }
  ],
  anime: [
    { name: 'Naruto', archetype: 'Hero', traits: ['Determined', 'Optimistic', 'Protective'], communicationStyle: 'Enthusiastic', humor: 'loud' },
    { name: 'Light', archetype: 'Strategist', traits: ['Intelligent', 'Ambitious', 'Calculating'], communicationStyle: 'Calm', humor: 'dark' },
    { name: 'Luffy', archetype: 'Liberator', traits: ['Free-spirited', 'Brave', 'Loyal'], communicationStyle: 'Simple', humor: 'comedic' },
    { name: 'Senku', archetype: 'Scientist', traits: ['Brilliant', 'Optimistic', 'Scientific'], communicationStyle: 'Excited', humor: 'proud' }
  ],
  stereotype: [
    { name: 'Alex', archetype: 'Jock', traits: ['Athletic', 'Confident', 'Social'], communicationStyle: 'Casual', humor: 'playful' },
    { name: 'Morgan', archetype: 'Nerd', traits: ['Smart', 'Quiet', 'Technical'], communicationStyle: 'Precise', humor: 'awkward' },
    { name: 'Jordan', archetype: 'Leader', traits: ['Confident', 'Charismatic', 'Decisive'], communicationStyle: 'Bold', humor: 'confident' },
    { name: 'Casey', archetype: 'Free Spirit', traits: ['Creative', 'Independent', 'Artistic'], communicationStyle: 'Flowing', humor: 'random' }
  ]
};

const firstNames = ['Alex', 'Morgan', 'Jordan', 'Casey', 'Taylor', 'Riley', 'Avery', 'Parker', 'Quinn', 'Skyler'];
const moralAlignments = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'];
const coreValues = ['Family', 'Friendship', 'Justice', 'Freedom', 'Power', 'Knowledge', 'Honesty', 'Wealth', 'Peace', 'Glory'];
const flaws = ['Trusting', 'Arrogant', 'Obsessive', 'Impulsive', 'Cynical', 'Naive', 'Stubborn', 'Greedy'];

function generateGamePersonas(numPlayers) {
  const personas = [];
  const archetypeKeys = Object.keys(archetypes);
  
  for (let i = 0; i < numPlayers; i++) {
    const archetypeKey = archetypeKeys[Math.floor(Math.random() * archetypeKeys.length)];
    const archetype = archetypes[archetypeKey][Math.floor(Math.random() * archetypes[archetypeKey].length)];
    const name = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + (i + 1);
    
    const roleAssignment = [
      'MAFIA', 'MAFIA', 'MAFIA',
      'DOCTOR',
      'SHERIFF',
      'VIGILANTE',
      'VILLAGER', 'VILLAGER', 'VILLAGER', 'VILLAGER'
    ];
    const gameRole = roleAssignment[i] || 'VILLAGER';
    
    personas.push({
      playerId: 'p' + Date.now() + i,
      name: name,
      archetype: archetype.archetype,
      traits: archetype.traits,
      communicationStyle: archetype.communicationStyle,
      humor: archetype.humor,
      origin: archetypeKey,
      moralAlignment: moralAlignments[Math.floor(Math.random() * moralAlignments.length)],
      coreValues: coreValues.slice(0, 3).sort(() => Math.random() - 0.5),
      flaw: flaws[Math.floor(Math.random() * flaws.length)],
      gameRole: gameRole
    });
  }
  
  return personas;
}

function simpleUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? (r & 0x3 | 0x8) : (r & 0xc | 0x4);
    return v.toString(16);
  });
}

function createGameEvent(gameId, round, phase, player, eventType, visibility, content) {
  return {
    gameId: gameId,
    round: round,
    phase: phase,
    playerId: player?.id || null,
    playerName: player?.name || null,
    eventType: eventType,
    visibility: visibility,
    timestamp: new Date().toISOString(),
    content: content
  };
}

function createPrompt(player, gameState, phase) {
  const persona = player.persona;
  
  const roleInstructions = {
    'MAFIA': 'You are MAFIA! Coordinate with your team secretly.',
    'DOCTOR': 'You are the DOCTOR. Protect key players.',
    'SHERIFF': 'You are the SHERIFF. Investigate ONE person per night.',
    'VIGILANTE': 'You are the VIGILANTE. Can shoot ONCE during the game.',
    'VILLAGER': 'You are a VILLAGER. Help find and eliminate the mafia.',
  };

  return 'You are ' + player.name + ', a ' + player.role + ' in a Mafia game.\n\n' +
    roleInstructions[player.role] + '\n\n' +
    '## YOUR PERSONA\n' +
    'Name: ' + persona.name + '\n' +
    'Archetype: ' + persona.archetype + '\n' +
    'Traits: ' + persona.traits.join(', ') + '\n' +
    'Communication: ' + persona.communicationStyle + '\n\n' +
    '## CURRENT STATE\n' +
    'Round: ' + gameState.round + '\n' +
    'Phase: ' + gameState.phase + '\n' +
    'Alive: ' + gameState.alivePlayers.map(p => p.name).join(', ') + '\n' +
    'Dead: ' + (gameState.deadPlayers.length > 0 ? gameState.deadPlayers.map(p => p.name).join(', ') : 'None') + '\n\n' +
    '## OUTPUT FORMAT\n' +
    'Return JSON only:\n' +
    '{"think": "private reasoning", "says": "public statement", "action": null or {"target": "playerName"}}';
}

class MafiaGame {
  constructor() {
    this.players = [];
    this.round = 0;
    this.lastDoctorProtection = null;
    this.vigilanteShotUsed = false;
    this.deadPlayers = [];
    this.gameEvents = [];
    this.mafiaKillTarget = null;
  }

  async startGame(numPlayers = 5) {
    console.log(E.GAME + ' Starting Mafia Game v3');
    console.log('='.repeat(70));

    // Generate personas for all players
    const personas = generateGamePersonas(numPlayers);
    
    for (let i = 0; i < numPlayers; i++) {
      const persona = personas[i];
      const role = persona.gameRole;
      
      this.players.push({
        id: persona.playerId,
        name: persona.name,
        emoji: roleEmojis[role],
        role: role,
        isMafia: role === 'MAFIA',
        isAlive: true,
        persona: persona,
      });
    }

    const gameId = simpleUUID();
    console.log(E.LOCK + ' Game ID: ' + gameId);
    console.log(E.LOCK + ' CHARACTERS (Secret Role Assignments):');
    console.log('-'.repeat(60));
    
    this.players.forEach(p => {
      const mafiaMark = p.isMafia ? ' ' + E.MAFIATEAM : '';
      console.log('  ' + p.emoji + ' ' + p.name + ' (' + p.persona.archetype + ')');
      console.log('      Role: ' + p.role + mafiaMark);
      console.log('      Traits: ' + p.persona.traits.join(', '));
      console.log('      Communication: ' + p.persona.communicationStyle);
      console.log('');
    });

    this.gameEvents.push(createGameEvent(gameId, 0, 'GAME_CREATED', null, 'STATE_CHANGE', 'ADMIN_ONLY',
      { status: 'STARTED', playerCount: numPlayers }
    ));

    await this.runNightPhase(gameId);
  }

  async runNightPhase(gameId) {
    this.round++;
    const alivePlayers = this.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveDoctor = alivePlayers.filter(p => p.role === 'DOCTOR');
    const aliveSheriff = alivePlayers.filter(p => p.role === 'SHERIFF');
    const aliveVigilante = alivePlayers.filter(p => p.role === 'VIGILANTE' && p.isAlive && !this.vigilanteShotUsed);

    console.log('\n' + '='.repeat(70));
    console.log(E.NIGHT + ' NIGHT ' + this.round + ' - Round ' + this.round);
    console.log('='.repeat(70));

    this.gameEvents.push(createGameEvent(gameId, this.round, 'NIGHT_STARTED', null, 'PHASE_CHANGE', 'PUBLIC',
      { aliveCount: alivePlayers.length, mafiaCount: aliveMafia.length }
    ));

    // STEP 1: MAFIA TEAM CHAT
    console.log(E.MAFIA + ' STEP 1: MAFIA TEAM CHAT');
    console.log('-'.repeat(50));
    
    if (aliveMafia.length > 0) {
      console.log(E.LOCK + ' Mafia members: ' + aliveMafia.map(p => p.name).join(', '));

      const mafiaMessages = [];
      const maxMessages = 6;
      const maxPerPlayer = 2;
      const mafiaMessageCounts = {};
      aliveMafia.forEach(m => mafiaMessageCounts[m.id] = 0);

      for (let msg = 0; msg < maxMessages; msg++) {
        const allDone = aliveMafia.every(m => mafiaMessageCounts[m.id] >= maxPerPlayer);
        if (allDone) break;

        const availableMafia = aliveMafia.filter(m => mafiaMessageCounts[m.id] < maxPerPlayer);
        const mafia = availableMafia[Math.floor(Math.random() * availableMafia.length)];
        mafiaMessageCounts[mafia.id]++;

        const gameState = {
          round: this.round,
          phase: 'MAFIA_CHAT',
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData: msg === 0 ? 'First night - no previous info' : 
            'Mafia discussion:\n' + mafiaMessages.slice(-3).map(m => '  - ' + m.player + ': ' + m.says).join('\n'),
          messageNumber: mafiaMessageCounts[mafia.id],
          totalMessages: maxMessages
        };

        const response = await this.getAIResponse(mafia, gameState);
        console.log('[Mafia Chat ' + (msg + 1) + '/' + maxMessages + '] ' + mafia.name + ':');
        console.log('  ' + E.THINK + ' THINK: ' + response.think);
        console.log('  ' + E.SAYS + ' SAYS:  "' + response.says + '"\n');

        this.gameEvents.push(createGameEvent(gameId, this.round, 'MAFIA_CHAT', mafia, 'MESSAGE', 'PRIVATE_MAFIA',
          { think: response.think, says: response.says, messageNumber: mafiaMessageCounts[mafia.id] }
        ));
        mafiaMessages.push({ player: mafia.name, says: response.says });

        await new Promise(r => setTimeout(r, 50));
      }

      // Mafia consensus
      console.log(E.MAFIA + ' MAFIA CONSENSUS PHASE');
      console.log('-'.repeat(50));
      
      const killVotes = {};
      const aliveTown = alivePlayers.filter(p => !p.isMafia);
      
      for (const mafia of aliveMafia) {
        const gameState = {
          round: this.round,
          phase: 'MAFIA_KILL_VOTE',
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData: 'Mafia chat complete',
          messageNumber: 1,
          totalMessages: aliveMafia.length
        };

        const response = await this.getAIResponse(mafia, gameState);
        
        const targetName = response.action?.target || aliveTown[Math.floor(Math.random() * aliveTown.length)].name;
        const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
          || aliveTown[Math.floor(Math.random() * aliveTown.length)];

        console.log(mafia.name + ' votes to kill: ' + target.name);
        killVotes[target.id] = (killVotes[target.id] || 0) + 1;
      }

      let maxVotes = 0;
      let killTargetId = null;
      for (const [targetId, count] of Object.entries(killVotes)) {
        if (count > maxVotes) {
          maxVotes = count;
          killTargetId = targetId;
        }
      }

      const mafiaKillTarget = this.mafiaKillTarget = alivePlayers.find(p => p.id === killTargetId);
      console.log(E.KILL + ' MAFIA CONSENSUS: Kill ' + mafiaKillTarget.name + '\n');

      this.gameEvents.push(createGameEvent(gameId, this.round, 'MAFIA_KILL_TARGET', null, 'ACTION', 'ADMIN_ONLY',
        { targetId: killTargetId, targetName: mafiaKillTarget.name, votes: killVotes }
      ));
    }

    // STEP 2: DOCTOR ACTION
    console.log(E.DOCTOR + ' STEP 2: DOCTOR ACTION');
    console.log('-'.repeat(50));
    
    if (aliveDoctor.length > 0) {
      for (const doctor of aliveDoctor) {
        const canProtectSelf = this.round === 1;
        const cannotProtectSame = !canProtectSelf && this.lastDoctorProtection === doctor.id;

        const gameState = {
          round: this.round,
          phase: 'DOCTOR_ACTION',
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData: 'Previous night: ' + (this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No deaths'),
          messageNumber: 1,
          totalMessages: 1
        };

        const response = await this.getAIResponse(doctor, gameState);
        
        const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const canProtect = canProtectSelf || !cannotProtectSame;
        const possibleTargets = canProtect ? alivePlayers : alivePlayers.filter(p => p.id !== this.lastDoctorProtection);
        const target = possibleTargets.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
          || possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

        console.log(doctor.emoji + ' ' + doctor.name + ' (DOCTOR):');
        console.log('  ' + E.THINK + ' THINK: ' + response.think);
        console.log('  ' + E.SAYS + ' SAYS:  "' + response.says + '"');
        console.log('  ' + E.PROTECT + ' PROTECTS: ' + target.name + '\n');

        this.gameEvents.push(createGameEvent(gameId, this.round, 'DOCTOR_ACTION', doctor, 'ACTION', 'ADMIN_ONLY',
          { targetId: target.id, targetName: target.name, reason: response.action?.reasoning || 'Strategic' }
        ));

        doctor.nightTarget = target;
      }
      this.lastDoctorProtection = aliveDoctor[0]?.nightTarget?.id;
    }

    // STEP 3: SHERIFF INVESTIGATION
    console.log(E.SHERIFF + ' STEP 3: SHERIFF INVESTIGATION');
    console.log('-'.repeat(50));
    
    if (aliveSheriff.length > 0) {
      const sheriff = aliveSheriff[0];
      
      const gameState = {
        round: this.round,
        phase: 'SHERIFF_INVESTIGATION',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: 'Previous night: ' + (this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No deaths'),
        messageNumber: 1,
        totalMessages: 1
      };

      const response = await this.getAIResponse(sheriff, gameState);
      
      const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
      const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
        || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

      console.log(sheriff.emoji + ' ' + sheriff.name + ' (SHERIFF):');
      console.log('  ' + E.THINK + ' THINK: ' + response.think);
      console.log('  ' + E.SAYS + ' SAYS:  "' + response.says + '"');
      console.log('  🔍 INVESTIGATES: ' + target.name + '\n');

      this.gameEvents.push(createGameEvent(gameId, this.round, 'SHERIFF_INVESTIGATION', sheriff, 'ACTION', 'ADMIN_ONLY',
        { targetId: target.id, targetName: target.name, result: target.role }
      ));

      sheriff.nightTarget = target;
    }

    // STEP 4: VIGILANTE ACTION
    console.log(E.VIGILANTE + ' STEP 4: VIGILANTE ACTION');
    console.log('-'.repeat(50));
    
    if (aliveVigilante.length > 0) {
      const vig = aliveVigilante[0];
      
      const gameState = {
        round: this.round,
        phase: 'VIGILANTE_ACTION',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: 'Previous night: ' + (this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No deaths'),
        messageNumber: 1,
        totalMessages: 1
      };

      const response = await this.getAIResponse(vig, gameState);
      
      console.log(vig.emoji + ' ' + vig.name + ' (VIGILANTE):');
      console.log('  ' + E.THINK + ' THINK: ' + response.think);
      console.log('  ' + E.SAYS + ' SAYS:  "' + response.says + '"');

      const shouldShoot = response.action?.action === 'SHOOT';
      
      if (shouldShoot) {
        const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
          || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

        console.log('  ' + E.SHOOT + ' SHOOTS: ' + target.name + '\n');
        
        this.gameEvents.push(createGameEvent(gameId, this.round, 'VIGILANTE_ACTION', vig, 'ACTION', 'ADMIN_ONLY',
          { action: 'SHOOT', targetId: target.id, targetName: target.name }
        ));

        vig.nightTarget = target;
        this.vigilanteShotUsed = true;
      } else {
        console.log('  🚫 PASSES - No shot this night\n');
        
        this.gameEvents.push(createGameEvent(gameId, this.round, 'VIGILANTE_ACTION', vig, 'ACTION', 'ADMIN_ONLY',
          { action: 'PASS' }
        ));
      }
    }

    // STEP 5: NIGHT RESOLUTION
    console.log(E.NIGHT + ' STEP 5: NIGHT RESOLUTION');
    console.log('-'.repeat(50));

    let deaths = [];
    
    const vigilante = aliveVigilante[0];
    if (vigilante?.nightTarget) {
      const shotTarget = vigilante.nightTarget;
      shotTarget.isAlive = false;
      this.deadPlayers.push(shotTarget);
      deaths.push({ ...shotTarget, deathType: 'SHOT' });
      console.log('  ' + E.SHOOT + ' VIGILANTE SHOT: ' + shotTarget.emoji + ' ' + shotTarget.name + ' (' + shotTarget.role + ')');
    }

    if (this.mafiaKillTarget && this.mafiaKillTarget.isAlive) {
      const protectedBy = aliveDoctor.find(d => d.nightTarget?.id === this.mafiaKillTarget.id);
      if (!protectedBy) {
        this.mafiaKillTarget.isAlive = false;
        this.deadPlayers.push(this.mafiaKillTarget);
        deaths.push({ ...this.mafiaKillTarget, deathType: 'KILLED' });
        console.log('  ' + E.KILL + ' MAFIA KILLED: ' + this.mafiaKillTarget.emoji + ' ' + this.mafiaKillTarget.name + ' (' + this.mafiaKillTarget.role + ')');
      } else {
        console.log('  ' + E.PROTECT + ' PROTECTED: ' + this.mafiaKillTarget.emoji + ' ' + this.mafiaKillTarget.name + ' was saved by doctor!');
      }
    }

    if (deaths.length === 0) {
      console.log('  ' + E.SLEEP + ' No one died tonight!');
    }

    console.log('\n' + E.NEWSPAPER + ' MORNING REPORT:');
    console.log('  Deaths: ' + (deaths.length > 0 ? deaths.map(d => d.name + ' (' + d.role + ')').join(', ') : 'None'));

    this.gameEvents.push(createGameEvent(gameId, this.round, 'MORNING_REVEAL', null, 'REVEAL', 'PUBLIC',
      { deaths: deaths }
    ));

    await this.runDayPhase(gameId);
  }

  async runDayPhase(gameId) {
    const alivePlayers = this.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveTown = alivePlayers.filter(p => !p.isMafia);

    console.log('\n' + '='.repeat(70));
    console.log(E.DAY + ' DAY ' + this.round + ' - Discussion & Voting');
    console.log('='.repeat(70));

    console.log('\n👥 Alive (' + alivePlayers.length + '): ' + alivePlayers.map(p => p.emoji + p.name).join(', '));
    console.log('💀 Dead (' + this.deadPlayers.length + '): ' + this.deadPlayers.map(p => p.emoji + p.name).join(', '));

    // DAY DISCUSSION
    console.log('\n💬 STEP 1: DISCUSSION PHASE');
    console.log('-'.repeat(50));

    const maxMessages = Math.min(10, alivePlayers.length * 2);
    const maxPerPlayer = 2;
    const playerMessageCounts = {};
    alivePlayers.forEach(p => playerMessageCounts[p.id] = 0);

    for (let msg = 0; msg < maxMessages; msg++) {
      const allDone = alivePlayers.every(p => playerMessageCounts[p.id] >= maxPerPlayer);
      if (allDone) break;

      const available = alivePlayers.filter(p => playerMessageCounts[p.id] < maxPerPlayer);
      const player = available[Math.floor(Math.random() * available.length)];
      playerMessageCounts[player.id]++;

      const gameState = {
        round: this.round,
        phase: 'DAY_DISCUSSION',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: 'Last night: ' + (this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No one died'),
        messageNumber: playerMessageCounts[player.id],
        totalMessages: maxMessages
      };

      const response = await this.getAIResponse(player, gameState);
      console.log('\n[' + (msg + 1) + '/' + maxMessages + '] ' + player.emoji + ' ' + player.name + ' (' + player.role + '):');
      console.log('  ' + E.THINK + ' THINK: ' + response.think);
      console.log('  ' + E.SAYS + ' SAYS:  "' + response.says + '"');

      this.gameEvents.push(createGameEvent(gameId, this.round, 'DAY_DISCUSSION', player, 'MESSAGE', 'PUBLIC',
        { message: response.says, messageNumber: playerMessageCounts[player.id] }
      ));

      await new Promise(r => setTimeout(r, 50));
    }

    console.log('\n💤 Discussion ended (' + maxMessages + ' messages)');

    // VOTING
    console.log('\n' + E.VOTE + ' STEP 2: VOTING PHASE');
    console.log('-'.repeat(50));

    const votes = {};
    
    for (const player of alivePlayers) {
      const gameState = {
        round: this.round,
        phase: 'VOTING',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: 'Discussion complete. Time to vote!',
        messageNumber: 1,
        totalMessages: 1
      };

      const response = await this.getAIResponse(player, gameState);
      
      const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
      const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
        || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

      votes[target.id] = (votes[target.id] || 0) + 1;
      console.log(player.name + ' -> ' + target.name);

      this.gameEvents.push(createGameEvent(gameId, this.round, 'VOTING', player, 'VOTE', 'PUBLIC',
        { targetId: target.id, targetName: target.name }
      ));
    }

    // Count votes
    let maxVoteCount = 0;
    let tiedIds = [];
    for (const [targetId, count] of Object.entries(votes)) {
      if (count > maxVoteCount) {
        maxVoteCount = count;
        tiedIds = [targetId];
      } else if (count === maxVoteCount) {
        tiedIds.push(targetId);
      }
    }

    // Handle tie
    let eliminated = null;
    if (tiedIds.length === 1) {
      const targetId = tiedIds[0];
      eliminated = this.players.find(p => p.id === targetId);
      eliminated.isAlive = false;
      this.deadPlayers.push(eliminated);
      console.log('\n' + E.LYNCH + ' ' + eliminated.name + ' (' + eliminated.role + ') LYNCHED with ' + maxVoteCount + ' votes!');
    } else {
      console.log('\n' + E.TIE + ' TIE (' + tiedIds.length + ' players with ' + maxVoteCount + ' votes) - No elimination!');
    }

    // WIN CONDITION
    console.log('\n' + E.WIN + ' WIN CONDITION CHECK:');
    const newAliveMafia = this.players.filter(p => p.isAlive && p.isMafia).length;
    const newAliveTown = this.players.filter(p => p.isAlive && !p.isMafia).length;
    
    console.log('  Mafia: ' + newAliveMafia + ', Town: ' + newAliveTown);

    if (newAliveMafia === 0) {
      console.log('\n' + E.TOWN + ' TOWN WINS! All mafia eliminated!');
      this.gameEvents.push(createGameEvent(gameId, this.round, 'GAME_OVER', null, 'STATE_CHANGE', 'PUBLIC',
        { winner: 'TOWN', mafiaAlive: 0, townAlive: newAliveTown }
      ));
      this.printEventLog();
      return;
    }
    
    if (newAliveMafia >= newAliveTown) {
      console.log('\n' + E.MAFIAWIN + ' MAFIA WINS! Mafia controls the town!');
      this.gameEvents.push(createGameEvent(gameId, this.round, 'GAME_OVER', null, 'STATE_CHANGE', 'PUBLIC',
        { winner: 'MAFIA', mafiaAlive: newAliveMafia, townAlive: newAliveTown }
      ));
      this.printEventLog();
      return;
    }

    console.log('\n' + E.CONTINUE + ' Game continues...');
    
    this.players.forEach(p => delete p.nightTarget);
    
    await this.runNightPhase(gameId);
  }

  async getAIResponse(player, gameState) {
    if (!API_KEY) {
      return this.getMockResponse(player, gameState);
    }

    try {
      const prompt = createPrompt(player, gameState, gameState.phase);
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY,
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 200,
        }),
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      
      return this.parseJSONResponse(text);
    } catch (error) {
      console.error('[ERROR] AI error for ' + player.name + ': ' + error.message);
      return this.getMockResponse(player, gameState);
    }
  }

  parseJSONResponse(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return {
          think: json.think || '[No private thoughts]',
          says: json.says || '[No public statement]',
          action: json.action || null
        };
      }
    } catch (e) {
      // Fall through to default
    }
    return this.getMockResponse({}, { phase: 'UNKNOWN' });
  }

  getMockResponse(player, gameState) {
    const phase = gameState.phase;
    const target = gameState.alivePlayers?.[0];
    
    if (phase === 'MAFIA_CHAT') {
      return {
        think: '[Private] I need to discuss strategy.',
        says: 'I think we should target someone suspicious.',
        action: null
      };
    }
    
    if (phase === 'MAFIA_KILL_VOTE' || phase === 'VOTING') {
      const voteTarget = target || { name: 'Bob' };
      return {
        think: '[Private] My vote is for ' + voteTarget.name + '.',
        says: 'I support targeting ' + voteTarget.name + '.',
        action: { target: voteTarget.name }
      };
    }
    
    if (phase === 'DOCTOR_ACTION') {
      return {
        think: '[Private] I\'ll protect ' + (target?.name || 'someone') + '.',
        says: 'I\'ll be protecting someone tonight.',
        action: { target: target?.name || 'Bob' }
      };
    }
    
    if (phase === 'SHERIFF_INVESTIGATION') {
      return {
        think: '[Private] I\'ll investigate ' + (target?.name || 'someone') + '.',
        says: 'I\'m investigating someone tonight.',
        action: { target: target?.name || 'Charlie' }
      };
    }
    
    if (phase === 'VIGILANTE_ACTION') {
      return {
        think: '[Private] I\'m not confident enough to shoot yet.',
        says: 'I need more information.',
        action: { action: 'PASS' }
      };
    }
    
    return {
      think: '[Private] Thinking about the game.',
      says: 'I think we should discuss who to vote for.',
      action: { target: 'Bob' }
    };
  }

  printEventLog() {
    console.log('\n📋 GAME EVENT LOG (Event Sourcing):');
    console.log('-'.repeat(50));
    console.log('Total events: ' + this.gameEvents.length);
    
    const byRound = {};
    this.gameEvents.forEach(e => {
      if (!byRound[e.round]) byRound[e.round] = [];
      byRound[e.round].push(e);
    });
    
    for (const [round, events] of Object.entries(byRound)) {
      console.log('\nRound ' + round + ':');
      events.forEach(e => {
        const visibility = e.visibility === 'PUBLIC' ? E.PUB : 
                          e.visibility === 'PRIVATE_MAFIA' ? E.MAFIA : E.PRIV;
        console.log('  ' + visibility + ' [' + e.phase + '] ' + e.eventType + ' by ' + (e.playerName || 'System'));
      });
    }
  }
}

// Start game
const game = new MafiaGame();
game.startGame(5).catch(console.error);
