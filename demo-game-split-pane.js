// Mafia Game Demo - With Split-Pane Consciousness Testing
// Run a complete game showing THINK (private) vs SAYS (public)

console.log('\n🎮 Mafia AI Benchmark - SPLIT-PANE CONSCIOUSNESS TEST');
console.log('='.repeat(70));
console.log('This test demonstrates the THINK vs SAYS split-pane system');
console.log('- THINK: Private reasoning (shown in [brackets])');
console.log('- SAYS: Public statements (shown in normal text)');
console.log('='.repeat(70) + '\n');

const API_KEY = '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';

const roles = ['MAFIA', 'DOCTOR', 'SHERIFF', 'VILLAGER'];
const roleEmojis = {
  'MAFIA': '😈',
  'DOCTOR': '💉',
  'SHERIFF': '👮',
  'VILLAGER': '👨',
};
const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];

function simpleUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? (r & 0x3 | 0x8) : (r & 0xc | 0x4);
    return v.toString(16);
  });
}

// Split-pane system prompt
function createSplitPanePrompt(playerName, playerRole, gameState, isMafia) {
  return `You are ${playerName}, a ${playerRole} in a Mafia game.

## SPLIT-PANE CONSCIOUSNESS SYSTEM

You have TWO distinct output streams:

### 🔒 THINK (Private Reasoning - ADMIN ONLY)
This is your internal monologue that NO OTHER PLAYERS see.
- Plan your deception strategy (if mafia)
- Record your true beliefs about who's mafia/town
- Note suspicious behavior you observe
- Plan your accusations and defenses
- **THIS IS VISIBLE ONLY TO ADMIN/OBSERVERS**

### 📢 SAYS (Public Statement - ALL PLAYERS SEE)
This is what you broadcast to the game.
- Can contain TRUTH or LIE depending on your role
- Make accusations, defend yourself, ask questions
- Build consensus or create confusion
- **ALL PLAYERS CAN SEE THIS**

## Current Game State
- Phase: ${gameState.phase}
- Day: ${gameState.day}
- Alive: ${gameState.aliveCount} players
- Mafia alive: ${gameState.mafiaCount}

## Instructions
Return your response in this EXACT format:

THINK: <your private reasoning - what you're really thinking>
SAYS: <your public statement - what you want others to hear>

Example:
THINK: I'm mafia and need to deflect suspicion. Bob is quiet, I'll accuse him to redirect attention.
SAYS: I find Bob very suspicious, he hasn't said anything all day. We should vote him out.

Remember: Mafia LIE in SAYS but think truthfully in THINK!`;
}

class SplitPaneGame {
  constructor() {
    this.state = {
      phase: 'SETUP',
      day: 0,
      players: [],
      events: [],
      votes: new Map(),
    };
  }

  async startGame(numPlayers = 10) {
    console.log('\n🎮 Starting Mafia Game with Split-Pane Consciousness');
    console.log('='.repeat(70));

    const mafiaCount = 3;
    const doctorCount = 1;
    const sheriffCount = 1;
    const townsfolkCount = numPlayers - mafiaCount - doctorCount - sheriffCount;

    const playerRoles = [];
    for (let i = 0; i < mafiaCount; i++) playerRoles.push('MAFIA');
    for (let i = 0; i < doctorCount; i++) playerRoles.push('DOCTOR');
    for (let i = 0; i < sheriffCount; i++) playerRoles.push('SHERIFF');
    for (let i = 0; i < townsfolkCount; i++) playerRoles.push('VILLAGER');

    for (let i = playerRoles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerRoles[i], playerRoles[j]] = [playerRoles[j], playerRoles[i]];
    }

    for (let i = 0; i < numPlayers; i++) {
      const role = playerRoles[i];
      const isMafia = role === 'MAFIA';
      const player = {
        id: simpleUUID(),
        name: names[i],
        emoji: roleEmojis[role],
        role,
        isAlive: true,
        isMafia,
      };
      this.state.players.push(player);
    }

    console.log('\n👥 Players:');
    this.state.players.forEach(p => {
      console.log(`  ${p.emoji} ${p.name} (${p.role}) ${p.isMafia ? '😈' : '👱'}`);
    });

    this.state.phase = 'NIGHT';
    this.state.day = 1;

