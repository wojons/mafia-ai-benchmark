// Mafia AI Benchmark - Player Model Configuration System
// Flexible, scalable system for assigning AI models to players

const fs = require('fs');
const path = require('path');

class PlayerModelConfig {
  constructor(config = {}) {
    this.assignments = new Map(); // playerIndex -> { provider, model, temperature, maxTokens }
    this.roleAssignments = new Map(); // role -> { provider, model, temperature, maxTokens }
    this.bulkAssignments = []; // Array of bulk assignment rules
    this.defaultModel = config.defaultModel || 'openai/gpt-4o-mini';
    this.defaultProvider = config.defaultProvider || 'openai';
    this.defaultTemperature = config.temperature || 0.7;
    this.defaultMaxTokens = config.maxTokens || 500;
  }

  // Set model for a specific player by index (1-based)
  setPlayerModel(playerIndex, config) {
    this.assignments.set(playerIndex, {
      provider: config.provider || this.defaultProvider,
      model: config.model || this.defaultModel,
      temperature: config.temperature ?? this.defaultTemperature,
      maxTokens: config.maxTokens || this.defaultMaxTokens,
      priority: config.priority || 0,
      playerName: config.playerName || `Player ${playerIndex}`
    });
    return this;
  }

  // Set model for a role (all players with that role)
  setRoleModel(role, config) {
    this.roleAssignments.set(role.toUpperCase(), {
      provider: config.provider || this.defaultProvider,
      model: config.model || this.defaultModel,
      temperature: config.temperature ?? this.defaultTemperature,
      maxTokens: config.maxTokens || this.defaultMaxTokens,
      priority: config.priority || 0
    });
    return this;
  }

  // Set model for a team (MAFIA or TOWN)
  setTeamModel(team, config) {
    const roles = team.toUpperCase() === 'MAFIA' 
      ? ['MAFIA'] 
      : ['DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER'];
    
    roles.forEach(role => this.setRoleModel(role, config));
    return this;
  }

  // Bulk assignment by range (e.g., players 1-50)
  setRangeModel(startIndex, endIndex, config) {
    for (let i = startIndex; i <= endIndex; i++) {
      this.setPlayerModel(i, config);
    }
    return this;
  }

  // Bulk assignment by pattern (odd, even, etc.)
  setPatternModel(pattern, config) {
    switch(pattern.toLowerCase()) {
      case 'odd':
        return this.setPattern('odd', config);
      case 'even':
        return this.setPattern('even', config);
      case 'firsthalf':
        return this.setPattern('firsthalf', config);
      case 'secondhalf':
        return this.setPattern('secondhalf', config);
      default:
        console.warn(`Unknown pattern: ${pattern}`);
        return this;
    }
  }

  // Set models by player index pattern
  setPattern(pattern, config) {
    const patterns = {
      odd: (i) => i % 2 === 1,
      even: (i) => i % 2 === 0,
      firsthalf: (i, total) => i <= Math.ceil(total / 2),
      secondhalf: (i, total) => i > Math.ceil(total / 2)
    };

    if (patterns[pattern]) {
      // Will be applied when we know total players
      this.bulkAssignments.push({
        type: 'pattern',
        pattern,
        config
      });
    }
    return this;
  }

  // Set all players to same model
  setAllPlayers(config) {
    this.defaultModel = config.model || this.defaultModel;
    this.defaultProvider = config.provider || this.defaultProvider;
    this.defaultTemperature = config.temperature ?? this.defaultTemperature;
    this.defaultMaxTokens = config.maxTokens || this.defaultMaxTokens;
    return this;
  }

  // Get model config for a specific player
  getPlayerConfig(playerIndex, role, totalPlayers = 10) {
    // Priority 1: Specific player assignment (highest priority)
    if (this.assignments.has(playerIndex)) {
      const assignment = this.assignments.get(playerIndex);
      // Check if this is a player-specific override
      if (assignment.priority >= this.getRolePriority(role)) {
        return {
          provider: assignment.provider,
          model: assignment.model,
          temperature: assignment.temperature,
          maxTokens: assignment.maxTokens,
          assignmentType: 'player'
        };
      }
    }

    // Priority 2: Role-based assignment
    if (this.roleAssignments.has(role)) {
      const assignment = this.roleAssignments.get(role);
      return {
        provider: assignment.provider,
        model: assignment.model,
        temperature: assignment.temperature,
        maxTokens: assignment.maxTokens,
        assignmentType: 'role'
      };
    }

    // Priority 3: Bulk pattern assignments
    for (const bulk of this.bulkAssignments) {
      if (bulk.type === 'pattern') {
        const patterns = {
          odd: (i) => i % 2 === 1,
          even: (i) => i % 2 === 0,
          firsthalf: (i, total) => i <= Math.ceil(total / 2),
          secondhalf: (i, total) => i > Math.ceil(total / 2)
        };

        if (patterns[bulk.pattern] && patterns[bulk.pattern](playerIndex, totalPlayers)) {
          return {
            provider: bulk.config.provider || this.defaultProvider,
            model: bulk.config.model || this.defaultModel,
            temperature: bulk.config.temperature ?? this.defaultTemperature,
            maxTokens: bulk.config.maxTokens || this.defaultMaxTokens,
            assignmentType: `pattern:${bulk.pattern}`
          };
        }
      }
    }

    // Priority 4: Default
    return {
      provider: this.defaultProvider,
      model: this.defaultModel,
      temperature: this.defaultTemperature,
      maxTokens: this.defaultMaxTokens,
      assignmentType: 'default'
    };
  }

