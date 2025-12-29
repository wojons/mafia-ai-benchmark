#!/usr/bin/env node
/**
 * Mafia AI Benchmark CLI
 * 
 * Command-line interface for the Mafia AI Benchmark system.
 * Connects to production server API.
 * 
 * Usage:
 *   node cli.js games list
 *   node cli.js games create --players 5
 *   node cli.js stats
 */

import http from 'http';
import { URL } from 'url';

const SERVER_URL = process.env.MAFIA_SERVER_URL || 'http://localhost:3000';

// Colors
const colors = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  white: (s) => `\x1b[37m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
};

// HTTP client
async function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Commands
const commands = {
  // Health check
  async health() {
    const res = await apiRequest('GET', '/health');
    if (res.status === 200) {
      console.log(colors.green('✅ Server is healthy'));
      console.log(`   Uptime: ${Math.floor(res.data.uptime)}s`);
    } else {
      console.log(colors.red('❌ Server is not responding'));
    }
  },

  // Help
  async help() {
    console.log(`
${colors.cyan('🎮 Mafia AI Benchmark CLI')}

${colors.white('Usage:')} node cli.js <command> [options]

${colors.white('Commands:')}
  ${colors.white('health')}                    Check server health
  ${colors.white('stats')}                     Show server statistics
  ${colors.white('games')}                     Game management
    list [--status <s>] [--json]   List games
    create [--players n] [--day s] [--night s]  Create game
    start <id>                     Start game
    stop <id>                      Stop game
    info <id>                      Show game details
    add-player <id> [--name n] [--role r]  Add player
    set-player-model <id> <idx> [--provider p] [--model m]  Set player model
    set-role-model <id> <role> [--provider p] [--model m]  Set role model
    bulk-configure <id> [--assignments json]  Bulk configure
    sse-status <id>                Check SSE connections

  ${colors.white('models')}                     Model management
    pricing [model]               Get model pricing
    calculate <model> <in> <out>  Calculate cost
    list                          List available models

${colors.white('Options:')}
  --json       Output as JSON
  --verbose    Enable verbose logging
  --help       Show help

