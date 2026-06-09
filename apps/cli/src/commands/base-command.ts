/**
 * Base Command Class
 * 
 * Base class for all CLI commands with common functionality.
 */

import { Command } from 'commander';

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
  
  protected async loadConfig(_configPath?: string): Promise<Record<string, unknown>> {
    // TODO: Load configuration from file
    return {};
  }
  
  protected async saveConfig(_config: Record<string, unknown>, _configPath?: string): Promise<void> {
    // TODO: Save configuration to file
  }
}

export default BaseCommand;