  // Get priority level for a role
  getRolePriority(role) {
    const priorities = {
      'MAFIA': 10,
      'SHERIFF': 9,
      'DOCTOR': 8,
      'VIGILANTE': 7,
      'VILLAGER': 1
    };
    return priorities[role] || 0;
  }

  // Apply bulk pattern assignments for a specific total
  applyPatterns(totalPlayers) {
    this.bulkAssignments = this.bulkAssignments.filter(bulk => {
      if (bulk.type === 'pattern') {
        const patterns = {
          odd: (i) => i % 2 === 1,
          even: (i) => i % 2 === 0,
          firsthalf: (i, total) => i <= Math.ceil(total / 2),
          secondhalf: (i, total) => i > Math.ceil(total / 2)
        };

        if (patterns[bulk.pattern]) {
          for (let i = 1; i <= totalPlayers; i++) {
            if (patterns[bulk.pattern](i, totalPlayers)) {
              this.setPlayerModel(i, bulk.config);
            }
          }
          return false; // Remove after applying
        }
      }
      return true; // Keep non-pattern bulk assignments
    });
    return this;
  }

  // Get summary of all assignments
  getSummary(totalPlayers = 10) {
    const summary = {
      default: {
        provider: this.defaultProvider,
        model: this.defaultModel,
        temperature: this.defaultTemperature,
        maxTokens: this.defaultMaxTokens
      },
      roleAssignments: {},
      playerAssignments: {},
      patterns: this.bulkAssignments.map(b => `${b.pattern}: ${b.config.model}`)
    };

    // Summarize role assignments
    for (const [role, config] of this.roleAssignments) {
      summary.roleAssignments[role] = config;
    }

    // Summarize player assignments
    for (const [index, config] of this.assignments) {
      summary.playerAssignments[index] = config;
    }

    return summary;
  }

  // Generate player configs for a full game
  generatePlayerConfigs(players, totalPlayers) {
    // Apply patterns first
    this.applyPatterns(totalPlayers);

    return players.map((player, index) => {
      const playerIndex = index + 1;
      const config = this.getPlayerConfig(playerIndex, player.role, totalPlayers);
      
      return {
        ...player,
        aiConfig: {
          provider: config.provider,
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          assignmentType: config.assignmentType
        }
      };
    });
  }

  // Load from database format
  static fromDatabase(assignments, defaults = {}) {
    const config = new PlayerModelConfig({
      defaultModel: defaults.defaultModel || 'openai/gpt-4o-mini',
      defaultProvider: defaults.defaultProvider || 'openai'
    });

    if (assignments.roleAssignments) {
      for (const [role, cfg] of Object.entries(assignments.roleAssignments)) {
        config.setRoleModel(role, cfg);
      }
    }

    if (assignments.playerAssignments) {
      for (const [index, cfg] of Object.entries(assignments.playerAssignments)) {
        config.setPlayerModel(parseInt(index), cfg);
      }
    }

    if (assignments.defaultModel) config.defaultModel = assignments.defaultModel;
    if (assignments.defaultProvider) config.defaultProvider = assignments.defaultProvider;

    return config;
  }

  // Convert to database format
  toDatabase() {
    const assignments = {};
    const players = {};
    const roles = {};

    for (const [index, cfg] of this.assignments) {
      players[index] = cfg;
    }

    for (const [role, cfg] of this.roleAssignments) {
      roles[role] = cfg;
    }

    return {
      defaultModel: this.defaultModel,
      defaultProvider: this.defaultProvider,
      defaultTemperature: this.defaultTemperature,
      defaultMaxTokens: this.defaultMaxTokens,
      playerAssignments: players,
      roleAssignments: roles,
      bulkAssignments: this.bulkAssignments
    };
  }

