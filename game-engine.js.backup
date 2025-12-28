// Mafia Game Demo - CORRECT GAME FLOW v3 WITH PERSONAS
// Implements: 
// 1. Mafia Discussion Phase → Consensus → Kill Decision
// 2. Dynamic Persona Generation (archetypes, communication styles, backstories)

console.log('\n🎮 Mafia AI Benchmark - PERSONA EDITION v3');
console.log('='.repeat(70));
console.log('Featuring:');
console.log('1. Dynamic Persona Generation (Historical, Fictional, Anime, Stereotypes)');
console.log('2. Unique Communication Styles per Character');
console.log('3. Mafia Team Discussion (multiple messages each, like day)');
console.log('4. Mafia reach CONSENSUS on kill target');
console.log('5. Doctor(s) → Protect (can\'t protect same person twice)');
console.log('6. Sheriff → Investigate (gets exact role)');
console.log('7. Vigilante → Optional Shoot (one-time only)');
console.log('8. Night Resolution → Day Discussion → Voting');
console.log('='.repeat(70) + '\n');

const API_KEY = process.env.OPENAI_API_KEY || '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';

const roleEmojis = {
  'MAFIA': '😈',
  'DOCTOR': '💉',
  'SHERIFF': '👮',
  'VIGILANTE': '🔫',
  'VILLAGER': '👱',
};

// Import Persona Generator
const PersonaGenerator = require('./packages/shared/src/persona/persona-generator.js');
const personaGenerator = new PersonaGenerator();

function simpleUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? (r & 0x3 | 0x8) : (r & 0xc | 0x4);
    return v.toString(16);
  });
}

