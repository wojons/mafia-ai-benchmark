/**
 * Benchmark Export Command
 * 
 * Export benchmark report data as JSON or CSV.
 * Fetches data from the Mafia AI Benchmark server API.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { resolveServerUrl } from '../config.js';

interface ExportOptions {
  format: 'json' | 'csv';
  games?: number;
  output?: string;
  server?: string;
}

export class ExportCommand extends Command {
  constructor() {
    super('export');
    this.description('Export benchmark report data as JSON or CSV');
    
    this.option('-f, --format <format>', 'Output format: json or csv', 'json');
    this.option('-g, --games <n>', 'Number of games to include (default: 50)', parseInt);
    this.option('-o, --output <file>', 'Write output to file instead of stdout');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');
  }
  
  async run(): Promise<void> {
    const opts = this.opts<ExportOptions>();
    
    const format = (opts.format || 'json').toLowerCase();
    if (format !== 'json' && format !== 'csv') {
      console.error(chalk.red(`❌ Invalid format: ${format}. Use json or csv.`));
      process.exit(1);
      return; // defense in depth: never fall through to fetch if exit is stubbed
    }
    
    const serverUrl = resolveServerUrl(opts.server);
    const gamesParam = opts.games ? `&games=${opts.games}` : '';
    const url = `${serverUrl}/api/v1/benchmark/export?format=${format}${gamesParam}`;
    
    console.error(chalk.gray(`📡 Fetching export from ${url}...`));
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': format === 'csv' ? 'text/csv' : 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errorText}`);
      }
      
      const data = format === 'csv' 
        ? await response.text()
        : JSON.stringify(await response.json(), null, 2);
      
      if (opts.output) {
        const outputPath = path.resolve(opts.output);
        fs.writeFileSync(outputPath, data, 'utf-8');
        console.error(chalk.green(`\n✅ Export saved to: ${outputPath}`));
        console.error(chalk.gray(`   Size: ${(Buffer.byteLength(data, 'utf-8') / 1024).toFixed(1)} KB`));
      } else {
        // Write to stdout
        process.stdout.write(data);
        // If not piped, add a trailing newline for readability
        if (process.stdout.isTTY) {
          console.log('');
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
        console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
      } else {
        console.error(chalk.red(`\n❌ Export failed: ${error.message}`));
      }
      process.exit(1);
    }
  }
}

export default ExportCommand;