  // Load from JSON file
  static fromFile(filePath) {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return PlayerModelConfig.fromDatabase(data);
    }
    return new PlayerModelConfig();
  }

  // Save to JSON file
  saveToFile(filePath) {
    const data = this.toDatabase();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return this;
  }

  // Create a preset configuration
  static createPreset(name, provider, model, options = {}) {
    return {
      id: `preset_${Date.now()}`,
      name,
      provider,
      model,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens || 500,
      useCase: options.useCase || 'general',
      createdAt: new Date().toISOString()
    };
  }

  // Common presets
  static getCommonPresets() {
    return {
      'gpt4o-mini': PlayerModelConfig.createPreset(
        'GPT-4o-mini', 'openai', 'gpt-4o-mini',
        { temperature: 0.7, useCase: 'general' }
      ),
      'gpt4o': PlayerModelConfig.createPreset(
        'GPT-4o', 'openai', 'gpt-4o',
        { temperature: 0.7, useCase: 'reasoning' }
      ),
      'gpt4': PlayerModelConfig.createPreset(
        'GPT-4', 'openai', 'gpt-4',
        { temperature: 0.7, useCase: 'strategy' }
      ),
      'claude-haiku': PlayerModelConfig.createPreset(
        'Claude-3 Haiku', 'anthropic', 'claude-3-haiku-20240307',
        { temperature: 0.7, useCase: 'fast' }
      ),
      'claude-sonnet': PlayerModelConfig.createPreset(
        'Claude-3 Sonnet', 'anthropic', 'claude-3-sonnet-20240229',
        { temperature: 0.7, useCase: 'balanced' }
      ),
      'claude-opus': PlayerModelConfig.createPreset(
        'Claude-3 Opus', 'anthropic', 'claude-3-opus-20240229',
        { temperature: 0.7, useCase: 'reasoning' }
      ),
      'gemini-flash': PlayerModelConfig.createPreset(
        'Gemini-1.5-Flash', 'google', 'gemini-1.5-flash',
        { temperature: 0.7, useCase: 'fast' }
      ),
      'gemini-pro': PlayerModelConfig.createPreset(
        'Gemini-1.5-Pro', 'google', 'gemini-1.5-pro',
        { temperature: 0.7, useCase: 'balanced' }
      ),
      'strong-deception': PlayerModelConfig.createPreset(
        'Strong Deception', 'anthropic', 'claude-3-opus-20240229',
        { temperature: 0.8, useCase: 'deception' }
      ),
      'strong-analysis': PlayerModelConfig.createPreset(
        'Strong Analysis', 'openai', 'gpt-4',
        { temperature: 0.5, useCase: 'analysis' }
      )
    };
  }
}

// Preset configurations for common scenarios
class PlayerConfigPresets {
  static gpt4VsClaude(totalPlayers = 10) {
    const config = new PlayerModelConfig();
    const mafiaCount = Math.floor(totalPlayers / 4);
    
    // Mafia gets GPT-4
    config.setRoleModel('MAFIA', {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7
    });
    
    // Town gets Claude-3 Sonnet
    config.setTeamModel('TOWN', {
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      temperature: 0.7
    });
    
    return config;
  }

  static varyingStrength(totalPlayers = 10) {
    const config = new PlayerModelConfig();
    
    // Strongest models for key roles
    config.setRoleModel('SHERIFF', {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.5
    });
    
    config.setRoleModel('DOCTOR', {
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      temperature: 0.6
    });
    
    config.setRoleModel('VIGILANTE', {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.7
    });
    
    // Mafia gets strong model
    config.setRoleModel('MAFIA', {
      provider: 'anthropic',
      model: 'claude-3-opus-20240229',
      temperature: 0.8
    });
    
    // Villagers get cheaper model
    config.setRoleModel('VILLAGER', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7
    });
    
    return config;
  }

  static experimental(totalPlayers = 10) {
    const config = new PlayerModelConfig();
    
    // Assign different models to different players
    for (let i = 1; i <= totalPlayers; i++) {
      const models = [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
        { provider: 'google', model: 'gemini-1.5-flash' }
      ];
      
      config.setPlayerModel(i, models[(i - 1) % models.length]);
    }
    
    return config;
  }

  static allSame(model = 'openai/gpt-4o-mini') {
    const [provider, actualModel] = model.split('/');
    const config = new PlayerModelConfig({
      defaultProvider: provider,
      defaultModel: actualModel
    });
    return config;
  }
}

module.exports = {
  PlayerModelConfig,
  PlayerConfigPresets
};