// Create structured JSON output for game events
function createGameEvent(game, round, phase, player, eventType, visibility, content) {
  return {
    gameId: game.id,
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

// Create prompt for different phases - NOW WITH PERSONA INTEGRATION
function createPrompt(player, gameState, phase) {
  const persona = player.persona;
  
  const roleInstructions = {
    'MAFIA': `You are MAFIA! Coordinate with your team secretly. 
    - Review what your teammates said in the mafia chat
    - Build consensus on who to kill
    - Blend in with town during day discussion`,
    'DOCTOR': 'You are the DOCTOR. Protect key players. You CANNOT protect the same person two nights in a row.',
    'SHERIFF': 'You are the SHERIFF. You can investigate ONE person per night to learn their EXACT ROLE (Mafia, Doctor, Sheriff, Vigilante, or Villager).',
    'VIGILANTE': 'You are the VIGILANTE. You can shoot ONE person ONCE during the entire game. Use this wisely.',
    'VILLAGER': 'You are a VILLAGER. Help find and eliminate the mafia through discussion and voting.',
  };

  // Persona-specific communication guidance
  const communicationGuidance = `
  ## YOUR PERSONA
  You are ${persona.name}, whose personality is based on ${persona.archetype}.
  
  - **Core Traits**: ${persona.traits.join(', ')}
  - **Communication Style**: ${persona.communicationStyle} (${persona.humor} humor)
  - **Verbal Tics**: ${persona.verbalTics.join(', ')}
  - **Background**: ${persona.origin}
  - **Moral Alignment**: ${persona.moralAlignment}
  - **Core Values**: ${persona.coreValues.join(', ')}
  - **Weakness**: ${persona.flaw}
  
  Speak and think in character! Use your verbal tics naturally. Your background should influence how you approach problems.
  `;

  return `You are ${player.name}, a ${player.role} in a Mafia game.

${roleInstructions[player.role]}

${communicationGuidance}

## CURRENT STATE
- Round: ${gameState.round}
- Phase: ${gameState.phase}
- Alive: ${gameState.alivePlayers.map(p => p.name).join(', ')}
- Dead: ${gameState.deadPlayers.length > 0 ? gameState.deadPlayers.map(p => p.name).join(', ') : 'None'}

${gameState.previousPhaseData ? `## PREVIOUS PHASE
${gameState.previousPhaseData}` : ''}

## OUTPUT FORMAT
Return JSON only (no other text):

{
  "think": "Your private reasoning in character (ADMIN only)",
  "says": "Your public statement in character (ALL players see)",
  "action": ${phase === 'MAFIA_KILL_VOTE' ? `{"target": "playerName", "confidence": 0.8}` : 
           phase === 'DOCTOR_ACTION' ? `{"target": "playerName", "reasoning": "why..."}` :
           phase === 'SHERIFF_INVESTIGATION' ? `{"target": "playerName", "reasoning": "why..."}` :
           phase === 'VIGILANTE_ACTION' ? `{"action": "SHOOT" or "PASS", "target": "playerName", "confidence": 0.8}` :
           phase === 'DAY_DISCUSSION' ? `{"message": "your message in character", "references": ["playerName"]}` :
           phase === 'VOTING' ? `{"target": "playerName", "reasoning": "why..."}` :
           'null'},
  "metadata": {
    "messageNumber": ${gameState.messageNumber || 1},
    "totalMessagesInPhase": ${gameState.totalMessages || 1}
  }
}`;
}`;

}

class MafiaGame {
  constructor() {
    this.players = [];
    this.round = 0;
    this.lastDoctorProtection = null;
    this.vigilanteShotUsed = false;
    this.deadPlayers = [];
    this.gameEvents = []; // Event sourcing - stores all game events
    this.mafiaKillTarget = null; // Always declare to avoid scope issues
  }

  async startGame(numPlayers = 10) {
    console.log('\n🎮 Starting Mafia Game v3 - Persona Edition');
    console.log('='.repeat(70));

    // Generate personas for all players
    const personas = personaGenerator.generateGamePersonas(numPlayers);
    
    // Create players from personas
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
        persona: persona, // Store full persona
      });
    }

    // Create game record
    const gameId = simpleUUID();
    console.log(`\n🔒 Game ID: ${gameId}`);
    console.log('\n🎭 CHARACTERS (Secret Role Assignments):');
    console.log('-'.repeat(60));
    
    this.players.forEach(p => {
      const mafiaMark = p.isMafia ? ' [MAFIA TEAM]' : '';
      console.log(`  ${p.emoji} ${p.name} (${p.persona.archetype})`);
      console.log(`      Role: ${p.role}${mafiaMark}`);
      console.log(`      Traits: ${p.persona.traits.join(', ')}`);
      console.log(`      Communication: ${p.persona.communicationStyle}`);
      console.log('');
    });

    // Store game created event
    this.gameEvents.push(createGameEvent(
      { id: gameId }, 0, 'GAME_CREATED', null, 'STATE_CHANGE', 'ADMIN_ONLY',
      { status: 'STARTED', playerCount: numPlayers, roles: this.players.map(p => ({ name: p.name, role: p.role })) }
    ));

    // Start game loop
    await this.runNightPhase(gameId);
  }

  assignRoles(numPlayers) {
    const mafiaCount = Math.floor(numPlayers / 4);
    const doctorCount = 1;
    const sheriffCount = 1;
    const vigilanteCount = 1;
    const villagerCount = numPlayers - mafiaCount - doctorCount - sheriffCount - vigilanteCount;

    const roles = [
      ...Array(mafiaCount).fill('MAFIA'),
      ...Array(doctorCount).fill('DOCTOR'),
      ...Array(sheriffCount).fill('SHERIFF'),
      ...Array(vigilanteCount).fill('VIGILANTE'),
      ...Array(villagerCount).fill('VILLAGER'),
    ];

    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    return roles;
  }

  async runNightPhase(gameId) {
    this.round++;
    const alivePlayers = this.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveTown = alivePlayers.filter(p => !p.isMafia);
    const aliveDoctor = alivePlayers.filter(p => p.role === 'DOCTOR');
    const aliveSheriff = alivePlayers.filter(p => p.role === 'SHERIFF');
    const aliveVigilante = alivePlayers.filter(p => p.role === 'VIGILANTE' && p.isAlive && !this.vigilanteShotUsed);

    console.log('\n' + '='.repeat(70));
    console.log(`🌙 NIGHT ${this.round} - Round ${this.round}`);
    console.log('='.repeat(70));

    // Store night started event
    this.gameEvents.push(createGameEvent(
      { id: gameId }, this.round, 'NIGHT_STARTED', null, 'PHASE_CHANGE', 'PUBLIC',
      { aliveCount: alivePlayers.length, mafiaCount: aliveMafia.length }
    ));

    // === STEP 1: MAFIA TEAM CHAT (Multiple messages, like day!)
    console.log('\n😈 STEP 1: MAFIA TEAM CHAT (Discussion Phase)');
    console.log('-'.repeat(50));
    
    if (aliveMafia.length > 0) {
      console.log(`🔒 Mafia members: ${aliveMafia.map(p => p.name).join(', ')}`);
      console.log('Each mafia member can discuss and reach consensus...\n');

      // Mafia discussion - multiple messages per mafia member
      const mafiaMessages = [];
      const maxMessages = 6; // 2 messages each for 3 mafia
      const maxPerPlayer = 2;

      // Track messages per mafia member
      const mafiaMessageCounts = {};
      aliveMafia.forEach(m => mafiaMessageCounts[m.id] = 0);

      // Discussion loop
      for (let msg = 0; msg < maxMessages; msg++) {
        // Check if all mafia used their messages
        const allDone = aliveMafia.every(m => mafiaMessageCounts[m.id] >= maxPerPlayer);
        if (allDone) break;

        // Pick random mafia who hasn't exhausted messages
        const availableMafia = aliveMafia.filter(m => mafiaMessageCounts[m.id] < maxPerPlayer);
        const mafia = availableMafia[Math.floor(Math.random() * availableMafia.length)];
        mafiaMessageCounts[mafia.id]++;

        const gameState = {
          round: this.round,
          phase: 'MAFIA_CHAT',
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData: msg === 0 ? 'First night - no previous info' : 
            `Mafia discussion so far:\n${mafiaMessages.slice(-3).map(m => `  - ${m.player}: ${m.says}`).join('\n')}`,
          messageNumber: mafiaMessageCounts[mafia.id],
          totalMessages: maxMessages
        };

        const response = await this.getAIResponse(mafia, gameState);
        console.log(`[Mafia Chat ${msg + 1}/${maxMessages}] ${mafia.name}:`);
        console.log(`  🔒 THINK: ${response.think}`);
        console.log(`  📢 SAYS:  "${response.says}"\n`);

        // Store mafia chat message
        const event = createGameEvent(
          { id: gameId }, this.round, 'MAFIA_CHAT', mafia, 'MESSAGE', 'PRIVATE_MAFIA',
          { 
            think: response.think,
            says: response.says,
            messageNumber: mafiaMessageCounts[mafia.id]
          }
        );
        this.gameEvents.push(event);
        mafiaMessages.push({ player: mafia.name, says: response.says, think: response.think });

        // Small delay
        await new Promise(r => setTimeout(r, 100));
      }

      // Mafia consensus/vote on kill target
      console.log('\n🤝 MAFIA CONSENSUS PHASE');
      console.log('-'.repeat(50));
      
      const killVotes = {};
      for (const mafia of aliveMafia) {
        const gameState = {
          round: this.round,
          phase: 'MAFIA_KILL_VOTE',
          alivePlayers,
          deadPlayers: this.deadPlayers,
          previousPhaseData: `Mafia chat summary:\n${mafiaMessages.slice(-3).map(m => `  - ${m.player}: ${m.says}`).join('\n')}`,
          messageNumber: 1,
          totalMessages: aliveMafia.length
        };

        const response = await this.getAIResponse(mafia, gameState);
        
        // Parse kill target from response
        const targetName = response.action?.target || aliveTown[Math.floor(Math.random() * aliveTown.length)].name;
        const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
          || aliveTown[Math.floor(Math.random() * aliveTown.length)];

        console.log(`${mafia.name} votes to kill: ${target.name}`);
        killVotes[target.id] = (killVotes[target.id] || 0) + 1;

        // Store kill vote
        this.gameEvents.push(createGameEvent(
          { id: gameId }, this.round, 'MAFIA_KILL_VOTE', mafia, 'VOTE', 'PRIVATE_MAFIA',
          { targetId: target.id, targetName: target.name, confidence: response.action?.confidence || 0.5 }
        ));
      }

      // Find kill target (majority or random if tie)
      let maxVotes = 0;
      let killTargetId = null;
      for (const [targetId, count] of Object.entries(killVotes)) {
        if (count > maxVotes) {
          maxVotes = count;
          killTargetId = targetId;
        }
      }

      const mafiaKillTarget = this.mafiaKillTarget = alivePlayers.find(p => p.id === killTargetId);
      console.log(`\n🎯 MAFIA CONSENSUS: Kill ${mafiaKillTarget.name}\n`);

      // Store consensus
      this.gameEvents.push(createGameEvent(
        { id: gameId }, this.round, 'MAFIA_KILL_TARGET', null, 'ACTION', 'ADMIN_ONLY',
        { targetId: killTargetId, targetName: mafiaKillTarget.name, votes: killVotes, consensus: true }
      ));
    }

    // === STEP 2: DOCTOR ACTION ===
    console.log('\n💉 STEP 2: DOCTOR ACTION');
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
          previousPhaseData: `Previous night: ${this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No deaths'}. ${this.lastInvestigation ? `Investigation: ${this.lastInvestigation.result} found.` : ''}`,
          messageNumber: 1,
          totalMessages: 1
        };

        const response = await this.getAIResponse(doctor, gameState);
        
        // Parse protection target
        const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const canProtect = canProtectSelf || !cannotProtectSame;
        const possibleTargets = canProtect ? alivePlayers : alivePlayers.filter(p => p.id !== this.lastDoctorProtection);
        const target = possibleTargets.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
          || possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

        console.log(`${doctor.emoji} ${doctor.name} (DOCTOR):`);
        console.log(`  🔒 THINK: ${response.think}`);
        console.log(`  📢 SAYS:  "${response.says}"`);
        console.log(`  🛡️ PROTECTS: ${target.name}\n`);

        // Store doctor action
        this.gameEvents.push(createGameEvent(
          { id: gameId }, this.round, 'DOCTOR_ACTION', doctor, 'ACTION', 'ADMIN_ONLY',
          { 
            targetId: target.id, 
            targetName: target.name, 
            reason: response.action?.reasoning || 'Strategic decision',
            firstNight: canProtectSelf,
            cannotProtectSame: cannotProtectSame
          }
        ));

        doctor.nightTarget = target;
      }
      this.lastDoctorProtection = aliveDoctor[0]?.nightTarget?.id;
    }

    // === STEP 3: SHERIFF INVESTIGATION ===
    console.log('\n👮 STEP 3: SHERIFF INVESTIGATION');
    console.log('-'.repeat(50));
    
    if (aliveSheriff.length > 0) {
      const sheriff = aliveSheriff[0];
      
      const gameState = {
        round: this.round,
        phase: 'SHERIFF_INVESTIGATION',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: `Previous night: ${this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No deaths'}. ${this.lastInvestigation ? `Previous investigation: ${this.lastInvestigation.target} was ${this.lastInvestigation.result}.` : ''}`,
        messageNumber: 1,
        totalMessages: 1
      };

      const response = await this.getAIResponse(sheriff, gameState);
      
      const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
      const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
        || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

      console.log(`${sheriff.emoji} ${sheriff.name} (SHERIFF):`);
      console.log(`  🔒 THINK: ${response.think}`);
      console.log(`  📢 SAYS:  "${response.says}"`);
      console.log(`  🔍 INVESTIGATES: ${target.name}\n`);

      // Store investigation
      this.gameEvents.push(createGameEvent(
        { id: gameId }, this.round, 'SHERIFF_INVESTIGATION', sheriff, 'ACTION', 'ADMIN_ONLY',
        { 
          targetId: target.id, 
          targetName: target.name, 
          result: target.role, // EXACT ROLE
          reason: response.action?.reasoning || 'Strategic decision'
        }
      ));

      sheriff.nightTarget = target;
      this.lastInvestigation = { investigator: sheriff.name, target: target.name, result: target.role };
    }

    // === STEP 4: VIGILANTE ACTION ===
    console.log('\n🔫 STEP 4: VIGILANTE ACTION');
    console.log('-'.repeat(50));
    
    if (aliveVigilante.length > 0) {
      const vig = aliveVigilante[0];
      
      const gameState = {
        round: this.round,
        phase: 'VIGILANTE_ACTION',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: `Previous night: ${this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No deaths'}. ${this.lastInvestigation ? `Sheriff found ${this.lastInvestigation.target} is ${this.lastInvestigation.result}.` : ''}`,
        messageNumber: 1,
        totalMessages: 1
      };

      const response = await this.getAIResponse(vig, gameState);
      
      console.log(`${vig.emoji} ${vig.name} (VIGILANTE):`);
      console.log(`  🔒 THINK: ${response.think}`);
      console.log(`  📢 SAYS:  "${response.says}"`);

      const shouldShoot = response.action?.action === 'SHOOT';
      
      if (shouldShoot) {
        const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
        const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
          || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

        console.log(`  🔫 SHOOTS: ${target.name}\n`);
        
        this.gameEvents.push(createGameEvent(
          { id: gameId }, this.round, 'VIGILANTE_ACTION', vig, 'ACTION', 'ADMIN_ONLY',
          { 
            action: 'SHOOT',
            targetId: target.id, 
            targetName: target.name,
            shotPreviouslyUsed: this.vigilanteShotUsed,
            confidence: response.action?.confidence || 0.5
          }
        ));

        vig.nightTarget = target;
        this.vigilanteShotUsed = true;
      } else {
        console.log(`  🚫 PASSES - No shot this night\n`);
        
        this.gameEvents.push(createGameEvent(
          { id: gameId }, this.round, 'VIGILANTE_ACTION', vig, 'ACTION', 'ADMIN_ONLY',
          { action: 'PASS', shotPreviouslyUsed: this.vigilanteShotUsed }
        ));
      }
    }

    // === STEP 5: NIGHT RESOLUTION ===
    console.log('\n🌅 STEP 5: NIGHT RESOLUTION');
    console.log('-'.repeat(50));

    let deaths = [];
    
    // Process vigilante shot first
    const vigilante = aliveVigilante[0];
    if (vigilante?.nightTarget) {
      const shotTarget = vigilante.nightTarget;
      shotTarget.isAlive = false;
      this.deadPlayers.push(shotTarget);
      deaths.push({ ...shotTarget, deathType: 'SHOT' });
      console.log(`  🔫 VIGILANTE SHOT: ${shotTarget.emoji} ${shotTarget.name} (${shotTarget.role})`);
    }

    // Process mafia kill
    if (this.mafiaKillTarget && this.mafiaKillTarget.isAlive) {
      const protectedBy = aliveDoctor.find(d => d.nightTarget?.id === this.mafiaKillTarget.id);
      if (!protectedBy) {
        this.mafiaKillTarget.isAlive = false;
        this.deadPlayers.push(this.mafiaKillTarget);
        deaths.push({ ...this.mafiaKillTarget, deathType: 'KILLED' });
        console.log(`  💀 MAFIA KILLED: ${this.mafiaKillTarget.emoji} ${this.mafiaKillTarget.name} (${this.mafiaKillTarget.role})`);
      } else {
        console.log(`  🛡️ PROTECTED: ${this.mafiaKillTarget.emoji} ${this.mafiaKillTarget.name} was saved by doctor!`);
      }
    }

    if (deaths.length === 0) {
      console.log('  😴 No one died tonight!');
    }

    // Morning report
    console.log('\n📰 MORNING REPORT:');
    console.log(`  Deaths: ${deaths.length > 0 ? deaths.map(d => `${d.name} (${d.role})`).join(', ') : 'None'}`);
    if (this.lastInvestigation) {
      console.log(`  Investigation: ${this.lastInvestigation.investigator} found ${this.lastInvestigation.target} is ${this.lastInvestigation.result}`);
    }

    // Store morning report
    this.gameEvents.push(createGameEvent(
      { id: gameId }, this.round, 'MORNING_REVEAL', null, 'REVEAL', 'PUBLIC',
      { deaths: deaths, investigation: this.lastInvestigation }
    ));

    // Proceed to day
    await this.runDayPhase(gameId);
  }

  async runDayPhase(gameId) {
    const alivePlayers = this.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveTown = alivePlayers.filter(p => !p.isMafia);

    console.log('\n' + '='.repeat(70));
    console.log(`☀️ DAY ${this.round} - Discussion & Voting`);
    console.log('='.repeat(70));

    console.log(`\n👥 Alive (${alivePlayers.length}): ${alivePlayers.map(p => `${p.emoji}${p.name}`).join(', ')}`);
    console.log(`💀 Dead (${this.deadPlayers.length}): ${this.deadPlayers.map(p => `${p.emoji}${p.name}`).join(', ')}`);

    // === DAY DISCUSSION PHASE ===
    console.log('\n💬 STEP 1: DISCUSSION PHASE');
    console.log('-'.repeat(50));

    const maxMessages = 10; // 2 per player for 5 players
    const maxPerPlayer = 2;
    const playerMessageCounts = {};
    alivePlayers.forEach(p => playerMessageCounts[p.id] = 0);

    // Discussion loop
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
        previousPhaseData: `Last night: ${this.deadPlayers.length > 0 ? this.deadPlayers.map(p => p.name).join(', ') : 'No one died'}. ${this.lastInvestigation ? `${this.lastInvestigation.investigator} found ${this.lastInvestigation.target} is ${this.lastInvestigation.result}.` : ''}`,
        messageNumber: playerMessageCounts[player.id],
        totalMessages: maxMessages
      };

      const response = await this.getAIResponse(player, gameState);
      console.log(`\n[${msg + 1}/${maxMessages}] ${player.emoji} ${player.name} (${player.role}):`);
      console.log(`  🔒 THINK: ${response.think}`);
      console.log(`  📢 SAYS:  "${response.says}"`);

      // Store day message
      this.gameEvents.push(createGameEvent(
        { id: gameId }, this.round, 'DAY_DISCUSSION', player, 'MESSAGE', 'PUBLIC',
        { 
          message: response.says,
          messageNumber: playerMessageCounts[player.id],
          referencesOldEvents: true
        }
      ));

      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n💤 Discussion ended (${maxMessages} messages)`);

    // === VOTING PHASE ===
    console.log('\n🗳️ STEP 2: VOTING PHASE');
    console.log('-'.repeat(50));

    const votes = {};
    
    for (const player of alivePlayers) {
      const gameState = {
        round: this.round,
        phase: 'VOTING',
        alivePlayers,
        deadPlayers: this.deadPlayers,
        previousPhaseData: `Discussion complete. Time to vote!`,
        messageNumber: 1,
        totalMessages: 1
      };

      const response = await this.getAIResponse(player, gameState);
      
      const targetName = response.action?.target || alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
      const target = alivePlayers.find(p => p.name.toLowerCase().includes(targetName.toLowerCase())) 
        || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

      votes[target.id] = (votes[target.id] || 0) + 1;
      console.log(`${player.name} → ${target.name}`);

      // Store vote
      this.gameEvents.push(createGameEvent(
        { id: gameId }, this.round, 'VOTING', player, 'VOTE', 'PUBLIC',
        { targetId: target.id, targetName: target.name, reason: response.action?.reasoning }
      ));
    }

    // Count votes
    let maxVotes = 0;
    let tiedIds = [];
    for (const [targetId, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        tiedIds = [targetId];
      } else if (count === maxVotes) {
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
      console.log(`\n🚨 ${eliminated.name} (${eliminated.role}) LYNCHED with ${maxVotes} votes!`);
    } else {
      console.log(`\n⏭️ TIE (${tiedIds.length} players with ${maxVotes} votes) - No elimination!`);
    }

    // Store voting results
    this.gameEvents.push(createGameEvent(
      { id: gameId }, this.round, 'VOTING_RESULTS', null, 'REVEAL', 'PUBLIC',
      { votes, tiedIds, eliminatedPlayer: eliminated?.name, eliminatedRole: eliminated?.role }
    ));

    // === WIN CONDITION ===
    console.log('\n🏆 WIN CONDITION CHECK:');
    const newAliveMafia = this.players.filter(p => p.isAlive && p.isMafia).length;
    const newAliveTown = this.players.filter(p => p.isAlive && !p.isMafia).length;
    
    console.log(`  Mafia: ${newAliveMafia}, Town: ${newAliveTown}`);

    if (newAliveMafia === 0) {
      console.log('\n🎉 TOWN WINS! All mafia eliminated!');
      this.gameEvents.push(createGameEvent(
        { id: gameId }, this.round, 'GAME_OVER', null, 'STATE_CHANGE', 'PUBLIC',
        { winner: 'TOWN', mafiaAlive: 0, townAlive: newAliveTown }
      ));
      this.printEventLog();
      return;
    }
    
    if (newAliveMafia >= newAliveTown) {
      console.log('\n😈 MAFIA WINS! Mafia controls the town!');
      this.gameEvents.push(createGameEvent(
        { id: gameId }, this.round, 'GAME_OVER', null, 'STATE_CHANGE', 'PUBLIC',
        { winner: 'MAFIA', mafiaAlive: newAliveMafia, townAlive: newAliveTown }
      ));
      this.printEventLog();
      return;
    }

    console.log('\n⏭️ Game continues...');
    
    // Reset for next round
    this.players.forEach(p => delete p.nightTarget);
    this.lastInvestigation = null;
    
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
          'Authorization': `Bearer ${API_KEY}`,
          'HTTP-Referer': 'http://localhost:3000',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      
      return this.parseJSONResponse(text);
    } catch (error) {
      console.error(`AI error for ${player.name}: ${error.message}`);
      return this.getMockResponse(player, gameState);
    }
  }

  parseJSONResponse(text) {
    try {
      // Try to extract JSON from response
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
    const isMafia = player.isMafia;
    const phase = gameState.phase;
    
    if (phase === 'MAFIA_CHAT') {
      return {
        think: `[Private] I'm ${player?.name || 'Mafia'}. I need to discuss strategy.`,
        says: `I think we should target someone who's been active.`,
        action: null
      };
    }
    
    if (phase === 'MAFIA_KILL_VOTE') {
      const target = gameState.alivePlayers?.find(p => !p.isMafia);
      return {
        think: `[Private] My vote is for ${target?.name || 'someone'}.`,
        says: `I support targeting ${target?.name || 'someone'}.`,
        action: { target: target?.name || 'Bob', confidence: 0.7 }
      };
    }
    
    if (phase === 'DOCTOR_ACTION') {
      const target = gameState.alivePlayers?.[0];
      return {
        think: `[Private] I'll protect ${target?.name || 'someone'}.`,
        says: `I'll be protecting someone tonight.`,
        action: { target: target?.name || 'Bob', reasoning: 'Strategic choice' }
      };
    }
    
    if (phase === 'SHERIFF_INVESTIGATION') {
      const target = gameState.alivePlayers?.[0];
      return {
        think: `[Private] I'll investigate ${target?.name || 'someone'}.`,
        says: `I'm investigating someone tonight.`,
        action: { target: target?.name || 'Charlie', reasoning: 'Suspicious behavior' }
      };
    }
    
    if (phase === 'VIGILANTE_ACTION') {
      return {
        think: `[Private] I'm not confident enough to shoot yet.`,
        says: `I need more information before acting.`,
        action: { action: 'PASS', confidence: 0.3 }
      };
    }
    
    return {
      think: `[Private] I'm ${player?.role || 'a player'} thinking about the game.`,
      says: `I think we should discuss who to vote for.`,
      action: { target: 'Bob', reasoning: 'Suspicious' }
    };
  }

  printEventLog() {
    console.log('\n📋 GAME EVENT LOG (Event Sourcing):');
    console.log('-'.repeat(50));
    console.log(`Total events: ${this.gameEvents.length}`);
    
    // Group by round and phase
    const byRound = {};
    this.gameEvents.forEach(e => {
      if (!byRound[e.round]) byRound[e.round] = [];
      byRound[e.round].push(e);
    });
    
    for (const [round, events] of Object.entries(byRound)) {
      console.log(`\nRound ${round}:`);
      events.forEach(e => {
        const visibility = e.visibility === 'PUBLIC' ? '🌍' : 
                          e.visibility === 'PRIVATE_MAFIA' ? '😈' : '🔒';
        console.log(`  ${visibility} [${e.phase}] ${e.eventType} by ${e.playerName || 'System'}`);
      });
    }
  }
}

// Start game
const game = new MafiaGame();
game.startGame().catch(console.error);
