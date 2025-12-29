// Mafia AI Benchmark - Complete Game Manager with Model Configuration
// Supports: Environment variables, database storage, player-specific models

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { PlayerModelConfig, PlayerConfigPresets } = require('./packages/shared/src/providers/player-model-config.js');

// Marker for models without pricing data
const NO_PRICING_MARKER = -6.66;

class GameManager {
  constructor() {
    this.dbPath = process.env.DB_PATH || './data/mafia.db';
    this.dataDir = path.dirname(this.dbPath);
    this.config = this.loadEnvConfig();
    this.db = this.initDatabase();
    this.pricingCache = new Map();
  }

  // Load configuration from environment variables
  loadEnvConfig() {
    return {
      // Default model
      defaultModel: process.env.DEFAULT_MODEL || 'openai/gpt-4o-mini',
      defaultProvider: 'openai',
      defaultTemperature: parseFloat(process.env.DEFAULT_TEMPERATURE) || 0.7,
      defaultMaxTokens: parseInt(process.env.DEFAULT_MAX_TOKENS) || 500,
      
      // Role-specific models
      mafiaModel: process.env.MAFIA_MODEL || null,
      doctorModel: process.env.DOCTOR_MODEL || null,
      sheriffModel: process.env.SHERIFF_MODEL || null,
      vigilanteModel: process.env.VIGILANTE_MODEL || null,
      villagerModel: process.env.VILLAGER_MODEL || null,
      
      // Game settings
      defaultPlayers: parseInt(process.env.DEFAULT_PLAYERS) || 10,
      mafiaCount: process.env.MAFIA_COUNT || null,
      doctorCount: parseInt(process.env.DOCTOR_COUNT) || 1,
      sheriffCount: parseInt(process.env.SHERIFF_COUNT) || 1,
      vigilanteCount: parseInt(process.env.VIGILANTE_COUNT) || 1,
      
      // Messaging
      mafiaMessagesPerPlayer: parseInt(process.env.MAFIA_MESSAGES_PER_PLAYER) || 3,
      mafiaMaxMessages: parseInt(process.env.MAFIA_MAX_MESSAGES) || 10,
      townMessagesPerPlayer: parseInt(process.env.TOWN_MESSAGES_PER_PLAYER) || 2,
      townMaxMessages: parseInt(process.env.TOWN_MAX_MESSAGES) || 15,
      
      // Day settings
      dayDiscussionRounds: parseInt(process.env.DAY_DISCUSSION_ROUNDS) || 1,
      votingEnabled: process.env.VOTING_ENABLED !== 'false',
      nightPhaseEnabled: process.env.NIGHT_PHASE_ENABLED !== 'false',
      personaEnabled: process.env.PERSONA_ENABLED !== 'false',
      
      // Server
      port: parseInt(process.env.PORT) || 3000,
      
      // Cost tracking
      trackCosts: process.env.TRACK_COSTS === 'true',
    };
  }

  // Get cost for a model (from models.dev API only)
  // Returns NO_PRICING_MARKER (-6.66) if price not available
  async getModelCost(modelId) {
    // Check cache first
    if (this.pricingCache.has(modelId)) {
      return this.pricingCache.get(modelId);
    }

    try {
      const response = await fetch('https://models.dev/api.json');
      if (!response.ok) {
        console.warn(`[GameManager] Failed to fetch pricing: API returned ${response.status}`);
        this.pricingCache.set(modelId, NO_PRICING_MARKER);
        return NO_PRICING_MARKER;
      }
      
      const data = await response.json();
      
      // Search for model across all providers
      for (const providerData of Object.values(data)) {
        if (providerData?.models) {
          const models = providerData.models;
          
          // Try exact match
          if (models[modelId]?.cost) {
            const cost = models[modelId].cost;
            const price = (cost.input || 0) + (cost.output || 0);
            this.pricingCache.set(modelId, price);
            return price;
          }
          
          // Try partial match
          for (const [id, modelData] of Object.entries(models)) {
            if (id.includes(modelId) || modelId.includes(id)) {
              if (modelData?.cost) {
                const cost = modelData.cost;
                const price = (cost.input || 0) + (cost.output || 0);
                this.pricingCache.set(modelId, price);
                return price;
              }
            }
          }
        }
      }
      
      // Not found - mark as no pricing
      console.log(`[GameManager] No pricing found for model: ${modelId} (using ${NO_PRICING_MARKER})`);
      this.pricingCache.set(modelId, NO_PRICING_MARKER);
      return NO_PRICING_MARKER;
      
    } catch (error) {
      console.warn(`[GameManager] Error fetching pricing for ${modelId}:`, error.message);
      this.pricingCache.set(modelId, NO_PRICING_MARKER);
      return NO_PRICING_MARKER;
    }
  }

