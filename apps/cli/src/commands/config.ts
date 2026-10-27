/**
 * Config Command
 * 
 * View and modify CLI configuration.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const SUPPORTED_CONFIG_KEYS = [
  'name',
  'numPlayers',
  'nightDuration',
  'dayDuration',
  'votingDuration',
  'llmProvider',
  'llmModel',
  'temperature',
  'enable3D',
  'enableVoice',
] as const;

type SupportedConfigKey = (typeof SUPPORTED_CONFIG_KEYS)[number];
type NestedSection = 'game' | 'llm' | 'visualization';

type ConfigLocation = {
  section?: NestedSection;
  nestedKey?: string;
};

const CONFIG_LOCATIONS: Record<SupportedConfigKey, ConfigLocation> = {
  name: {},
  numPlayers: { section: 'game', nestedKey: 'numPlayers' },
  nightDuration: { section: 'game', nestedKey: 'nightPhaseDuration' },
  dayDuration: { section: 'game', nestedKey: 'dayPhaseDuration' },
  votingDuration: { section: 'game', nestedKey: 'votingDuration' },
  llmProvider: { section: 'llm', nestedKey: 'provider' },
  llmModel: { section: 'llm', nestedKey: 'model' },
  temperature: { section: 'llm', nestedKey: 'temperature' },
  enable3D: { section: 'visualization', nestedKey: 'enable3D' },
  enableVoice: { section: 'visualization', nestedKey: 'enableVoice' },
};

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

    const displayConfig = this.normalizeConfig(config);
    
    console.log(chalk.white('Game Settings:'));
    console.log(`  Name:              ${chalk.yellow((displayConfig.name as string) || 'N/A')}`);
    console.log(`  Players:           ${chalk.yellow((displayConfig.numPlayers as number)?.toString() || 'N/A')}`);
    console.log(`  Night Duration:    ${chalk.yellow((displayConfig.nightDuration as number)?.toString() || 'N/A')}`);
    console.log(`  Day Duration:      ${chalk.yellow((displayConfig.dayDuration as number)?.toString() || 'N/A')}`);
    console.log(`  Voting Duration:   ${chalk.yellow((displayConfig.votingDuration as number)?.toString() || 'N/A')}`);
    
    console.log(chalk.white('\nLLM Settings:'));
    console.log(`  Provider:          ${chalk.yellow((displayConfig.llmProvider as string) || 'N/A')}`);
    console.log(`  Model:             ${chalk.yellow((displayConfig.llmModel as string) || 'N/A')}`);
    console.log(`  Temperature:       ${chalk.yellow((displayConfig.temperature as number)?.toString() || 'N/A')}`);
    
    console.log(chalk.white('\nVisualization:'));
    console.log(`  3D Mode:           ${chalk.yellow((displayConfig.enable3D as boolean)?.toString() || 'N/A')}`);
    console.log(`  Voice:             ${chalk.yellow((displayConfig.enableVoice as boolean)?.toString() || 'N/A')}`);
    
    console.log('');
  }
  
  async setConfig(key: string, value: string): Promise<void> {
    if (!this.isSupportedConfigKey(key)) {
      throw new Error(`Unsupported configuration key "${key}". Valid keys: ${SUPPORTED_CONFIG_KEYS.join(', ')}`);
    }

    console.log(chalk.cyan(`\nSetting ${key} = ${value}\n`));

    const config = this.loadConfig();
    const existing = config as Record<string, unknown>;

    // Attempt to parse numeric / boolean values; keep strings otherwise
    let parsedValue: unknown = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) parsedValue = Number(value);

    const location = CONFIG_LOCATIONS[key];
    if (location.section && this.hasNestedConfigShape(existing)) {
      const section = this.asRecord(existing[location.section]);
      section[location.nestedKey as string] = parsedValue;
      existing[location.section] = section;
    } else {
      existing[key] = parsedValue;
    }
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
  
  private normalizeConfig(raw: Record<string, unknown>): Record<string, unknown> {
    const game = this.asRecord(raw.game);
    const llm = this.asRecord(raw.llm);
    const visualization = this.asRecord(raw.visualization);

    return {
      name: raw.name,
      numPlayers: game.numPlayers ?? raw.numPlayers,
      nightDuration: game.nightPhaseDuration ?? raw.nightDuration,
      dayDuration: game.dayPhaseDuration ?? raw.dayDuration,
      votingDuration: game.votingDuration ?? raw.votingDuration,
      llmProvider: llm.provider ?? raw.llmProvider,
      llmModel: llm.model ?? raw.llmModel,
      temperature: llm.temperature ?? raw.temperature,
      enable3D: visualization.enable3D ?? raw.enable3D,
      enableVoice: visualization.enableVoice ?? raw.enableVoice,
    };
  }

  private isSupportedConfigKey(key: string): key is SupportedConfigKey {
    return (SUPPORTED_CONFIG_KEYS as readonly string[]).includes(key);
  }

  private hasNestedConfigShape(config: Record<string, unknown>): boolean {
    return ['game', 'llm', 'visualization'].some((section) => Object.hasOwn(config, section));
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
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
