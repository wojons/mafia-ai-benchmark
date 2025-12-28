/**
 * Mafia CLI - Main Entry Point
 * 
 * Command-line interface for the Mafia AI Benchmark system.
 */

import { Command } from 'commander';
import { version } from '../package.json';

import { RunGameCommand } from './commands/run-game.js';
import { WatchGameCommand } from './commands/watch-game.js';
import { ListGamesCommand } from './commands/list-games.js';
import { ConfigCommand } from './commands/config.js';
import { StatsCommand } from './commands/stats.js';
import { BenchmarkCommand } from './commands/benchmark.js';
import { InitCommand } from './commands/init.js';

const program = new Command();

program
  .name('mafiactl')
  .description('Mafia AI Benchmark CLI - Manage games, agents, and benchmarks')
  .version(version || '1.0.0')
  .option('--verbose', 'Enable verbose logging')
  .option('--config <path>', 'Config file path', './mafia.config.json');

// Global options
program.configureOutput({
  writeOut: (str) => process.stdout.write(str),
  writeErr: (str) => process.stderr.write(str),
  getErrorHelpWidth: () => process.stdout.columns,
  getOutputHelpWidth: () => process.stdout.columns,
});

// Register commands
program.addCommand(new InitCommand());
program.addCommand(new RunGameCommand());
program.addCommand(new WatchGameCommand());
program.addCommand(new ListGamesCommand());
program.addCommand(new ConfigCommand());
program.addCommand(new StatsCommand());
program.addCommand(new BenchmarkCommand());

// Default command - show help
program.action(() => {
  program.help();
});

// Handle errors
program.on('command:*', (cmd) => {
  console.error(`\n❌ Unknown command: ${cmd[0]}`);
  console.error('Run "mafiactl --help" for available commands\n');
  process.exit(1);
});

program.on('--help', () => {
  console.log('');
  console.log('📚 Examples:');
  console.log('  $ mafiactl init                    # Initialize configuration');
  console.log('  $ mafiactl run-game                # Run a game');
  console.log('  $ mafiactl watch-game <game-id>    # Watch a game in real-time');
  console.log('  $ mafiactl list-games              # List recent games');
  console.log('  $ mafiactl config show             # Show current configuration');
  console.log('  $ mafiactl stats                   # Show statistics');
  console.log('  $ mafiactl benchmark --games 10    # Run benchmark suite');
  console.log('');
  console.log('🔗 Links:');
  console.log('  Docs:  https://github.com/wojons/mafia-ai-benchmark');
  console.log('  Issues: https://github.com/wojons/mafia-ai-benchmark/issues');
  console.log('');
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('\n❌ Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

export default program;