${colors.white('Environment:')}
  MAFIA_SERVER_URL   Server URL (default: http://localhost:3000)

${colors.white('Examples:')}
  node cli.js games create --players 5
  node cli.js models pricing gpt-4o-mini
  node cli.js stats
  node cli.js games list --json
`);
  },

  // Stats
  async stats() {
    console.log(colors.cyan('\n📊 Server Statistics\n'));
    
    const res = await apiRequest('GET', '/api/v1/stats');
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message}`));
      return;
    }
    
    const s = res.data.data;
    console.log(`   Games:      ${s.gamesCount}`);
    console.log(`   Players:    ${s.playersCount}`);
    console.log(`   Connections: ${s.activeConnections}`);
    console.log(`   Uptime:     ${Math.floor(s.uptime / 60)}m`);
    console.log(`   Memory:     ${Math.round(s.memory?.heapUsed / 1024 / 1024 || 0)}MB\n`);
  },

  // List games
  async gamesList(options) {
    console.log(colors.cyan('\n📋 Recent Games\n'));
    
    let path = '/api/v1/games';
    if (options.status) {
      path += `?status=${options.status}`;
    }
    
    const res = await apiRequest('GET', path);
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to fetch games'}`));
      return;
    }
    
    const games = res.data.data || [];
    
    if (options.json) {
      console.log(JSON.stringify(games, null, 2));
      return;
    }
    
    if (games.length === 0) {
      console.log(colors.gray('No games found.\n'));
      return;
    }
    
    console.log(colors.white('  ID                    Status          Players  Created'));
    console.log(colors.gray('  ' + '─'.repeat(80)));
    
    games.forEach(game => {
      const statusColor = this.getStatusColor(game.status);
      console.log(
        colors.gray('  ') +
        game.id.substring(0, 20).padEnd(20) + ' ' +
        statusColor((game.status || 'UNKNOWN').padEnd(13)) + ' ' +
        (game.players?.length || 0).toString().padEnd(8) +
        new Date(game.createdAt).toLocaleString()
      );
    });
    
    console.log(colors.gray(`\nTotal: ${games.length} games\n`));
  },

  // Create game
  async gamesCreate(options) {
    console.log(colors.cyan('\n🎮 Creating Game\n'));
    
    const body = {
      config: {
        players: options.players || 5,
        dayDurationSeconds: options.dayDuration || 60,
        nightDurationSeconds: options.nightDuration || 30,
      },
    };
    
    const res = await apiRequest('POST', '/api/v1/games', body);
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to create game'}`));
      return;
    }
    
    const game = res.data.data;
    console.log(colors.green('✅ Game created!'));
    console.log(`   ID: ${game.id}`);
    console.log(`   Status: ${game.status}`);
    console.log(`   Players: ${game.config.players}\n`);
    
    return game.id;
  },

  // Start game
  async gamesStart(gameId) {
    if (!gameId) {
      console.log(colors.red('❌ Game ID required'));
      return;
    }
    
    const res = await apiRequest('POST', `/api/v1/games/${gameId}/start`);
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to start game'}`));
      return;
    }
    
    console.log(colors.green('✅ Game started!'));
    console.log(`   Status: ${res.data.data.status}\n`);
  },

  // Stop game
  async gamesStop(gameId) {
    if (!gameId) {
      console.log(colors.red('❌ Game ID required'));
      return;
    }
    
    const res = await apiRequest('POST', `/api/v1/games/${gameId}/stop`);
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to stop game'}`));
      return;
    }
    
    console.log(colors.yellow('⏹️  Game stopped'));
    console.log(`   Status: ${res.data.data.status}\n`);
  },

  // Get game info
  async gamesInfo(gameId) {
    if (!gameId) {
      console.log(colors.red('❌ Game ID required'));
      return;
    }
    
    const res = await apiRequest('GET', `/api/v1/games/${gameId}`);
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Game not found'}`));
      return;
    }
    
    const game = res.data.data;
    console.log(colors.cyan(`\n📋 Game: ${game.id}\n`));
    console.log(`   Status: ${game.status}`);
    console.log(`   Players: ${game.players?.length || 0}`);
    console.log(`   Created: ${new Date(game.createdAt).toLocaleString()}\n`);
  },

  // Add player
  async gamesAddPlayer(gameId, options) {
    if (!gameId) {
      console.log(colors.red('❌ Game ID required'));
      return;
    }
    
    const res = await apiRequest('POST', `/api/v1/games/${gameId}/players`, {
      name: options.name || `Player`,
      role: options.role || 'VILLAGER',
    });
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to add player'}`));
      return;
    }
    
    console.log(colors.green('✅ Player added!'));
    console.log(`   Name: ${res.data.data.name}`);
    console.log(`   Role: ${res.data.data.role}\n`);
  },

  // Set player model
  async gamesSetPlayerModel(gameId, playerIdx, options) {
    console.log(colors.gray(`DEBUG: gameId=${gameId}, playerIdx=${playerIdx}, options=${JSON.stringify(options)}`));
    
    if (!gameId || playerIdx === undefined) {
      console.log(colors.red('❌ Game ID and player index required'));
      return;
    }
    
    const { provider, model, temperature, maxTokens } = options;
    console.log(colors.gray(`DEBUG: provider=${provider}, model=${model}`));
    
    const res = await apiRequest('POST', `/api/v1/games/${gameId}/players/${playerIdx}/model`, {
      provider: options.provider,
      model: options.model,
      temperature: options.temperature || 0.7,
      maxTokens: options.maxTokens || 1000,
    });
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to set model'}`));
      return;
    }
    
    console.log(colors.green('✅ Model configured!'));
    console.log(`   Provider: ${res.data.data.provider}`);
    console.log(`   Model: ${res.data.data.model}\n`);
  },

  // Set role model
  async gamesSetRoleModel(gameId, role, options) {
    if (!gameId || !role) {
      console.log(colors.red('❌ Game ID and role required'));
      return;
    }
    
    const res = await apiRequest('POST', `/api/v1/games/${gameId}/role/${role}/model`, {
      provider: options.provider,
      model: options.model,
      temperature: options.temperature || 0.7,
    });
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to set role model'}`));
      return;
    }
    
    console.log(colors.green(`✅ ${role} model configured!`));
    console.log(`   Provider: ${res.data.data.provider}`);
    console.log(`   Model: ${res.data.data.model}\n`);
  },

  // Bulk configure models
  async gamesBulkConfigure(gameId, options) {
    if (!gameId) {
      console.log(colors.red('❌ Game ID required'));
      return;
    }
    
    let assignments = [];
    if (options.assignments) {
      try {
        assignments = JSON.parse(options.assignments);
      } catch (e) {
        console.log(colors.red('❌ Invalid JSON in --assignments'));
        return;
      }
    }
    
    const res = await apiRequest('POST', `/api/v1/games/${gameId}/models/bulk`, {
      assignments,
    });
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message || 'Failed to configure'}`));
      return;
    }
    
    console.log(colors.green(`✅ ${res.data.data.count} models configured!\n`));
  },

  // Get model pricing
  async modelsPricing(model) {
    console.log(colors.cyan('\n💰 Model Pricing\n'));
    
    const res = await apiRequest('GET', `/api/v1/models/pricing?model=${model || ''}`);
    
    if (model) {
      const p = res.data.data;
      if (p.hasPricing) {
        console.log(`   ${colors.white(model)}`);
        console.log(`   Input:  $${p.inputPerMillion}/M tokens`);
        console.log(`   Output: $${p.outputPerMillion}/M tokens`);
        console.log(`   Source: ${p.source || 'fallback'}\n`);
      } else {
        console.log(colors.yellow(`   No pricing available for ${model}`));
        console.log(`   Marker: ${p.noPricingMarker || p.inputPerMillion}\n`);
      }
    } else {
      // List all models with pricing
      const res2 = await apiRequest('GET', '/api/v1/models');
      console.log('   Available models with pricing:');
      (res2.data.data || []).forEach(m => {
        console.log(`   - ${m.id}: $${m.inputPerMillion}/M in, $${m.outputPerMillion}/M out`);
      });
      console.log('');
    }
  },

  // Calculate cost
  async modelsCalculate(model, input, output) {
    console.log(colors.cyan('\n💰 Cost Calculation\n'));
    
    const res = await apiRequest('POST', '/api/v1/models/calculate-cost', {
      modelId: model,
      inputTokens: parseInt(input),
      outputTokens: parseInt(output),
    });
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message}`));
      return;
    }
    
    const d = res.data.data;
    console.log(`   Model: ${d.modelId}`);
    console.log(`   Input:  ${d.inputTokens} tokens`);
    console.log(`   Output: ${d.outputTokens} tokens`);
    console.log(`   Total:  ${colors.green(d.formatted)}`);
    console.log(`   Has Pricing: ${d.hasPricing ? colors.green('Yes') : colors.red('No')}\n`);
  },

  // List models
  async modelsList() {
    console.log(colors.cyan('\n🤖 Available Models\n'));
    
    const res = await apiRequest('GET', '/api/v1/models');
    
    if (Array.isArray(res.data.data)) {
      res.data.data.forEach(m => {
        const hasPricing = m.inputPerMillion > 0;
        console.log(`   ${colors.white(m.id)}`);
        console.log(`      ${hasPricing ? colors.green('$') + m.inputPerMillion + '/M in, $' + m.outputPerMillion + '/M out' : colors.gray('No pricing')}`);
        console.log('');
      });
    }
  },

  // SSE status
  async gamesSseStatus(gameId) {
    if (!gameId) {
      console.log(colors.red('❌ Game ID required'));
      return;
    }
    
    const res = await apiRequest('GET', `/api/v1/games/${gameId}/sse-status`);
    
    if (res.data.success === false) {
      console.log(colors.red(`❌ ${res.data.error?.message}`));
      return;
    }
    
    console.log(colors.cyan(`\n📡 SSE Status for ${gameId}\n`));
    console.log(`   Active Connections: ${res.data.data.activeConnections}`);
    console.log(`   Is Streaming: ${res.data.data.isStreaming ? colors.green('Yes') : colors.red('No')}\n`);
  },

  getStatusColor(status) {
    switch ((status || '').toUpperCase()) {
      case 'SETUP': return colors.blue;
      case 'IN_PROGRESS': return colors.green;
      case 'ENDED': return colors.gray;
      case 'PAUSED': return colors.yellow;
      default: return colors.white;
    }
  },
};

