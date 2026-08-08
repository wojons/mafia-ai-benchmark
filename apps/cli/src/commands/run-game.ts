/**
 * Run Game Command
 * 
 * Run a Mafia game with AI agents.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import { resolveServerUrl } from '../config.js';

interface GameConfig {
  numPlayers: number;
  llmProvider: string;
  llmModel: string;
  nightDuration: number;
  dayDuration: number;
  votingDuration: number;
  roles: Array<{ role: string; count: number }>;
}

export class RunGameCommand extends Command {
  constructor() {
    super('run-game');
    this.description('Run a Mafia game with AI agents');
    
    this.option('-c, --config <path>', 'Configuration file path', './mafia.config.json');
    this.option('--players <n>', 'Number of players', '10');
    this.option('--provider <name>', 'LLM provider', 'openai');
    this.option('--model <name>', 'LLM model', 'openai/gpt-4o-mini');
    this.option('--auto', 'Run without confirmation', false);
    this.option('--watch', 'Watch game in real-time', false);
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');

    this.action(async () => { await this.run(); });
  }
  
  async run(): Promise<void> {
    const { config, players, provider, model, auto, watch, server } = this.opts();
    
    const serverUrl = resolveServerUrl(server);
    
    console.log(chalk.cyan('\n🎮 Mafia AI Benchmark - Run Game\n'));
    
    // Load configuration
    let gameConfig = this.loadConfig(config);

    if (!gameConfig) {
      gameConfig = this.getDefaultGameConfig();
    }

    // Override with command line options
    if (players) gameConfig.numPlayers = parseInt(players as string);
    if (provider) gameConfig.llmProvider = provider as string;
    if (model) gameConfig.llmModel = model as string;
    
    // Display game configuration
    console.log(chalk.white('Game Configuration:'));
    console.log(`  Players:     ${chalk.yellow(gameConfig.numPlayers.toString())}`);
    console.log(`  Provider:    ${chalk.yellow(gameConfig.llmProvider)}`);
    console.log(`  Model:       ${chalk.yellow(gameConfig.llmModel)}`);
    console.log(`  Night:       ${chalk.yellow(gameConfig.nightDuration + 's')}`);
    console.log(`  Day:         ${chalk.yellow(gameConfig.dayDuration + 's')}`);
    console.log(`  Voting:      ${chalk.yellow(gameConfig.votingDuration + 's')}`);
    console.log('');
    
    if (!auto) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Start game with these settings?',
          default: true,
        },
      ]);
      
      if (!confirm) {
        console.log(chalk.gray('\nCancelled.\n'));
        return;
      }
    }
    
    // Start game
    console.log(chalk.cyan('Starting game...\n'));
    
    try {
      const gameId = await this.startGame(gameConfig, serverUrl);
      
      if (watch) {
        console.log(chalk.cyan('\n👀 Watching game in real-time...\n'));
        console.log(chalk.gray('Use: mafiactl watch-game ' + gameId + ' for full real-time updates\n'));
      } else {
        console.log(chalk.green('\n✅ Game started successfully!'));
        console.log(chalk.gray('  Game ID: ' + gameId));
        console.log(chalk.gray('\nUse: mafiactl watch-game ' + gameId + ' to watch the game\n'));
      }
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
        console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
      } else {
        console.error(chalk.red(`\n❌ Failed to start game: ${error.message}`));
      }
      process.exit(1);
    }
  }
  
  private loadConfig(configPath: string): GameConfig | null {
    try {
      if (fs.existsSync(configPath)) {
        const config = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(config) as GameConfig;
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private getDefaultGameConfig(): GameConfig {
    return {
      numPlayers: 10,
      llmProvider: 'openai',
      llmModel: 'openai/gpt-4o-mini',
      nightDuration: 60,
      dayDuration: 120,
      votingDuration: 30,
      roles: [
        { role: 'MAFIA', count: 3 },
        { role: 'DOCTOR', count: 1 },
        { role: 'SHERIFF', count: 1 },
        { role: 'VIGILANTE', count: 1 },
        { role: 'VILLAGER', count: 4 },
      ],
    };
  }
  
  private async startGame(config: GameConfig, serverUrl: string): Promise<string> {
    console.log(chalk.gray(`  Connecting to server (${serverUrl})...`));
    
    const url = `${serverUrl}/api/v1/games`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config,
        numPlayers: config.numPlayers,
      }),
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }
    
    const body = await response.json() as { success: boolean; data: { gameId: string; status: string } };
    const gameId = body.data?.gameId;
    
    if (!gameId) {
      throw new Error('Server response did not include a gameId');
    }
    
    return gameId;
  }

}

export default RunGameCommand;