  // Calculate cost for a request
  async calculateCost(modelId, inputTokens, outputTokens) {
    const costPerMillion = await this.getModelCost(modelId);
    
    if (costPerMillion === NO_PRICING_MARKER) {
      return {
        cost: 0,
        formatted: 'No pricing data (set to -6.66)',
        hasPricing: false,
        modelId,
        inputTokens,
        outputTokens
      };
    }
    
    const inputCost = (inputTokens / 1_000_000) * costPerMillion;
    const outputCost = (outputTokens / 1_000_000) * costPerMillion;
    const totalCost = inputCost + outputCost;
    
    return {
      cost: totalCost,
      formatted: totalCost < 0.01 
        ? `$${(totalCost * 1000).toFixed(4)}` 
        : `$${totalCost.toFixed(4)}`,
      hasPricing: true,
      costPerMillion,
      modelId,
      inputTokens,
      outputTokens
    };
  }

  // Initialize database
  initDatabase() {
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        started_at INTEGER,
        ended_at INTEGER,
        status TEXT NOT NULL DEFAULT 'SETUP',
        config TEXT NOT NULL,
        winner TEXT,
        total_players INTEGER,
        total_rounds INTEGER,
        total_events INTEGER,
        total_tokens INTEGER,
        total_cost REAL,
        PRIMARY KEY (id)
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        is_alive INTEGER NOT NULL DEFAULT 1,
        is_mafia INTEGER NOT NULL DEFAULT 0,
        join_order INTEGER NOT NULL,
        provider TEXT,
        model TEXT,
        temperature REAL,
        max_tokens INTEGER,
        priority INTEGER DEFAULT 0,
        survived INTEGER,
        won INTEGER,
        tokens_used INTEGER DEFAULT 0,
        api_calls INTEGER DEFAULT 0,
        actions_taken INTEGER DEFAULT 0,
        correct_votes INTEGER DEFAULT 0,
        incorrect_votes INTEGER DEFAULT 0,
        role_performance REAL DEFAULT 0,
        PRIMARY KEY (id),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_model_assignments (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        player_id TEXT,
        player_index INTEGER NOT NULL,
        role TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature REAL DEFAULT 0.7,
        max_tokens INTEGER DEFAULT 500,
        priority INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        visibility TEXT NOT NULL DEFAULT 'PUBLIC',
        actor_id TEXT,
        target_id TEXT,
        data TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        day_number INTEGER NOT NULL,
        phase TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_game ON events(game_id);
      CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_game ON player_model_assignments(game_id);
    `);

    return db;
  }

  // Create a new game with configuration
  async createGame(options = {}) {
    const gameId = this.generateId();
    const numPlayers = options.numPlayers || this.config.defaultPlayers;
    const mafiaCount = options.mafiaCount || 
      (this.config.mafiaCount ? parseInt(this.config.mafiaCount) : Math.floor(numPlayers / 4));

    // Get player configuration
    const playerConfig = this.buildPlayerConfig(options);

    // Create players
    const players = this.generatePlayers(numPlayers, mafiaCount, playerConfig);

    // Calculate total roles
    const roles = players.map(p => p.role);

    // Create game record
    const gameConfig = {
      numPlayers,
      mafiaCount,
      playerConfig: playerConfig.toDatabase(),
      messaging: {
        mafiaMessagesPerPlayer: options.mafiaMessagesPerPlayer || this.config.mafiaMessagesPerPlayer,
        mafiaMaxMessages: options.mafiaMaxMessages || this.config.mafiaMaxMessages,
        townMessagesPerPlayer: options.townMessagesPerPlayer || this.config.townMessagesPerPlayer,
        townMaxMessages: options.townMaxMessages || this.config.townMaxMessages,
      },
      daySettings: {
        discussionRounds: options.dayDiscussionRounds || this.config.dayDiscussionRounds,
        votingEnabled: options.votingEnabled ?? this.config.votingEnabled,
        nightPhaseEnabled: options.nightPhaseEnabled ?? this.config.nightPhaseEnabled,
        personaEnabled: options.personaEnabled ?? this.config.personaEnabled,
      }
    };

    // Insert game
    const stmt = this.db.prepare(`
      INSERT INTO games (id, status, config, total_players, total_rounds, total_events, total_tokens, total_cost)
      VALUES (?, 'SETUP', ?, ?, 0, 0, 0, 0)
    `);

    stmt.run(gameId, JSON.stringify(gameConfig), numPlayers);

    // Insert players and their model assignments
    const playerStmt = this.db.prepare(`
      INSERT INTO players (id, game_id, name, role, is_alive, is_mafia, join_order, provider, model, temperature, max_tokens, priority)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `);

    const assignmentStmt = this.db.prepare(`
      INSERT INTO player_model_assignments (id, game_id, player_id, player_index, role, provider, model, temperature, max_tokens, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTransaction = this.db.transaction((players) => {
      for (const player of players) {
        playerStmt.run(
          player.id, gameId, player.name, player.role, 
          player.isMafia ? 1 : 0, player.joinOrder,
          player.aiConfig.provider, player.aiConfig.model,
          player.aiConfig.temperature, player.aiConfig.maxTokens, player.aiConfig.priority || 0
        );

        assignmentStmt.run(
          this.generateId(), gameId, player.id, player.joinOrder, player.role,
          player.aiConfig.provider, player.aiConfig.model,
          player.aiConfig.temperature, player.aiConfig.maxTokens, player.aiConfig.priority || 0
        );
      }
    });

    insertTransaction(players);

    console.log(`\n🎮 Game Created: ${gameId}`);
    console.log(`   Players: ${numPlayers} (Mafia: ${mafiaCount})`);
    console.log(`   Default Model: ${this.config.defaultModel}`);
    if (this.config.mafiaModel) console.log(`   Mafia Model: ${this.config.mafiaModel}`);
    if (this.config.doctorModel) console.log(`   Doctor Model: ${this.config.doctorModel}`);
    
    return {
      id: gameId,
      config: gameConfig,
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        aiConfig: p.aiConfig
      }))
    };
  }

  // Build player configuration from options and environment
  buildPlayerConfig(options) {
    const playerConfig = new PlayerModelConfig({
      defaultModel: this.config.defaultModel.split('/')[1] || 'gpt-4o-mini',
      defaultProvider: this.config.defaultModel.split('/')[0] || 'openai',
      temperature: this.config.defaultTemperature,
      maxTokens: this.config.defaultMaxTokens
    });

    // Apply role-based models from environment
    if (this.config.mafiaModel) {
      const [provider, model] = this.config.mafiaModel.split('/');
      playerConfig.setRoleModel('MAFIA', { provider, model, temperature: this.config.defaultTemperature });
    }
    if (this.config.doctorModel) {
      const [provider, model] = this.config.doctorModel.split('/');
      playerConfig.setRoleModel('DOCTOR', { provider, model, temperature: this.config.defaultTemperature });
    }
    if (this.config.sheriffModel) {
      const [provider, model] = this.config.sheriffModel.split('/');
      playerConfig.setRoleModel('SHERIFF', { provider, model, temperature: this.config.defaultTemperature });
    }
    if (this.config.vigilanteModel) {
      const [provider, model] = this.config.vigilanteModel.split('/');
      playerConfig.setRoleModel('VIGILANTE', { provider, model, temperature: this.config.defaultTemperature });
    }
    if (this.config.villagerModel) {
      const [provider, model] = this.config.villagerModel.split('/');
      playerConfig.setRoleModel('VILLAGER', { provider, model, temperature: this.config.defaultTemperature });
    }

    // Apply presets if specified
    if (options.preset) {
      const presets = {
        'gpt4VsClaude': PlayerConfigPresets.gpt4VsClaude,
        'varying': PlayerConfigPresets.varyingStrength,
        'experimental': PlayerConfigPresets.experimental,
        'allGpt4': () => PlayerConfigPresets.allSame('openai/gpt-4'),
        'allClaude': () => PlayerConfigPresets.allSame('anthropic/claude-3-opus-20240229')
      };

      if (presets[options.preset]) {
        const presetConfig = typeof presets[options.preset] === 'function' 
          ? presets[options.preset]() 
          : presets[options.preset];
        
        // Merge preset with existing config
        const presetDb = presetConfig.toDatabase();
        if (presetDb.roleAssignments) {
          for (const [role, cfg] of Object.entries(presetDb.roleAssignments)) {
            playerConfig.setRoleModel(role, cfg);
          }
        }
      }
    }

    // Apply player-specific overrides
    if (options.playerModels) {
      for (const [index, modelConfig] of Object.entries(options.playerModels)) {
        const [provider, model] = modelConfig.split('/');
        playerConfig.setPlayerModel(parseInt(index), { 
          provider, 
          model, 
          temperature: this.config.defaultTemperature,
          priority: 100 // Player-specific overrides have high priority
        });
      }
    }

    return playerConfig;
  }

  // Generate players with personas and AI config
  generatePlayers(numPlayers, mafiaCount, playerConfig) {
    const roles = this.assignRoles(numPlayers, mafiaCount);
    const names = this.generateNames(numPlayers);
    const players = [];

    for (let i = 0; i < numPlayers; i++) {
      const role = roles[i];
      const aiConfig = playerConfig.getPlayerConfig(i + 1, role, numPlayers);

      players.push({
        id: `player-${gameId}-${i + 1}`,
        name: names[i],
        role,
        isMafia: role === 'MAFIA',
        joinOrder: i + 1,
        aiConfig
      });
    }

    return players;
  }

  // Assign roles to players
  assignRoles(numPlayers, mafiaCount) {
    const roles = [
      ...Array(mafiaCount).fill('MAFIA'),
      ...Array(1).fill('DOCTOR'),
      ...Array(1).fill('SHERIFF'),
      ...Array(1).fill('VIGILANTE'),
      ...Array(numPlayers - mafiaCount - 3).fill('VILLAGER'),
    ];

    // Shuffle
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    return roles;
  }

  // Generate diverse names
  generateNames(numPlayers) {
    const namePools = {
      western: ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth'],
      eastern: ['Hiroshi', 'Yuki', 'Wei', 'Mei', 'Kenji', 'Sakura', 'Jin', 'Lin', 'Takeshi', 'Hana'],
      latin: ['Carlos', 'Maria', 'Diego', 'Sofia', 'Mateo', 'Isabella', 'Alejandro', 'Valentina', 'Javier', 'Camila'],
      nordic: ['Erik', 'Astrid', 'Lars', 'Freya', 'Olaf', 'Sigrid', 'Bjorn', 'Ingrid', 'Gunnar', 'Helga'],
      african: ['Kwame', 'Amara', 'Oluwaseun', 'Adaeze', 'Chidi', 'Ngozi', 'Kofi', 'Akosua', 'Jabari', 'Imani']
    };

    const cultures = Object.keys(namePools);
    const usedNames = new Set();

    const names = [];
    for (let i = 0; i < numPlayers; i++) {
      const culture = cultures[i % cultures.length];
      const pool = namePools[culture];
      let name;
      do {
        name = pool[Math.floor(Math.random() * pool.length)];
      } while (usedNames.has(name));
      
      usedNames.add(name);
      names.push(name);
    }

    return names;
  }

  // Get player model assignments from database
  getPlayerAssignments(gameId) {
    const stmt = this.db.prepare(`
      SELECT * FROM player_model_assignments 
      WHERE game_id = ? 
      ORDER BY player_index
    `);
    return stmt.all(gameId);
  }

  // Update a player's model assignment
  updatePlayerModel(gameId, playerId, modelConfig) {
    const stmt = this.db.prepare(`
      UPDATE player_model_assignments
      SET provider = ?, model = ?, temperature = ?, max_tokens = ?, priority = ?
      WHERE game_id = ? AND player_id = ?
    `);

    const [provider, model] = modelConfig.split('/');
    stmt.run(
      provider, 
      model, 
      this.config.defaultTemperature, 
      this.config.defaultMaxTokens, 
      100,
      gameId, 
      playerId
    );

    console.log(`✅ Updated player ${playerId} to ${modelConfig}`);
  }

  // Bulk update players
  bulkUpdatePlayers(gameId, assignments) {
    const updateStmt = this.db.prepare(`
      UPDATE player_model_assignments
      SET provider = ?, model = ?
      WHERE game_id = ? AND player_index = ?
    `);

    const transaction = this.db.transaction((assignments) => {
      for (const [index, modelConfig] of Object.entries(assignments)) {
        const [provider, model] = modelConfig.split('/');
        updateStmt.run(provider, model, gameId, parseInt(index));
      }
    });

    transaction(assignments);
    console.log(`✅ Updated ${Object.keys(assignments).length} players`);
  }

  // Apply role-based update
  updateRoleModel(gameId, role, modelConfig) {
    const updateStmt = this.db.prepare(`
      UPDATE player_model_assignments
      SET provider = ?, model = ?
      WHERE game_id = ? AND role = ?
    `);

    const [provider, model] = modelConfig.split('/');
    updateStmt.run(provider, model, gameId, role.toUpperCase());
    console.log(`✅ Updated all ${role} players to ${modelConfig}`);
  }

  // Get game details
  getGame(gameId) {
    const gameStmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
    const game = gameStmt.get(gameId);
    
    if (!game) return null;

    const playersStmt = this.db.prepare('SELECT * FROM players WHERE game_id = ?');
    const players = playersStmt.all(gameId);

    return {
      ...game,
      config: JSON.parse(game.config),
      players
    };
  }

  // List all games
  listGames() {
    const stmt = this.db.prepare(`
      SELECT id, status, created_at, total_players, total_rounds, winner
      FROM games
      ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  // Delete a game
  deleteGame(gameId) {
    const stmt = this.db.prepare('DELETE FROM games WHERE id = ?');
    stmt.run(gameId);
    console.log(`✅ Deleted game: ${gameId}`);
  }

  // Generate unique ID
  generateId() {
    return `game-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const manager = new GameManager();

  switch (command) {
    case 'create':
    case 'new':
      const options = {};
      
      // Parse options
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        const value = args[i + 1];
        
        if (key === 'players') options.numPlayers = parseInt(value);
        else if (key === 'mafia') options.mafiaCount = parseInt(value);
        else if (key === 'preset') options.preset = value;
        else if (key.startsWith('player')) {
          if (!options.playerModels) options.playerModels = {};
          const index = key.replace('player', '').replace('Model', '');
          options.playerModels[index] = value;
        }
      }

      manager.createGame(options).then(game => {
        console.log('\n📋 Game Configuration:');
        console.log(JSON.stringify(game, null, 2));
        manager.close();
      });
      break;

    case 'list':
      console.log('\n📋 Games:');
      manager.listGames().forEach(game => {
        console.log(`  ${game.id} - ${game.status} - ${game.total_players} players`);
      });
      manager.close();
      break;

    case 'get':
      if (args[1]) {
        const game = manager.getGame(args[1]);
        if (game) {
          console.log('\n📋 Game Details:');
          console.log(JSON.stringify(game, null, 2));
        } else {
          console.log(`Game not found: ${args[1]}`);
        }
      } else {
        console.log('Usage: node game-manager.js get [gameId]');
      }
      manager.close();
      break;

    case 'delete':
      if (args[1]) {
        manager.deleteGame(args[1]);
      } else {
        console.log('Usage: node game-manager.js delete [gameId]');
      }
      manager.close();
      break;

    case 'update':
      // node game-manager.js update [gameId] [playerId] [model]
      if (args[1] && args[2] && args[3]) {
        manager.updatePlayerModel(args[1], args[2], args[3]);
      } else {
        console.log('Usage: node game-manager.js update [gameId] [playerId] [provider/model]');
      }
      manager.close();
      break;

    case 'bulk-update':
      // node game-manager.js bulk-update [gameId] [json]
      if (args[1] && args[2]) {
        const assignments = JSON.parse(args[2]);
        manager.bulkUpdatePlayers(args[1], assignments);
      } else {
        console.log('Usage: node game-manager.js bulk-update [gameId] [{"1":"openai/gpt-4","2":"anthropic/claude-3"}]');
      }
      manager.close();
      break;

    case 'update-role':
      // node game-manager.js update-role [gameId] [role] [model]
      if (args[1] && args[2] && args[3]) {
        manager.updateRoleModel(args[1], args[2], args[3]);
      } else {
        console.log('Usage: node game-manager.js update-role [gameId] [role] [provider/model]');
      }
      manager.close();
      break;

    case 'config':
      console.log('\n📋 Current Configuration (from environment):');
      console.log(JSON.stringify(manager.config, null, 2));
      manager.close();
      break;

    case 'help':
    default:
      console.log(`
🎮 Mafia Game Manager - with Model Configuration

USAGE:
  node game-manager.js [command] [options]

COMMANDS:
  create [options]      Create a new game
  list                  List all games
  get [gameId]          Get game details
  delete [gameId]       Delete a game
  update [gId] [pId] [model]  Update specific player model
  bulk-update [gId] [json]    Bulk update players
  update-role [gId] [role] [model]  Update all players of a role
  config                 Show current configuration
  help                   Show this help

OPTIONS:
  --players [n]        Number of players (default: 10)
  --mafia [n]           Number of mafia (auto if not specified)
  --preset [name]       Use preset configuration
                         - gpt4VsClaude
                         - varying
                         - experimental
  --player[N] [model]   Set model for specific player
                         Example: --player1 openai/gpt-4

EXAMPLES:
  node game-manager.js create --players 10
  node game-manager.js create --players 8 --mafia 2 --preset gpt4VsClaude
  node game-manager.js create --players 10 --player1 openai/gpt-4 --player2 anthropic/claude-3
  node game-manager.js update game-123 player-456 openai/gpt-4
  node game-manager.js bulk-update game-123 '{"1":"openai/gpt-4","2":"anthropic/claude-3"}'
  node game-manager.js update-role game-123 MAFIA openai/gpt-4

ENVIRONMENT VARIABLES:
  DEFAULT_MODEL=openai/gpt-4o-mini
  MAFIA_MODEL=anthropic/claude-3-opus
  DOCTOR_MODEL=openai/gpt-4
  SHERIFF_MODEL=anthropic/claude-3-sonnet
  VIGILANTE_MODEL=openai/gpt-4o-mini
  VILLAGER_MODEL=openai/gpt-4o-mini

      `);
      manager.close();
      break;
  }
}

module.exports = GameManager;
