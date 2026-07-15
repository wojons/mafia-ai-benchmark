/**
 * Base Command Class
 * 
 * Base class for all CLI commands with common functionality.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

export interface CLIOptions {
  verbose?: boolean;
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

export abstract class BaseCommand extends Command {
  protected verbose: boolean = false;
  protected json: boolean = false;
  protected quiet: boolean = false;
  
  constructor(name: string, description: string) {
    super(name);
    this.description(description);
    this.addVerboseOption();
    this.addJsonOption();
    this.addQuietOption();
  }
  
  protected addVerboseOption(): void {
    this.option('-v, --verbose', 'Enable verbose logging', false);
  }
  
  protected addJsonOption(): void {
    this.option('--json', 'Output as JSON', false);
  }
  
  protected addQuietOption(): void {
    this.option('-q, --quiet', 'Suppress output', false);
  }
  
  protected log(message: string): void {
    if (!this.quiet) {
      console.log(message);
    }
  }
  
  protected showError(message: string): void {
    console.error(`❌ ${message}`);
  }
  
  protected warn(message: string): void {
    console.warn(`⚠️  ${message}`);
  }
  
  protected success(message: string): void {
    console.log(`✅ ${message}`);
  }
  
  protected info(message: string): void {
    console.log(`ℹ️  ${message}`);
  }
  
  protected debug(message: string): void {
    if (this.verbose) {
      console.log(`🔍 ${message}`);
    }
  }
  
  protected outputJSON(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  }
  
  protected async loadConfig(configPath?: string): Promise<Record<string, unknown>> {
    const file = configPath || path.resolve(process.cwd(), 'mafia.config.json');
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
      }
    } catch {
      // Ignore parse / read errors — treat as no config
    }
    return {};
  }

  protected async saveConfig(config: Record<string, unknown>, configPath?: string): Promise<void> {
    const file = configPath || path.resolve(process.cwd(), 'mafia.config.json');
    fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8');
  }
}

export default BaseCommand;