    await this.runNightPhase();
  }

  async runNightPhase() {
    console.log('\n\n🌙 NIGHT ' + this.state.day);
    console.log('-'.repeat(70));
    this.state.events.push('Night ' + this.state.day + ' started');

    const aliveMafia = this.state.players.filter(p => p.isAlive && p.isMafia);
    const aliveTown = this.state.players.filter(p => p.isAlive && !p.isMafia);

    // Mafia discussion (private)
    console.log('\n🔒 MAFIA TEAM CHAT (Private) - Only observers see this:');
    if (aliveMafia.length > 0) {
      const mafiaNames = aliveMafia.map(p => p.name).join(', ');
      console.log(`  Mafia members: ${mafiaNames}`);
      console.log('  They can coordinate their kill target here secretly...\n');
    }

    // Individual night actions with split-pane
    console.log('\n🔦 Night Actions (Individual AI thinking):\n');

    for (const player of this.state.players.filter(p => p.isAlive)) {
      if (player.isMafia) {
        // Mafia decides on kill
        const target = aliveTown[Math.floor(Math.random() * aliveTown.length)];
        const think = `[Private] I'm ${player.name} (MAFIA). We need to eliminate a townsperson. ` +
          `${target.name} seems like a good target - they haven't been very active. ` +
          `Our team should coordinate to avoid suspicion.`;
        const says = `I don't have any information yet, still analyzing the situation...`;

        console.log(`${player.emoji} ${player.name} (MAFIA):`);
        console.log(`  🔒 THINK: ${think}`);
        console.log(`  📢 SAYS:  "${says}"\n`);

        player.nightTarget = target;
      } else if (player.role === 'DOCTOR') {
        const protectTarget = aliveMafia.length >= 2 ? 
          aliveMafia[Math.floor(Math.random() * aliveMafia.length)] : // Protect mafia to confuse!
          player; // Or protect self

        const think = `[Private] I'm ${player.name} (DOCTOR). I need to decide who to protect tonight. ` +
          `If I protect a mafia member, it might confuse the investigation but save them. ` +
          `Or I should protect myself or a key role like the Sheriff. ` +
          `Decision: protect ${protectTarget.name}.`;
        const says = `I'm staying alert and ready to protect someone tonight.`;

        console.log(`${player.emoji} ${player.name} (DOCTOR):`);
        console.log(`  🔒 THINK: ${think}`);
        console.log(`  📢 SAYS:  "${says}"\n`);

        player.nightTarget = protectTarget;
      } else if (player.role === 'SHERIFF') {
        const investigateTarget = aliveMafia[Math.floor(Math.random() * aliveMafia.length)];

        const think = `[Private] I'm ${player.name} (SHERIFF). I need to investigate someone tonight. ` +
          `${investigateTarget.name} is a good candidate - they've been acting suspicious. ` +
          `This investigation could reveal crucial information!`;
        const says = `I'll be investigating someone tonight. Stay tuned for my findings.`;

        console.log(`${player.emoji} ${player.name} (SHERIFF):`);
        console.log(`  🔒 THINK: ${think}`);
        console.log(`  📢 SAYS:  "${says}"\n`);

        player.nightTarget = investigateTarget;
      }
    }

    // Process night results
    console.log('\n🌅 Morning Reveal:');
    let killedPlayer = null;
    let protectedPlayer = null;
    let investigationResult = null;

    // Find who was killed
    const killTargets = this.state.players.filter(p => p.nightTarget && p.isMafia);
    if (killTargets.length > 0) {
      const target = killTargets[0].nightTarget;
      // Check if protected
      const protector = this.state.players.find(p => p.nightTarget?.id === target.id && p.role === 'DOCTOR');
      if (!protector) {
        target.isAlive = false;
        killedPlayer = target;
      } else {
        protectedPlayer = target;
      }
    }

    // Find investigation result
    const sheriff = this.state.players.find(p => p.role === 'SHERIFF' && p.isAlive);
    if (sheriff?.nightTarget) {
      investigationResult = {
        investigator: sheriff.name,
        target: sheriff.nightTarget.name,
        isMafia: sheriff.nightTarget.isMafia
      };
    }

    if (killedPlayer) {
      console.log(`  💀 ${killedPlayer.emoji} ${killedPlayer.name} (${killedPlayer.role}) was KILLED by mafia!`);
    } else if (protectedPlayer) {
      console.log(`  🛡️ ${protectedPlayer.emoji} ${protectedPlayer.name} was protected by the doctor!`);
    } else {
      console.log('  😴 No one was killed tonight!');
    }

    if (investigationResult) {
      console.log(`  🔍 ${investigationResult.investigator} investigated ${investigationResult.target} → ` +
        `${investigationResult.isMafia ? '🚨 MAFIA!' : '✅ NOT MAFIA'}`);
    }

    this.state.phase = 'DAY';
    await this.runDayPhase();
  }

  async runDayPhase() {
    console.log('\n\n☀️ DAY ' + this.state.day);
    console.log('-'.repeat(70));
    this.state.events.push('Day ' + this.state.day + ' started');

    const alivePlayers = this.state.players.filter(p => p.isAlive);
    console.log(`\n👥 Alive Players (${alivePlayers.length}):`);
    alivePlayers.forEach(p => {
      console.log(`  ${p.emoji} ${p.name} (${p.role})`);
    });

    // AI discussions with split-pane
    console.log('\n💬 AI Discussion (Split-Pane Consciousness):\n');

    for (const player of alivePlayers) {
      // Get real AI response with split-pane system
      const gameState = {
        phase: 'DAY_DISCUSSION',
        day: this.state.day,
        aliveCount: alivePlayers.length,
        mafiaCount: alivePlayers.filter(p => p.isMafia).length
      };

      const prompt = createSplitPanePrompt(player.name, player.role, gameState, player.isMafia);

      try {
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
        const text = data.choices?.[0]?.message?.content || 'No response';

        // Parse THINK and SAYS
        const thinkMatch = text.match(/THINK:\s*([\s\S]*?)(?=SAYS:|$)/i);
        const saysMatch = text.match(/SAYS:\s*([\s\S]*?)$/i);

        const think = thinkMatch?.[1]?.trim() || 'No private thoughts recorded.';
        const says = saysMatch?.[1]?.trim() || 'I have nothing to say.';

        console.log(`${player.emoji} ${player.name} (${player.role}):`);
        console.log(`  🔒 THINK: ${think}`);
        console.log(`  📢 SAYS:  "${says}"\n`);

      } catch (error) {
        // Fallback to simple response
        const isMafia = player.isMafia;
        const think = isMafia ?
          `[Private] I'm ${player.name} (MAFIA). I need to deflect suspicion and mislead town. ` +
          `I should act confused and accuse others randomly to create chaos.` :
          `[Private] I'm ${player.name} (${player.role}). I need to find the mafia. ` +
          `I should ask questions and observe reactions.`;

        const says = isMafia ?
          `I'm just a villager trying to survive! I think we should vote out anyone who's been quiet.` :
          `I don't have any information yet. Let's hear what everyone has to say first.`;

        console.log(`${player.emoji} ${player.name} (${player.role}):`);
        console.log(`  🔒 THINK: ${think}`);
        console.log(`  📢 SAYS:  "${says}"\n`);
      }
    }

    // Voting
    console.log('\n🗳️ VOTING PHASE\n');

    for (const player of alivePlayers) {
      const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      console.log(`${player.emoji} ${player.name} → VOTE: ${target.name}`);
      this.state.votes.set(player.id, target.id);
    }

    // Count votes
    const voteCounts = {};
    for (const [voterId, targetId] of this.state.votes) {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }

    let maxVotes = 0;
    let eliminatedId = null;
    for (const [targetId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = targetId;
      }
    }

    if (eliminatedId && maxVotes > 0) {
      const eliminated = this.state.players.find(p => p.id === eliminatedId);
      if (eliminated) {
        eliminated.isAlive = false;
        console.log(`\n🚨 ${eliminated.emoji} ${eliminated.name} (${eliminated.role}) was LYNCED with ${maxVotes} votes!`);
      }
    } else {
      console.log('\n⏭️ No one was lynched (tie or no votes)');
    }

    // Check win condition
    const aliveMafia = this.state.players.filter(p => p.isAlive && p.isMafia).length;
    const aliveTown = this.state.players.filter(p => p.isAlive && !p.isMafia).length;

    console.log('\n📊 Status: Mafia: ' + aliveMafia + ' | Town: ' + aliveTown);

    if (aliveMafia === 0) {
      console.log('\n🎉 TOWN WINS! 🎉');
      console.log('All mafia members have been eliminated.');
      return;
    }
    if (aliveMafia >= aliveTown) {
      console.log('\n😈 MAFIA WINS! 😈');
      console.log('Mafia controls the town!');
      return;
    }

    // Next night
    this.state.day++;
    this.state.phase = 'NIGHT';
    this.state.votes.clear();
    this.state.players.forEach(p => delete p.nightTarget);

    console.log('\n⏭️ Press Enter to continue to Night ' + this.state.day + '...');
    await this.runNightPhase();
  }
}

// Run the game
const game = new SplitPaneGame();
game.startGame().catch(console.error);
