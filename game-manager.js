// Mafia Game with Save/Load Functionality
// Usage: 
//   node game-manager.js new [players]     - Create new game
//   node game-manager.js continue [gameId] - Continue existing game
//   node game-manager.js list              - List all games
//   node game-manager.js delete [gameId]   - Delete a game

const fs = require('fs');
const path = require('path');

// Game storage directory
const GAMES_DIR = './saved-games';

// Ensure games directory exists
if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
}

class GameManager {
  constructor() {
    this.games = this.loadAllGames();
  }

  loadAllGames() {
    const games = {};
    const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
    
    files.forEach(file => {
      const gameId = file.replace('.json', '');
      try {
        games[gameId] = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, file), 'utf8'));
      } catch (e) {
        console.error(`Error loading game ${gameId}: ${e.message}`);
      }
    });
    
    return games;
  }

  saveGame(game) {
    const filePath = path.join(GAMES_DIR, `${game.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(game, null, 2));
    this.games[game.id] = game;
    return game.id;
  }

  deleteGame(gameId) {
    const filePath = path.join(GAMES_DIR, `${gameId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      delete this.games[gameId];
      return true;
    }
    return false;
  }

  listGames() {
    return Object.values(this.games).map(g => ({
      id: g.id,
      round: g.round,
      phase: g.phase,
      players: g.players.length,
      alive: g.players.filter(p => p.isAlive).length,
      created: new Date(g.createdAt).toLocaleString()
    }));
  }

  createGame(numPlayers = 10) {
    const game = {
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      round: 0,
      phase: 'LOBBY',
      players: this.generatePlayers(numPlayers),
      gameEvents: [],
      metadata: {
        lastDoctorProtection: null,
        vigilanteShotUsed: false,
        mafiaKillTarget: null
      }
    };

    this.saveGame(game);
    console.log(`\n🎮 Game created: ${game.id}`);
    console.log(`   Players: ${numPlayers}`);
    console.log(`   Run: node game-manager.js continue ${game.id}\n`);
    
    return game;
  }

  generatePlayers(numPlayers) {
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
    const roles = this.assignRoles(numPlayers);
    
    return roles.map((role, i) => ({
      id: `player-${i + 1}`,
      name: names[i],
      role,
      isMafia: role === 'MAFIA',
      isAlive: true,
      nightTarget: null
    }));
  }

  assignRoles(numPlayers) {
    const mafiaCount = Math.floor(numPlayers / 4);
    const roles = [
      ...Array(mafiaCount).fill('MAFIA'),
      ...Array(1).fill('DOCTOR'),
      ...Array(1).fill('SHERIFF'),
      ...Array(1).fill('VIGILANTE'),
      ...Array(numPlayers - mafiaCount - 3).fill('VILLAGER'),
    ];
    
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    return roles;
  }

  generateId() {
    return 'game-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }
}

// CLI Interface
const args = process.argv.slice(2);
const command = args[0] || 'list';
const manager = new GameManager();

switch (command) {
  case 'new':
    const numPlayers = parseInt(args[1]) || 10;
    const newGame = manager.createGame(numPlayers);
    console.log('\n👥 Players:');
    newGame.players.forEach(p => {
      const mafiaMark = p.isMafia ? ' [MAFIA]' : '';
      console.log(`  ${p.role} ${p.name}${mafiaMark}`);
    });
    break;

  case 'continue':
    const gameId = args[1];
    if (!gameId) {
      console.log('\n❌ Usage: node game-manager.js continue [gameId]');
      console.log('   Run: node game-manager.js list   to see available games\n');
      break;
    }
    
    const game = manager.games[gameId];
    if (!game) {
      console.log(`\n❌ Game not found: ${gameId}`);
      console.log('   Run: node game-manager.js list   to see available games\n');
      break;
    }
    
    console.log(`\n🔄 Continuing game: ${gameId}`);
    console.log(`   Round: ${game.round}, Phase: ${game.phase}`);
    console.log(`   Players: ${game.players.filter(p => p.isAlive).length}/${game.players.length} alive\n`);
    
    // Here you would run the game from its saved state
    // For demo, just show the game state
    console.log('👥 Alive Players:');
    game.players.filter(p => p.isAlive).forEach(p => {
      console.log(`  ${p.role} ${p.name}`);
    });
    break;

  case 'list':
    const games = manager.listGames();
    if (games.length === 0) {
      console.log('\n📋 No saved games');
      console.log('   Run: node game-manager.js new   to create a game\n');
    } else {
      console.log('\n📋 Saved Games:');
      console.log('-'.repeat(60));
      games.forEach(g => {
        console.log(`  ${g.id}`);
        console.log(`     Round: ${g.round} | Phase: ${g.phase} | Players: ${g.alive}/${g.players}`);
        console.log(`     Created: ${g.created}`);
        console.log('');
      });
      console.log('Usage:');
      console.log('  node game-manager.js continue [gameId]  - Continue a game');
      console.log('  node game-manager.js delete [gameId]    - Delete a game\n');
    }
    break;

  case 'delete':
    const deleteId = args[1];
    if (!deleteId) {
      console.log('\n❌ Usage: node game-manager.js delete [gameId]\n');
      break;
    }
    
    if (manager.deleteGame(deleteId)) {
      console.log(`\n✅ Game deleted: ${deleteId}\n`);
    } else {
      console.log(`\n❌ Game not found: ${deleteId}\n`);
    }
    break;

  default:
    console.log('\n🎮 Mafia Game Manager');
    console.log('======================');
    console.log('Commands:');
    console.log('  node game-manager.js new [players]   - Create new game (default: 10 players)');
    console.log('  node game-manager.js list            - List all saved games');
    console.log('  node game-manager.js continue [id]   - Continue an existing game');
    console.log('  node game-manager.js delete [id]     - Delete a game\n');
}
