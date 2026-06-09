/**
 * Run Game Command
 * 
 * Run a Mafia game with AI agents.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';

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
    this.option('--model <name>', 'LLM model', 'gpt-5.1');
    this.option('--auto', 'Run without confirmation', false);
    this.option('--watch', 'Watch game in real-time', false);
  }
  
  async run(): Promise<void> {
    const { config, players, provider, model, auto, watch } = this.opts();
    
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
      // TODO: Connect to server and start game
      await this.startGame(gameConfig);
      
      if (watch) {
        console.log(chalk.cyan('\n👀 Watching game in real-time...\n'));
        await this.watchGame();
      } else {
        console.log(chalk.green('\n✅ Game started successfully!\n'));
        console.log(chalk.gray('Use: mafiactl watch-game <game-id> to watch the game\n'));
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to start game:'), error);
      process.exit(1);
    }
  }
  
  private loadConfig(configPath: string): GameConfig | null {
    try {
      const fs = require('fs');
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
      llmModel: 'gpt-5.1',
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
  
  private async startGame(_config: GameConfig): Promise<void> {
    // TODO: Connect to server and create game
    console.log(chalk.gray('  Connecting to server...'));
    console.log(chalk.gray('  Creating game...'));
    console.log(chalk.gray('  Assigning roles...'));
    console.log(chalk.gray('  Starting game loop...'));
    
    // Simulate game start
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  private async watchGame(): Promise<void> {
    console.log(chalk.cyan('Real-time game updates will appear here...\n'));
    
    // Connect to WebSocket
    // TODO: Implement WebSocket connection
    /*
    this.ws = new WebSocket('ws://localhost:3000/ws');
    
    this.ws.on('open', () => {
      console.log(chalk.green('Connected to game server'));
    });
    
    this.ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      this.displayEvent(event);
    });
    
    this.ws.on('close', () => {
      console.log(chalk.gray('\nDisconnected from game server'));
    });
    */
  }

}

export default RunGameCommand;