// Parse command line
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  const positional = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      // Handle --key=value or --key value
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value format
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        options[key] = value;
      } else {
        // --key value format (value is next argument)
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          options[key] = args[++i];
        } else {
          options[key] = 'true';
        }
      }
    } else if (arg.startsWith('-')) {
      // Handle -k value or -k=value
      const shortKey = arg.slice(1);
      const eqIdx = shortKey.indexOf('=');
      if (eqIdx !== -1) {
        const key = shortKey.slice(0, eqIdx);
        const value = shortKey.slice(eqIdx + 1);
        options[key] = value;
      } else {
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          options[shortKey] = args[++i];
        } else {
          options[shortKey] = 'true';
        }
      }
    } else {
      positional.push(arg);
    }
  }
  
  return { options, positional };
}

// Main
async function main() {
  const { options, positional } = parseArgs();
  const [cmd, subcmd, ...rest] = positional;
  
  // Show help if no command
  if (!cmd) {
    console.log(`
${colors.cyan('🎮 Mafia AI Benchmark CLI')}

${colors.white('Usage:')} node cli.js <command> [options]

${colors.white('Commands:')}
  ${colors.white('health')}                    Check server health
  ${colors.white('games')}                     Game management
    list [--status <s>] [--json]   List games
    create [--players n] [--day s] [--night s]  Create game
    start <id>                     Start game
    stop <id>                      Stop game
    info <id>                      Show game details
    add-player <id> [--name n] [--role r]  Add player
    set-player-model <id> <idx> [--provider p] [--model m]  Set player model
    set-role-model <id> <role> [--provider p] [--model m]  Set role model
    bulk-configure <id> [--assignments json]  Bulk configure
    sse-status <id>                Check SSE connections

  ${colors.white('models')}                     Model management
    pricing [model]               Get model pricing
    calculate <model> <in> <out>  Calculate cost
    list                          List available models

  ${colors.white('stats')}                       Show server statistics
  ${colors.white('help')}                        Show this help

${colors.white('Options:')}
  --json       Output as JSON
  --verbose    Enable verbose logging
  --help       Show help

${colors.white('Environment:')}
  MAFIA_SERVER_URL   Server URL (default: http://localhost:3000)

${colors.white('Examples:')}
  node cli.js games create --players 5
  node cli.js models pricing gpt-4o-mini
  node cli.js stats
  node cli.js games list --json
`);
    return;
  }
  
  // Execute command
  function toCamelCase(str) {
    return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  }
  
  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  const commandName = `${cmd}${subcmd ? capitalizeFirst(toCamelCase(subcmd)) : ''}`;
  const command = commands[commandName];
  
  if (!command) {
    console.log(colors.red(`❌ Unknown command: ${cmd} ${subcmd || ''}`));
    console.log(`Run ${colors.white('node cli.js help')} for available commands\n`);
    process.exit(1);
  }
  
  try {
    await command.call(commands, ...rest.map(a => {
      // Parse numeric arguments
      if (!isNaN(a)) return parseInt(a);
      return a;
    }), options);
  } catch (error) {
    if (error.message === 'timeout') {
      console.log(colors.red('❌ Request timeout - is the server running?'));
      console.log(`   Start server: ${colors.white('node apps/server/src/index.js')}`);
      console.log(`   Or set MAFIA_SERVER_URL\n`);
    } else {
      console.log(colors.red(`❌ Error: ${error.message}`));
    }
    process.exit(1);
  }
}

main();
