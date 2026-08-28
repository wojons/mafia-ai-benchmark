/**
 * Config Command
 * 
 * View and modify CLI configuration.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export class ConfigCommand extends Command {
  constructor() {
    super('config');
    this.description('View and modify configuration');
    
    this.addCommand(
      (() => {
        const cmd = new Command('show');
        cmd.description('Show current configuration');
        cmd.option('--json', 'Output as JSON');
        cmd.action(async () => {
          await this.showConfig(cmd.opts());
        });
        return cmd;
      })()
    );
    
    this.addCommand(
      (() => {
        const cmd = new Command('set');
        cmd.description('Set a configuration value');
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
        const cmd = new Command('reset');
        cmd.description('Reset configuration to defaults');
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

    const config = this.loadConfig();
    const existing = config as Record<string, unknown>;

    // Attempt to parse numeric / boolean values; keep strings otherwise
    let parsedValue: unknown = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) parsedValue = Number(value);

    existing[key] = parsedValue;
    this.saveConfig(existing);

    console.log(chalk.green(`✓ Configuration updated — ${key} = ${JSON.stringify(parsedValue)}\n`));
  }
  
  async resetConfig(force: boolean): Promise<void> {
    if (!force) {
      console.log(chalk.yellow('\n⚠️  This will reset all configuration to defaults.\n'));
      
      const inquirerMod = await import('inquirer');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inquirer = (inquirerMod as any).default || inquirerMod;
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
    
    // Reset config file to defaults
    const defaultConfig = {
      numPlayers: 10,
      llmProvider: 'openai',
      llmModel: 'openai/gpt-4o-mini',
      nightDuration: 60,
      dayDuration: 120,
      votingDuration: 30,
    };
    this.saveConfig(defaultConfig);
    console.log(chalk.green('✓ Configuration reset to defaults\n'));
  }
  
  private loadConfig(): Record<string, unknown> {
    const file = path.resolve(process.cwd(), 'mafia.config.json');
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
      }
    } catch {
      // Ignore errors
    }
    return {};
  }

  private saveConfig(config: Record<string, unknown>): void {
    const file = path.resolve(process.cwd(), 'mafia.config.json');
    fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8');
  }
}

export default ConfigCommand;
