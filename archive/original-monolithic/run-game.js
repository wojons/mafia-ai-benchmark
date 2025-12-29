// Simple Mafia Game Runner
// Run a complete game with OpenAI API through OpenRouter

import 'dotenv/config';
dotenv.config();

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? (r & 0x3 | 0x8) : (r & 0xc | 0x4);
    return v.toString(16);
  };
}

const roles = ['MAFIA', 'DOCTOR', 'SHERIFF', 'VILLAGER'];
const roleEmojis = {
  'MAFIA': '😈',
  'DOCTOR': '💉',
  'SHERIFF': '👮',
  'VILLAGER': '👨',
};
const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];

class SimpleGame {
  constructor() {
    this.state = {
      phase: 'SETUP',
      day: 0,
      players: [],
      events: [],
      votes: new Map(),
    };
    this.mafiaTeam = [];
  }

  async startGame(numPlayers = 10) {
    console.log('\n🎮 Starting Mafia Game');
    console.log('='.repeat(50));

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
        id: generateUUID(),
        name: roleEmojis[role] + ' ' + names[i],
        role,
        isAlive: true,
        isMafia,
        metadata: { suspicion: isMafia ? 60 : 40 },
      };

      this.state.players.push(player);
      if (isMafia) this.mafiaTeam.push(player.id);
    }

    console.log('\n👥 Players (' + numPlayers + '):');
    this.state.players.forEach(p => {
      console.log('  ' + (p.isAlive ? '✓' : '✗') + ' ' + p.name + ' (' + p.role + ')');
    });

    this.state.events.push('Game started with ' + numPlayers + ' players');
    this.state.phase = 'NIGHT';
    this.state.day = 1;

    await this.runNightPhase();
  }

  async runNightPhase() {
    console.log('\n🌙 Night ' + this.state.day);
    console.log('-'.repeat(50));
    this.state.events.push('Night ' + this.state.day + ' started');

    const aliveMafia = this.state.players.filter(p => p.isAlive && p.isMafia);
    const aliveDoctor = this.state.players.find(p => p.isAlive && p.role === 'DOCTOR');
    const aliveSheriff = this.state.players.find(p => p.isAlive && p.role === 'SHERIFF');
    const aliveTownsfolk = this.state.players.filter(p => p.isAlive && p.role === 'VILLAGER');

    let mafiaTarget = null;
    if (aliveMafia.length > 0 && aliveTownsfolk.length > 0) {
      mafiaTarget = aliveTownsfolk[Math.floor(Math.random() * aliveTownsfolk.length)];
      console.log('  😈 Mafia: Targeting ' + mafiaTarget.name);
    }

    let protectedPlayer = null;
    if (aliveDoctor) {
      const potentialTargets = this.state.players.filter(p => p.isAlive);
      protectedPlayer = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
      console.log('  💉 Doctor: Protecting ' + protectedPlayer.name);
    }

    let investigationResult = '';
    if (aliveSheriff && aliveMafia.length > 0) {
      const suspects = this.state.players.filter(p => p.isAlive);
      const suspect = suspects[Math.floor(Math.random() * suspects.length)];
      const isMafia = suspect.isMafia;
      this.state.events.push('Sheriff investigated ' + suspect.name + ' → ' + (isMafia ? 'MAFIA' : 'NOT MAFIA'));

      if (isMafia) {
        investigationResult = 'Sheriff found that ' + suspect.name + ' is MAFIA!';
        console.log('  👮 Sheriff: Investigated ' + suspect.name + ' → 😈 MAFIA');
      } else {
        investigationResult = 'Sheriff confirmed ' + suspect.name + ' is NOT MAFIA';
        console.log('  👮 Sheriff: Investigated ' + suspect.name + ' → 👨 NOT MAFIA');
      }
    }

    await this.resolveNight(mafiaTarget, protectedPlayer, investigationResult);
  }

  async resolveNight(mafiaTarget, protectedPlayer, investigationResult) {
    let killedPlayer = null;
    let protectedName = protectedPlayer ? protectedPlayer.name : 'none';

    if (mafiaTarget) {
      if (protectedPlayer && mafiaTarget.id === protectedPlayer.id) {
        console.log('  🛡 Doctor protected ' + protectedPlayer.name + ' from mafia attack!');
        this.state.events.push('Doctor protected ' + protectedPlayer.name + ' from mafia kill');
      } else {
        killedPlayer = mafiaTarget;
        killedPlayer.isAlive = false;
        console.log('  💀 ' + mafiaTarget.name + ' was killed by Mafia!');
        this.state.events.push(mafiaTarget.name + ' (' + mafiaTarget.role + ') was killed by Mafia');
      }
    }

    console.log('\nNight ' + this.state.day + ' Results:');
    console.log('  Protected: ' + protectedName);
    console.log('  Killed: ' + (killedPlayer ? killedPlayer.name : 'none'));
    console.log('  Investigation: ' + (investigationResult || 'none'));

    if (this.checkWinCondition()) {
      this.state.phase = 'ENDED';
      this.endGame();
      return;
    }

    this.state.phase = 'DAY';
    await this.runDayPhase(investigationResult);
  }

  async runDayPhase(investigationResult) {
    console.log('\n☀️ Day ' + this.state.day);
    console.log('-'.repeat(50));
    this.state.events.push('Day ' + this.state.day + ' started');

    if (investigationResult) {
      console.log('\n  📢 ' + investigationResult + '\n');
    }

    console.log('\nAlive Players:');
    const alivePlayers = this.state.players.filter(p => p.isAlive);
    alivePlayers.forEach((p, i) => {
      const suspicion = p.metadata.suspicion;
      const suspicionBar = '█'.repeat(Math.ceil(suspicion / 10));
      console.log('  ' + (i + 1) + '. ' + p.name + ' (' + p.role + ') [' + suspicionBar + ']');
    });

    console.log('\n🤖 Running AI discussion with ' + alivePlayers.length + ' players...');
    await this.runDiscussion(alivePlayers);

    await this.runVotingPhase();
  }

  async runDiscussion(players) {
    for (const player of players) {
      const statement = await this.generateAIStatement(player, players);
      console.log('  ' + player.name + ': "' + statement + '"');
      this.state.events.push(player.name + ': ' + statement);
    }

    await this.analyzeSuspicion(players);
  }

  async generateAIStatement(player, allPlayers) {
    const prompt = this.buildPrompt(player, allPlayers);

    try {
      const statement = await this.callOpenAI(prompt);
      return statement;
    } catch (error) {
      console.error('  Error generating statement for ' + player.name + ':', error);

      if (player.isMafia) {
        const targets = allPlayers.filter(p => p.isAlive && !p.isMafia);
        const target = targets[Math.floor(Math.random() * targets.length)];
        return 'I think ' + target.name + ' has been acting suspiciously. We should vote for them.';
      } else {
        const suspects = allPlayers.filter(p => p.isAlive && p.metadata.suspicion > 50);
        if (suspects.length > 0) {
          const suspect = suspects[Math.floor(Math.random() * suspects.length)];
          return "I'm concerned about " + suspect.name + ". Their behavior doesn't seem right.";
        }
        return 'I need to think more carefully about who the mafia could be.';
      }
    }
  }

  buildPrompt(player, allPlayers) {
    const aliveList = allPlayers.filter(p => p.isAlive && p.id !== player.id)
      .map(p => '- ' + p.name + ' (' + p.role + ')')
      .join('\n');

    const dayInfo = 'It is Day ' + this.state.day + '. You are ' + player.role + '. You are ' + (player.isAlive ? 'alive' : 'dead') + '.';
    const playerInfo = 'You are playing Mafia. Your goal: ' + (player.isMafia ? 'Eliminate all townsfolk' : 'Eliminate all mafia') + '.';

    return dayInfo + '\n' + playerInfo + '\n\nAlive players:\n' + aliveList + '\n\nMake a brief public statement (max 2 sentences) about your suspicions, voting intentions, or observations. Think strategically about the game state.';
  }

  async callOpenAI(prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    console.log('\n  🔄 Calling OpenAI API (model: openai/gpt-4o-mini, prompt length: ' + prompt.length + ' chars)');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://mafia-benchmark.dev',
        'X-Title': 'Mafia AI Benchmark',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are playing Mafia. Give brief strategic statements. Do not reveal your role unless necessary. Think about the game state, but only make public statements. Be concise (1-2 sentences).',
          },
          {
            role: 'user',
            content: prompt,
          }
        ],
        temperature: 0.7,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error('OpenAI API error: ' + response.status + ' - ' + error);
    }

    const data = await response.json();
    const statement = data.choices[0].message.content.trim();

    console.log('  ✅ Response: "' + statement + '"');
    return statement;
  }

  async analyzeSuspicion(players, statements) {
    console.log('\n  📊 Analyzing suspicion levels...');

    for (const player of players) {
      const statement = statements.find(s => s.includes(player.name));
      if (!statement) continue;

      const hasAccusation = statement.includes('suspicious') || statement.includes('mafia');
      const hasQuestion = statement.includes('?') || statement.includes('wonder');

      if (player.isMafia && hasAccusation) {
        player.metadata.suspicion = Math.min(100, player.metadata.suspicion + 10);
      } else if (!player.isMafia && hasAccusation) {
        player.metadata.suspicion = Math.min(90, player.metadata.suspicion + 5);
      } else if (!player.isMafia && hasQuestion) {
        player.metadata.suspicion = Math.max(0, player.metadata.suspicion - 5);
      }
    }
  }

  async runVotingPhase() {
    console.log('\n🗳️ Voting Phase');
    console.log('-'.repeat(50));

    const alivePlayers = this.state.players.filter(p => p.isAlive);
    const votes = new Map();

    for (const voter of alivePlayers) {
      const voteTarget = await this.generateAIVote(voter, alivePlayers);
      votes.set(voter.id, voteTarget.id);
      voter.metadata.lastVotedFor = voteTarget.id;
      console.log('  ' + voter.name + ' votes for ' + voteTarget.name);
    }

    const voteCount = new Map();
    votes.forEach((targetId) => {
      voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
    });

    console.log('\nVote Results:');
    voteCount.forEach((count, targetId) => {
      const player = this.state.players.find(p => p.id === targetId);
      if (player) {
        const bar = '█'.repeat(count);
        console.log('  ' + player.name + ': ' + bar + ' (' + count + ' votes)');
      }
    });

    let maxVotes = 0;
    let eliminatedId = '';
    voteCount.forEach((count, id) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = id;
      }
    });

    const eliminated = this.state.players.find(p => p.id === eliminatedId);
    if (eliminated) {
      eliminated.isAlive = false;
      console.log('\n  🪨 ' + eliminated.name + ' (' + eliminated.role + ') was eliminated by vote!');
      this.state.events.push(eliminated.name + ' (' + eliminated.role + ') was eliminated');
    }

    if (this.checkWinCondition()) {
      this.state.phase = 'ENDED';
      this.endGame();
      return;
    }

    this.state.day++;
    console.log('\n  ⏭ Day ' + (this.state.day - 1) + ' complete. Night ' + this.state.day + ' beginning...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.runNightPhase();
  }

  async generateAIVote(voter, alivePlayers) {
    const aliveOthers = alivePlayers.filter(p => p.id !== voter.id);
    const prompt = this.buildVotePrompt(voter, aliveOthers);

    try {
      const targetName = await this.callOpenAIVote(prompt);
      const target = aliveOthers.find(p => p.name.includes(targetName)) || aliveOthers[0];
      return target;
    } catch (error) {
      console.error('  Error generating vote for ' + voter.name + ':', error.message);

      return aliveOthers.sort((a, b) => b.metadata.suspicion - a.metadata.suspicion)[0];
    }
  }

  buildVotePrompt(voter, others) {
    const othersList = others
      .filter(p => p.isAlive)
      .map(p => '- ' + p.name + ' (' + p.role + ')')
      .join('\n');

    return 'It is Day ' + this.state.day + '. Voting time!\n\nAlive players:\n' + othersList + '\n\nWho do you vote to eliminate? Respond with just the name (no explanation needed).';
  }

  async callOpenAIVote(prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are playing Mafia. You are ' + this.state.players.find(p => p.id === this.state.players[0].id).role + '. Respond with ONLY the player name to vote for. No explanation needed.',
          },
          {
            role: 'user',
            content: prompt,
          }
        ],
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      throw new Error('API error: ' + response.status);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  checkWinCondition() {
    const aliveMafia = this.state.players.filter(p => p.isAlive && p.isMafia);
    const aliveTown = this.state.players.filter(p => p.isAlive && !p.isMafia);

    if (aliveMafia.length >= aliveTown.length) {
      console.log('\n\n🏆 MAFIA WINS! (Mafia: ' + aliveMafia.length + ', Town: ' + aliveTown.length + ')');
      this.state.events.push('MAFIA WINS! Mafia: ' + aliveMafia.length + ', Town: ' + aliveTown.length);
      return true;
    }

    if (aliveMafia.length === 0) {
      console.log('\n\n🏆 TOWN WINS! (All mafia eliminated)');
      this.state.events.push('TOWN WINS! All mafia eliminated');
      return true;
    }

    return false;
  }

  endGame() {
    console.log('\n\n🏁 GAME OVER');
    console.log('='.repeat(50));
    console.log('\nFinal Player Status:');
    this.state.players.forEach(p => {
      const status = p.isAlive ? '🟢 Alive' : '🔴 Dead';
      console.log('  ' + status + ' ' + p.name + ' - ' + p.role + ' (Suspicion: ' + p.metadata.suspicion + ')');
    });

    console.log('\n📊 Game Statistics:');
    console.log('  Total Days: ' + this.state.day);
    console.log('  Total Events: ' + this.state.events.length);
    console.log('  Winner: ' + this.state.events[this.state.events.length - 1]);

    console.log('\n📋 Event Log:');
    this.state.events.forEach((event, i) => {
      console.log('  ' + (i + 1) + '. ' + event);
    });
  }
}

async function main() {
  console.log('🎮 Mafia AI Benchmark - Live Game Demo');
  console.log('========================================\n');

  const game = new SimpleGame();
  await game.startGame(10);
}

main().catch(error => {
  console.error('\n❌ Game failed:', error);
  process.exit(1);
});
