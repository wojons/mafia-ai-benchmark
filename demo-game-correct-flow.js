// Mafia Game Demo - CORRECT GAME FLOW
// Implements: Mafia → Doctor → Sheriff → Vigilante → Day Discussion → Voting

console.log('\n🎮 Mafia AI Benchmark - CORRECT GAME FLOW');
console.log('='.repeat(70));
console.log('Following the official game flow:');
console.log('1. Mafia Team Chat → Kill Decision');
console.log('2. Doctor(s) → Protect (can\'t protect same person twice)');
console.log('3. Sheriff → Investigate (gets exact role)');
console.log('4. Vigilante → Optional Shoot (one-time only)');
console.log('5. Night Resolution → Day Discussion → Voting');
console.log('='.repeat(70) + '\n');

const API_KEY = process.env.OPENAI_API_KEY || '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';

const roleEmojis = {
  'MAFIA': '😈',
  'DOCTOR': '💉',
  'SHERIFF': '👮',
  'VIGILANTE': '🔫',
  'VILLAGER': '👱',
};

const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];

function simpleUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? (r & 0x3 | 0x8) : (r & 0xc | 0x4);
    return v.toString(16);
  });
}

// Split-pane prompt
function createSplitPanePrompt(player, gameState, context) {
  const roleInstructions = {
    'MAFIA': 'You are mafia! Coordinate with your team secretly and eliminate town members. NEVER reveal you are mafia in SAYS. Blend in with town.',
    'DOCTOR': 'You are the DOCTOR. Protect key players (yourself, Sheriff, or suspicious people). Try to figure out who is mafia.',
    'SHERIFF': 'You are the SHERIFF. You can investigate ONE person per night to learn their EXACT ROLE (Mafia, Doctor, Sheriff, Vigilante, or Villager).',
    'VIGILANTE': 'You are the VIGILANTE. You can shoot ONE person ONCE during the entire game. Use this wisely when you are confident.',
    'VILLAGER': 'You are a VILLAGER. Help find and eliminate the mafia through discussion and voting.',
  };

  return `You are ${player.name}, a ${player.role} in a Mafia game.

${roleInstructions[player.role]}

## CONTEXT
${context}

## CURRENT STATE
- Phase: ${gameState.phase}
- Day: ${gameState.day}
- Alive Players: ${gameState.alivePlayers.map(p => p.name).join(', ')}
- Dead Players: ${gameState.deadPlayers.length > 0 ? gameState.deadPlayers.map(p => p.name).join(', ') : 'None'}
${gameState.lastInvestigation ? `- Last Investigation: ${gameState.lastInvestigation.investigator} found ${gameState.lastInvestigation.target} is ${gameState.lastInvestigation.result}` : ''}

## SPLIT-PANE OUTPUT
Return your response in this EXACT format:

THINK: <your private reasoning, strategy, and true beliefs - ONLY visible to admin>
SAYS: <your public statement to all players>

Example:
THINK: I'm mafia and my teammates are X and Y. We should kill Z because they seem too active. I'll pretend to be town.
SAYS: I think we should all share our suspicions. I haven't noticed anything definitive yet.`;

}

class MafiaGame {
  constructor() {
    this.players = [];
    this.day = 0;
    this.nightCount = 0;
    this.vigilanteShot = false;
    this.lastDoctorProtection = null;
    this.deadPlayers = [];
    this.messageCount = 0;
    this.playerMessageCounts = {};
  }

  async startGame(numPlayers = 10) {
    console.log('\n🎮 Starting Mafia Game');
    console.log('='.repeat(70));

    // Assign roles
    const roles = this.assignRoles(numPlayers);
    
    for (let i = 0; i < numPlayers; i++) {
      const role = roles[i];
      this.players.push({
        id: `player-${i + 1}`,
        name: names[i],
        emoji: roleEmojis[role],
        role,
        isMafia: role === 'MAFIA',
        isAlive: true,
      });
    }

    // Show roles (admin only - don't show to players in real game!)
    console.log('\n🔒 ADMIN PANEL - Role Assignment (Secret!):');
    this.players.forEach(p => {
      const mafiaMark = p.isMafia ? ' [MAFIA TEAM]' : '';
      console.log(`  ${p.emoji} ${p.name}: ${p.role}${mafiaMark}`);
    });

    // Start game loop
    await this.runNightPhase();
  }

