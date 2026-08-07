/**
 * Benchmark Command
 * 
 * Show the accumulated benchmark report from the server.
 * 
 * MAF-GAP-010: this command previously FABRICATED results (random wins,
 * win rates, token/cost averages after a fake 500ms sleep). It now fetches
 * and displays the real GET /api/v1/benchmark/report from the server.
 * Fresh benchmark runs (POST /api/v1/benchmark) are not yet available
 * (MAF-GAP-011), so the legacy pretend-run options are accepted for
 * backward compatibility but only produce a note.
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import { ExportCommand } from './export.js';
import { resolveServerUrl } from '../config.js';

interface BenchmarkReport {
  generatedAt?: string;
  summary: {
    totalGames: number;
    activeGames?: number;
    completedGames?: number;
    mafiaWinRate?: number;
    avgDuration?: number;
  };
  modelPerformance: Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    winRate: number;
    avgTokens: number;
    avgCost: number;
    avgLatency?: number;
  }>;
  agentStats?: unknown[];
  recommendations?: string[];
}

export class BenchmarkCommand extends Command {
  constructor() {
    super('benchmark');
    this.description('Show the accumulated benchmark report from the server');
    
    this.option('--quick', 'Show the accumulated benchmark report (accepted for backward compatibility)', false);
    this.option('--export <path>', 'Export results to file');
    this.option('--json', 'Output results as JSON');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');
    
    // Legacy pretend-run options — accepted (hidden) so existing invocations
    // do not error; they cannot start fresh runs (POST /api/v1/benchmark is
    // broken, MAF-GAP-011), so run() prints a note and shows the report.
    this.addOption(new Option('-g, --games <n>', 'Number of games to run').hideHelp());
    this.addOption(new Option('--models <models>', 'Comma-separated list of models to benchmark').hideHelp());
    this.addOption(new Option('--parallel', 'Run games in parallel').hideHelp());
    
    // Add export subcommand
    this.addCommand(new ExportCommand());

    this.action(async () => { await this.run(); });
  }
  
  async run(): Promise<void> {
    const { quick: _quick, export: exportPath, json, server, games, models, parallel } = this.opts();
    
    const serverUrl = resolveServerUrl(server);
    
    console.log(chalk.cyan('\n🏁 Mafia AI Benchmark Suite\n'));
    
    // The CLI cannot start fresh benchmark runs yet — these options implied
    // running new games, which would have fabricated numbers. Note and proceed
    // with the accumulated server report.
    if (games !== undefined || models !== undefined || parallel !== undefined) {
      console.log(chalk.yellow('⚠️  Fresh benchmark runs are not yet available — showing the accumulated server report instead.'));
      console.log('');
    }
    
    try {
      const report = await this.fetchReport(serverUrl);
      
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        this.displayResults(report);
      }
      
      // Export results if requested
      if (exportPath) {
        this.exportResults(report, exportPath);
      }
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
        console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
      } else {
        console.error(chalk.red(`\n❌ Failed to fetch benchmark report: ${error.message}`));
      }
      process.exit(1);
    }
  }
  
  private async fetchReport(serverUrl: string): Promise<BenchmarkReport> {
    const url = `${serverUrl}/api/v1/benchmark/report`;
    
    console.log(chalk.gray(`📡 Fetching benchmark report from ${url}...`));
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }
    
    return await response.json() as BenchmarkReport;
  }
  
  private displayResults(report: BenchmarkReport): void {
    const summary = report.summary || { totalGames: 0 };
    const results = report.modelPerformance || [];
    const recommendations = report.recommendations || [];
    
    console.log(chalk.green('\n✅ Benchmark Report\n'));
    
    console.log(chalk.white('Summary:'));
    console.log(`  Total Games:      ${chalk.yellow((summary.totalGames ?? 0).toString())}`);
    if (summary.completedGames !== undefined) {
      console.log(`  Completed Games:  ${chalk.yellow(summary.completedGames.toString())}`);
    }
    if (summary.activeGames !== undefined) {
      console.log(`  Active Games:     ${chalk.yellow(summary.activeGames.toString())}`);
    }
    const avgDuration = summary.avgDuration ?? 0;
    if (avgDuration > 0) {
      console.log(`  Avg Time/Game:    ${chalk.yellow(this.formatDuration(avgDuration))}`);
    } else {
      console.log(`  Avg Time/Game:    ${chalk.gray('n/a')}`);
    }
    
    console.log(chalk.white('\n📊 Results by Model:'));
    console.log(chalk.gray('  Model                  Games  Wins  Losses  Win Rate  Avg Tokens  Avg Cost'));
    console.log(chalk.gray('  ' + '─'.repeat(75)));
    
    results.forEach(r => {
      const model = `${r.provider}/${r.model}`.padEnd(20);
      const gamesPlayed = (r.gamesPlayed ?? 0);
      const wins = (r.wins ?? 0);
      const games = gamesPlayed.toString().padStart(5);
      const winsStr = wins.toString().padStart(5);
      const losses = (gamesPlayed - wins).toString().padStart(6);
      const winRate = ((r.winRate ?? 0) * 100).toFixed(1).padStart(8) + '%';
      const tokens = ((r.avgTokens ?? 0) / 1000).toFixed(1).padStart(10) + 'K';
      const cost = '$' + (r.avgCost ?? 0).toFixed(2).padStart(7);
      
      console.log(`  ${model} ${games}  ${winsStr}  ${losses}  ${winRate}  ${tokens}  ${cost}`);
    });
    
    if (results.length > 0) {
      const winner = results.reduce((best, m) => (m.winRate ?? 0) > (best.winRate ?? 0) ? m : best, results[0]);
      console.log(chalk.green('\n🏆 Winner: ') + chalk.yellow(`${winner.provider}/${winner.model}`) + 
                  chalk.gray(` (${((winner.winRate ?? 0) * 100).toFixed(1)}% win rate)\n`));
    }
    
    // Recommendations come from the server report
    if (recommendations.length > 0) {
      console.log(chalk.white('💡 Recommendations:'));
      recommendations.forEach(r => {
        console.log(`  • ${r}`);
      });
      console.log('');
    }
  }
  
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
  
  private exportResults(report: BenchmarkReport, exportPath: string): void {
    fs.writeFileSync(exportPath, JSON.stringify(report, null, 2));
    console.log(chalk.green(`\n📁 Results exported to: ${exportPath}\n`));
  }
}

export default BenchmarkCommand;
