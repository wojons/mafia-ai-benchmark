/**
 * Init Command
 * 
 * Initialize Mafia AI Benchmark configuration.
 */

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class InitCommand extends Command {
  constructor() {
    super('init', 'Initialize Mafia AI Benchmark configuration');
    
    this.option('-f, --force', 'Overwrite existing configuration', false);
    this.option('-q, --quiet', 'Skip interactive prompts', false);
    this.option('--default', 'Use default configuration', false);
  }
  
  async run(): Promise<void> {
    const { force, quiet, default: useDefault } = this.parseOptions();
    
    const configPath = './mafia.config.json';
    
    // Check for existing config
    if (fs.existsSync(configPath) && !force) {
      console.log(`\n${chalk.yellow('⚠️  Configuration already exists at:')} ${configPath}`);
      console.log(chalk.gray('Use --force to overwrite\n'));
      
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: 'Overwrite existing configuration?',
          default: false,
        },
      ]);
      
      if (!overwrite) {
        console.log(chalk.gray('\nCancelled.\n'));
        return;
      }
    }
    
    if (useDefault || quiet) {
      // Use default configuration
      const defaultConfig = this.getDefaultConfig();
      this.saveConfig(defaultConfig, configPath);
      console.log(chalk.green('\n✅ Configuration created with defaults!\n'));
      return;
    }
    
    // Interactive configuration
    console.log(chalk.cyan('\n🎮 Mafia AI Benchmark Configuration\n'));
    console.log(chalk.gray('Answer the following questions to set up your configuration.\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'gameName',
        message: 'Game name:',
        default: 'Mafia Game',
      },
      {
        type: 'number',
        name: 'numPlayers',
        message: 'Number of players:',
        default: 10,
        validate: (input: number) => input >= 5 && input <= 20,
      },
      {
        type: 'checkbox',
        name: 'roles',
        message: 'Roles to include:',
        choices: [
          { name: 'Mafia (3)', value: 'mafia', checked: true },
          { name: 'Doctor (1)', value: 'doctor', checked: true },
          { name: 'Sheriff (1)', value: 'sheriff', checked: true },
          { name: 'Vigilante (1)', value: 'vigilante', checked: true },
          { name: 'Villagers (remaining)', value: 'villager', checked: true },
        ],
      },
      {
        type: 'number',
        name: 'nightDuration',
        message: 'Night phase duration (seconds):',
        default: 60,
      },
      {
        type: 'number',
        name: 'dayDuration',
        message: 'Day phase duration (seconds):',
        default: 120,
      },
      {
        type: 'number',
        name: 'votingDuration',
        message: 'Voting phase duration (seconds):',
        default: 30,
      },
      {
        type: 'list',
        name: 'defaultProvider',
        message: 'Default LLM provider:',
        choices: [
          { name: 'OpenAI (GPT-4)', value: 'openai' },
          { name: 'Anthropic (Claude)', value: 'anthropic' },
          { name: 'Google (Gemini)', value: 'google' },
          { name: 'Groq (Fast inference)', value: 'groq' },
        ],
      },
      {
        type: 'list',
        name: 'defaultModel',
        message: 'Default model:',
        choices: [
          { name: 'GPT-5.1 (Recommended)', value: 'gpt-5.1' },
          { name: 'GPT-4.1', value: 'gpt-4.1' },
          { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4.5' },
          { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
        ],
      },
      {
        type: 'confirm',
        name: 'enable3D',
        message: 'Enable 3D visualization?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'enableVoice',
        message: 'Enable voice synthesis?',
        default: false,
      },
    ]);
    
    const config = this.generateConfig(answers);
    this.saveConfig(config, configPath);
    
    console.log(chalk.green('\n✅ Configuration saved to: ') + chalk.white(configPath));
    console.log(chalk.gray('\nYou can now run:'));
    console.log(chalk.cyan('  mafiactl run-game\n'));
  }
  
  private getDefaultConfig(): Record<string, unknown> {
    return {
      name: 'Mafia Game',
      version: '1.0.0',
      game: {
        numPlayers: 10,
        roles: [
          { role: 'MAFIA', count: 3 },
          { role: 'DOCTOR', count: 1 },
          { role: 'SHERIFF', count: 1 },
          { role: 'VIGILANTE', count: 1 },
          { role: 'VILLAGER', count: 4 },
        ],
        nightPhaseDuration: 60,
        dayPhaseDuration: 120,
        votingDuration: 30,
        tieBreaker: 'RANDOM',
        allowSelfVote: false,
      },
      llm: {
        provider: 'openai',
        model: 'gpt-5.1',
        temperature: 0.7,
        maxTokens: 2000,
      },
      visualization: {
        enable3D: false,
        enableVoice: false,
      },
      logging: {
        level: 'INFO',
        file: './logs/mafia.log',
      },
    };
  }
  
  private generateConfig(answers: Record<string, unknown>): Record<string, unknown> {
    const roleConfig: Array<{ role: string; count: number }> = [];
    
    if (answers.roles.includes('mafia')) roleConfig.push({ role: 'MAFIA', count: 3 });
    if (answers.roles.includes('doctor')) roleConfig.push({ role: 'DOCTOR', count: 1 });
    if (answers.roles.includes('sheriff')) roleConfig.push({ role: 'SHERIFF', count: 1 });
    if (answers.roles.includes('vigilante')) roleConfig.push({ role: 'VIGILANTE', count: 1 });
    if (answers.roles.includes('villager')) {
      const filled = roleConfig.reduce((sum, r) => sum + r.count, 0);
      roleConfig.push({ role: 'VILLAGER', count: (answers.numPlayers as number) - filled });
    }
    
    return {
      name: answers.gameName,
      version: '1.0.0',
      game: {
        numPlayers: answers.numPlayers,
        roles: roleConfig,
        nightPhaseDuration: answers.nightDuration,
        dayPhaseDuration: answers.dayDuration,
        votingDuration: answers.votingDuration,
        tieBreaker: 'RANDOM',
        allowSelfVote: false,
      },
      llm: {
        provider: answers.defaultProvider,
        model: answers.defaultModel,
        temperature: 0.7,
        maxTokens: 2000,
      },
      visualization: {
        enable3D: answers.enable3D,
        enableVoice: answers.enableVoice,
      },
      logging: {
        level: 'INFO',
        file: './logs/mafia.log',
      },
    };
  }
  
  private saveConfig(config: Record<string, unknown>, configPath: string): void {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}

export default InitCommand;