  assignRoles(numPlayers) {
    const mafiaCount = Math.floor(numPlayers / 4); // 3 for 10 players
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

    // Shuffle
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    return roles;
  }

  async runNightPhase() {
    this.nightCount++;
    this.day = this.nightCount;
    const alivePlayers = this.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveTown = alivePlayers.filter(p => !p.isMafia);
    const aliveDoctor = alivePlayers.filter(p => p.role === 'DOCTOR');
    const aliveSheriff = alivePlayers.filter(p => p.role === 'SHERIFF');
    const aliveVigilante = alivePlayers.filter(p => p.role === 'VIGILANTE' && p.isAlive && !this.vigilanteShot);

    console.log('\n' + '='.repeat(70));
    console.log(`🌙 NIGHT ${this.nightCount}`);
    console.log('='.repeat(70));

    // === STEP 1: MAFIA TEAM CHAT ===
    console.log('\n😈 STEP 1: MAFIA TEAM CHAT (Private)');
    console.log('-'.repeat(50));
    
    if (aliveMafia.length > 0) {
      console.log(`Mafia members: ${aliveMafia.map(p => p.name).join(', ')}`);
      console.log('They can discuss and coordinate their kill target...\n');

      // Get AI input from mafia
      for (const mafia of aliveMafia) {
        const gameState = {
          phase: 'MAFIA_CHAT',
          day: this.day,
          alivePlayers,
          deadPlayers: this.deadPlayers,
        };
        const context = `You are in the MAFIA TEAM CHAT. Your fellow mafia members are: ${aliveMafia.filter(m => m.id !== mafia.id).map(m => m.name).join(', ')}. Discuss who to kill tonight!`;
        
        const response = await this.getAIResponse(mafia, gameState, context);
        console.log(`${mafia.emoji} ${mafia.name} (MAFIA):`);
        console.log(`  🔒 THINK: ${response.think}`);
        console.log(`  📢 SAYS:  "${response.says}"\n`);
        
        mafia.nightTarget = aliveTown[Math.floor(Math.random() * aliveTown.length)];
      }
    }

    // === STEP 2: DOCTOR ACTION ===
    console.log('\n💉 STEP 2: DOCTOR ACTION');
    console.log('-'.repeat(50));
    
    if (aliveDoctor.length > 0) {
      for (const doctor of aliveDoctor) {
        const canProtectSelf = this.nightCount === 1;
        const cannotProtect = !canProtectSelf && this.lastDoctorProtection === doctor.id;

        const gameState = {
          phase: 'DOCTOR_ACTION',
          day: this.day,
          alivePlayers,
          deadPlayers: this.deadPlayers,
        };
        const context = canProtectSelf 
          ? `FIRST NIGHT: You can protect ANYONE (including yourself). Who do you protect?`
          : cannotProtect
            ? `You CANNOT protect ${alivePlayers.find(p => p.id === this.lastDoctorProtection)?.name} because you protected them last night! Pick someone else.`
            : `You can protect one person tonight. Who do you protect? (Cannot protect same person as last night)`;
        
        const response = await this.getAIResponse(doctor, gameState, context);
        console.log(`${doctor.emoji} ${doctor.name} (DOCTOR):`);
        console.log(`  🔒 THINK: ${response.think}`);
        console.log(`  📢 SAYS:  "${response.says}"\n`);
        
        // Select protection target
        const possibleTargets = canProtectSelf 
          ? alivePlayers 
          : alivePlayers.filter(p => p.id !== this.lastDoctorProtection);
        doctor.nightTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
      }
    } else {
      console.log('  No living doctors.\n');
    }

    // === STEP 3: SHERIFF INVESTIGATION ===
    console.log('\n👮 STEP 3: SHERIFF INVESTIGATION');
    console.log('-'.repeat(50));
    
    if (aliveSheriff.length > 0) {
      const sheriff = aliveSheriff[0];
      
      const gameState = {
        phase: 'SHERIFF_INVESTIGATION',
        day: this.day,
        alivePlayers,
        deadPlayers: this.deadPlayers,
      };
      const context = `You are the SHERIFF. You can investigate ONE player to learn their EXACT ROLE. Who do you investigate tonight?`;
      
      const response = await this.getAIResponse(sheriff, gameState, context);
      console.log(`${sheriff.emoji} ${sheriff.name} (SHERIFF):`);
      console.log(`  🔒 THINK: ${response.think}`);
      console.log(`  📢 SAYS:  "${response.says}"\n`);
      
      // Select investigation target
      const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      sheriff.nightTarget = target;
      
      // Store investigation result for morning
      this.lastInvestigation = {
        investigator: sheriff.name,
        target: target.name,
        result: target.role,
      };
    } else {
      console.log('  No living sheriff.\n');
      this.lastInvestigation = null;
    }

    // === STEP 4: VIGILANTE ACTION ===
    console.log('\n🔫 STEP 4: VIGILANTE ACTION');
    console.log('-'.repeat(50));
    
    if (aliveVigilante.length > 0) {
      const vig = aliveVigilante[0];
      
      const gameState = {
        phase: 'VIGILANTE_DECISION',
        day: this.day,
        alivePlayers,
        deadPlayers: this.deadPlayers,
      };
      const context = `You are the VIGILANTE. You can shoot ONE person ONCE during the entire game. This is your ${this.nightCount === 1 ? 'first and only' : 'only remaining'} chance! Are you confident enough to shoot someone? If yes, who? If no, pass.`;
      
      const response = await this.getAIResponse(vig, gameState, context);
      console.log(`${vig.emoji} ${vig.name} (VIGILANTE):`);
      console.log(`  🔒 THINK: ${response.think}`);
      console.log(`  📢 SAYS:  "${response.says}"\n`);
      
      // Decide whether to shoot
      const shoot = Math.random() < 0.3; // 30% chance to shoot for demo
      if (shoot) {
        const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        vig.nightTarget = target;
        this.vigilanteShot = true;
        console.log(`  🔫 ${vig.name} shoots ${target.name}!\n`);
      } else {
        console.log(`  🚫 ${vig.name} decides not to shoot this night.\n`);
      }
    } else {
      console.log('  No living vigilante, or already used shot.\n');
    }

    // === STEP 5: NIGHT RESOLUTION ===
    console.log('\n🌅 STEP 5: NIGHT RESOLUTION');
    console.log('-'.repeat(50));

    let killedPlayer = null;
    let protectedPlayer = null;
    let shotPlayer = null;

    // Process vigilante shot first
    const vigilante = aliveVigilante[0];
    if (vigilante?.nightTarget) {
      shotPlayer = vigilante.nightTarget;
      console.log(`  🔫 VIGILANTE SHOT: ${shotPlayer.emoji} ${shotPlayer.name} (${shotPlayer.role})`);
    }

    // Process mafia kill
    const mafiaKill = aliveMafia[0]?.nightTarget;
    if (mafiaKill) {
      // Check if doctor protected
      const protector = aliveDoctor.find(d => d.nightTarget?.id === mafiaKill.id);
      if (!protector) {
        killedPlayer = mafiaKill;
      } else {
        protectedPlayer = mafiaKill;
      }
    }

    // Apply deaths
    const deaths = [];
    if (killedPlayer) {
      killedPlayer.isAlive = false;
      this.deadPlayers.push(killedPlayer);
      deaths.push(killedPlayer);
      console.log(`  💀 KILLED: ${killedPlayer.emoji} ${killedPlayer.name} (${killedPlayer.role})`);
    }
    if (shotPlayer && shotPlayer.isAlive) {
      // Vigilante can kill even if protected
      shotPlayer.isAlive = false;
      this.deadPlayers.push(shotPlayer);
      deaths.push(shotPlayer);
      console.log(`  🔫 SHOT: ${shotPlayer.emoji} ${shotPlayer.name} (${shotPlayer.role})`);
    }
    if (protectedPlayer) {
      console.log(`  🛡️ PROTECTED: ${protectedPlayer.emoji} ${protectedPlayer.name} was protected by doctor!`);
    }
    
    // Update last doctor protection
    const doctorWhoProtected = aliveDoctor.find(d => d.nightTarget);
    if (doctorWhoProtected) {
      this.lastDoctorProtection = doctorWhoProtected.nightTarget.id;
    }

    if (deaths.length === 0) {
      console.log('  😴 No one died tonight!');
    }

    // Show investigation result
    if (this.lastInvestigation) {
      console.log(`  🔍 ${this.lastInvestigation.investigator} investigated ${this.lastInvestigation.target} → ${this.lastInvestigation.result}`);
    }

    // === PROCEED TO DAY ===
    await this.runDayPhase();
  }

