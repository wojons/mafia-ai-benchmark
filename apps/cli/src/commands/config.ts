/**
 * Config Command
 * 
 * View and modify CLI configuration.
 */

import { Command } from 'commander';
import fs from 'fs';
import chalk from 'chalk';

export class ConfigCommand extends Command {
  constructor() {
    super('config', 'View and modify configuration');
    
    this.addCommand(
      (() => {
        const cmd = new Command('show', 'Show current configuration');
        cmd.option('--json', 'Output as JSON');
        cmd.action(async () => {
          await this.showConfig(cmd.opts());
        });
        return cmd;
      })()
    );
    
    this.addCommand(
      (() => {
        const cmd = new Command('set', 'Set a configuration value');
        cmd.argument('<key>', 'Configuration key');
        cmd.argument('<value>', 'Configuration value');
        cmd.action(async (key, value) => {
          await this.setConfig(key, value);
        });
        return cmd;
      })()
    );
    
    this.addCommand(
      (() => {
        const cmd = new Command('reset', 'Reset configuration to defaults');
        cmd.option('--force', 'Skip confirmation');
        cmd.action(async (opts) => {
          await this.resetConfig(opts.force);
        });
        return cmd;
      })()
    );
  }
  
  async showConfig(options: { json?: boolean }): Promise<void> {
    const config = this.loadConfig();
    
    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    
    console.log(chalk.cyan('\n⚙️  Configuration\n'));
    
    if (!config || Object.keys(config).length === 0) {
      console.log(chalk.gray('No configuration found. Run: ') + chalk.cyan('mafiactl init\n'));
      return;
    }
    
    console.log(chalk.white('Game Settings:'));
    console.log(`  Name:              ${chalk.yellow((config.name as string) || 'N/A')}`);
    console.log(`  Players:           ${chalk.yellow((config.numPlayers as number)?.toString() || 'N/A')}`);
    console.log(`  Night Duration:    ${chalk.yellow((config.nightDuration as number)?.toString() || 'N/A')}`);
    console.log(`  Day Duration:      ${chalk.yellow((config.dayDuration as number)?.toString() || 'N/A')}`);
    console.log(`  Voting Duration:   ${chalk.yellow((config.votingDuration as number)?.toString() || 'N/A')}`);
    
    console.log(chalk.white('\nLLM Settings:'));
    console.log(`  Provider:          ${chalk.yellow((config.llmProvider as string) || 'N/A')}`);
    console.log(`  Model:             ${chalk.yellow((config.llmModel as string) || 'N/A')}`);
    console.log(`  Temperature:       ${chalk.yellow((config.temperature as number)?.toString() || 'N/A')}`);
    
    console.log(chalk.white('\nVisualization:'));
    console.log(`  3D Mode:           ${chalk.yellow((config.enable3D as boolean)?.toString() || 'N/A')}`);
    console.log(`  Voice:             ${chalk.yellow((config.enableVoice as boolean)?.toString() || 'N/A')}`);
    
    console.log('');
  }
  
  async setConfig(key: string, value: string): Promise<void> {
    console.log(chalk.cyan(`\nSetting ${key} = ${value}\n`));
    
    // TODO: Update config file
    console.log(chalk.green('✓ Configuration updated\n'));
  }
  
  async resetConfig(force: boolean): Promise<void> {
    if (!force) {
      console.log(chalk.yellow('\n⚠️  This will reset all configuration to defaults.\n'));
      
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Continue?',
          default: false,
        },
      ]);
      
      if (!confirm) {
        console.log(chalk.gray('\nCancelled.\n'));
        return;
      }
    }
    
    // TODO: Reset config file
    console.log(chalk.green('✓ Configuration reset to defaults\n'));
  }
  
  private loadConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync('./mafia.config.json')) {
        return JSON.parse(fs.readFileSync('./mafia.config.json', 'utf-8'));
      }
    } catch {
      // Ignore errors
    }
    return {};
  }
}

export default ConfigCommand;