  async runDayPhase() {
    const alivePlayers = this.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isMafia);
    const aliveTown = alivePlayers.filter(p => !p.isMafia);

    console.log('\n' + '='.repeat(70));
    console.log(`☀️ DAY ${this.day}`);
    console.log('='.repeat(70));

    console.log(`\n👥 Alive (${alivePlayers.length}): ${alivePlayers.map(p => `${p.emoji}${p.name}`).join(', ')}`);
    console.log(`💀 Dead (${this.deadPlayers.length}): ${this.deadPlayers.map(p => `${p.emoji}${p.name}`).join(', ')}`);

    // === DAY DISCUSSION PHASE ===
    console.log('\n💬 STEP 1: DISCUSSION PHASE');
    console.log('-'.repeat(50));
    console.log('Each player can send messages...');
    
    this.messageCount = 0;
    this.playerMessageCounts = {};
    
    // Reset message counts
    for (const player of alivePlayers) {
      this.playerMessageCounts[player.id] = 0;
    }

    // Discussion loop (max 20 messages total, 2 per player)
    const maxMessages = 20;
    const maxPerPlayer = 2;
    
    for (let msg = 0; msg < maxMessages; msg++) {
      // Check if all players used their messages
      const allDone = alivePlayers.every(p => this.playerMessageCounts[p.id] >= maxPerPlayer);
      if (allDone) break;

      // Pick a random player who hasn't reached their limit
      const availablePlayers = alivePlayers.filter(p => this.playerMessageCounts[p.id] < maxPerPlayer);
      const player = availablePlayers[Math.floor(Math.random() * availablePlayers.length)];
      
      this.playerMessageCounts[player.id]++;
      this.messageCount++;

      const gameState = {
        phase: 'DAY_DISCUSSION',
        day: this.day,
        alivePlayers,
        deadPlayers: this.deadPlayers,
      };
      const context = `It is Day ${this.day}. ${this.deadPlayers.length > 0 ? `${this.deadPlayers.map(p => p.name).join(', ')} died last night.` : 'No one died last night.'} ${this.lastInvestigation ? `${this.lastInvestigation.investigator} found that ${this.lastInvestigation.target} is ${this.lastInvestigation.result}.` : ''} What do you say to the town?`;
      
      const response = await this.getAIResponse(player, gameState, context);
      console.log(`\n[${this.messageCount}/${maxMessages}] ${player.emoji} ${player.name} (${player.role}):`);
      console.log(`  🔒 THINK: ${response.think}`);
      console.log(`  📢 SAYS:  "${response.says}"`);
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n💤 Discussion ended (${this.messageCount} messages exchanged)`);

    // === VOTING PHASE ===
    console.log('\n🗳️ STEP 2: VOTING PHASE');
    console.log('-'.repeat(50));

    const votes = {};
    
    for (const player of alivePlayers) {
      const gameState = {
        phase: 'VOTING',
        day: this.day,
        alivePlayers,
        deadPlayers: this.deadPlayers,
      };
      const context = `VOTING TIME! Who do you think is mafia? Vote carefully - ties mean no one dies!`;
      
      const response = await this.getAIResponse(player, gameState, context);
      console.log(`\n${player.emoji} ${player.name} votes:`);
      console.log(`  🔒 THINK: ${response.think}`);
      
      // Extract vote from response
      const voteMatch = response.says.match(/vote\s+(\w+)/i) || response.says.match(/(\w+)/i);
      const voteName = voteMatch ? voteMatch[1] : alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;
      const target = alivePlayers.find(p => p.name.toLowerCase().includes(voteName.toLowerCase())) 
        || alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      
      votes[target.id] = (votes[target.id] || 0) + 1;
      console.log(`  📢 SAYS:  "${response.says}"`);
      console.log(`  🗳️ VOTES FOR: ${target.name}`);
    }

    // Count votes and find winner
    console.log('\n📊 VOTE RESULTS:');
    for (const [targetId, count] of Object.entries(votes)) {
      const target = this.players.find(p => p.id === targetId);
      if (target) {
        console.log(`  ${target.name}: ${count} vote${count > 1 ? 's' : ''}`);
      }
    }

    // Find max votes
    let maxVotes = 0;
    let tiedPlayers = [];
    for (const [targetId, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        tiedPlayers = [targetId];
      } else if (count === maxVotes) {
        tiedPlayers.push(targetId);
      }
    }

    // Handle tie or elimination
    let eliminatedPlayer = null;
    if (tiedPlayers.length === 1) {
      const targetId = tiedPlayers[0];
      eliminatedPlayer = this.players.find(p => p.id === targetId);
      eliminatedPlayer.isAlive = false;
      this.deadPlayers.push(eliminatedPlayer);
      console.log(`\n🚨 ${eliminatedPlayer.emoji} ${eliminatedPlayer.name} (${eliminatedPlayer.role}) was LYNCHED with ${maxVotes} votes!`);
    } else {
      console.log(`\n⏭️ TIE (${tiedPlayers.length} players with ${maxVotes} votes) - No one eliminated!`);
    }

    // === CHECK WIN CONDITION ===
    console.log('\n🏆 WIN CONDITION CHECK:');
    const newAliveMafia = this.players.filter(p => p.isAlive && p.isMafia).length;
    const newAliveTown = this.players.filter(p => p.isAlive && !p.isMafia).length;
    
    console.log(`  Mafia alive: ${newAliveMafia}`);
    console.log(`  Town alive: ${newAliveTown}`);

    if (newAliveMafia === 0) {
      console.log('\n🎉 TOWN WINS! All mafia eliminated!');
      console.log('\n🏆 GAME OVER');
      return;
    }
    
    if (newAliveMafia >= newAliveTown) {
      console.log('\n😈 MAFIA WINS! Mafia outnumbers town!');
      console.log('\n🏆 GAME OVER');
      return;
    }

    console.log('\n⏭️ Game continues to Night ' + (this.nightCount + 1));
    
    // Reset for next round
    this.players.forEach(p => delete p.nightTarget);
    this.lastInvestigation = null;
    
    // Continue to next night
    await this.runNightPhase();
  }

  async getAIResponse(player, gameState, context) {
    if (!API_KEY) {
      // Mock response
      return this.getMockResponse(player, gameState, context);
    }

    try {
      const prompt = createSplitPanePrompt(player, gameState, context);
      
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
          max_tokens: 300,
        }),
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      
      return this.parseResponse(text, player);
    } catch (error) {
      console.error(`Error getting AI response: ${error.message}`);
      return this.getMockResponse(player, gameState, context);
    }
  }

  parseResponse(text, player) {
    const thinkMatch = text.match(/THINK:\s*([\s\S]*?)(?=SAYS:|$)/i);
    const saysMatch = text.match(/SAYS:\s*([\s\S]*?)$/i);
    
    const think = thinkMatch?.[1]?.trim() || `[Thinking about the game as ${player.role}...]`;
    const says = saysMatch?.[1]?.trim() || 'I have nothing to say.';
    
    return { think, says };
  }

  getMockResponse(player, gameState, context) {
    const isMafia = player.isMafia;
    
    let think, says;
    
    if (gameState.phase === 'MAFIA_CHAT') {
      think = `[Private] I'm ${player.name} (MAFIA). I need to coordinate with my team.`;
      says = `I think we should kill ${gameState.alivePlayers.find(p => !p.isMafia)?.name || 'someone'}.`;
    } else if (gameState.phase === 'DOCTOR_ACTION') {
      think = `[Private] I'm ${player.name} (DOCTOR). I need to decide who to protect.`;
      says = `I'll be protecting someone tonight. Stay safe everyone!`;
    } else if (gameState.phase === 'SHERIFF_INVESTIGATION') {
      think = `[Private] I'm ${player.name} (SHERIFF). I should investigate someone suspicious.`;
      says = `I'm investigating someone tonight.`;
    } else if (gameState.phase === 'VIGILANTE_DECISION') {
      think = `[Private] I'm ${player.name} (VIGILANTE). Should I use my one shot?`;
      says = `I'm considering my options carefully.`;
    } else if (gameState.phase === 'DAY_DISCUSSION') {
      think = isMafia 
        ? `[Private] I'm mafia! I need to blend in and mislead the town.`
        : `[Private] I'm ${player.role}. I need to find the mafia.`;
      says = `I think we should discuss who is suspicious. What does everyone think?`;
    } else if (gameState.phase === 'VOTING') {
      think = isMafia
        ? `[Private] I need to vote for someone who isn't mafia to avoid suspicion.`
        : `[Private] I should vote for someone I suspect is mafia.`;
      says = `I vote for... [random name]`;
    }
    
    return { think, says };
  }
}

// Start game
const game = new MafiaGame();
game.startGame().catch(console.error);
