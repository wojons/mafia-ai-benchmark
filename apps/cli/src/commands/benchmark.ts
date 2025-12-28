/**
 * Benchmark Command
 * 
 * Run automated benchmark suite.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';

export class BenchmarkCommand extends Command {
  constructor() {
    super('benchmark', 'Run automated benchmark suite');
    
    this.option('-g, --games <n>', 'Number of games to run', '10');
    this.option('--models <models>', 'Comma-separated list of models to benchmark');
    this.option('--parallel', 'Run games in parallel', false);
    this.option('--quick', 'Quick benchmark (3 games)', false);
    this.option('--export <path>', 'Export results to file');
    this.option('--json', 'Output results as JSON');
  }
  
  async run(): Promise<void> {
    const { games, models, parallel, quick, export: exportPath, json } = this.parseOptions();
    
    console.log(chalk.cyan('\n🏁 Mafia AI Benchmark Suite\n'));
    
    const numGames = quick ? 3 : parseInt(games);
    const modelList = models ? models.split(',') : ['gpt-5.1', 'claude-sonnet-4.5', 'gemini-2.5-pro'];
    
    // Display benchmark configuration
    console.log(chalk.white('Benchmark Configuration:'));
    console.log(`  Games:           ${chalk.yellow(numGames.toString())}`);
    console.log(`  Models:          ${chalk.yellow(modelList.join(', '))}`);
    console.log(`  Mode:            ${chalk.yellow(parallel ? 'Parallel' : 'Sequential')}`);
    console.log(`  Export:          ${exportPath ? chalk.yellow(exportPath) : chalk.gray('None')}`);
    console.log('');
    
    if (!quick) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Run ${numGames} games across ${modelList.length} models?`,
          default: true,
        },
      ]);
      
      if (!confirm) {
        console.log(chalk.gray('\nCancelled.\n'));
        return;
      }
    }
    
    console.log(chalk.cyan('Running benchmark...\n'));
    
    try {
      const results = await this.runBenchmark({
        numGames,
        models: modelList,
        parallel,
      });
      
      if (json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        this.displayResults(results);
      }
      
      // Export results if requested
      if (exportPath) {
        this.exportResults(results, exportPath);
      }
    } catch (error) {
      console.error(chalk.red('\n❌ Benchmark failed:'), error);
      process.exit(1);
    }
  }
  
  private async runBenchmark(options: {
    numGames: number;
    models: string[];
    parallel: boolean;
  }): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const results: Array<{
      model: string;
      gamesPlayed: number;
      wins: number;
      losses: number;
      winRate: number;
      avgDuration: number;
      avgTokens: number;
      avgCost: number;
    }> = [];
    
    for (const model of options.models) {
      console.log(chalk.gray(`  Testing ${model}...`));
      
      // Simulate benchmark
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const gamesPlayed = options.numGames;
      const wins = Math.floor(Math.random() * gamesPlayed * 0.6);
      
      results.push({
        model,
        gamesPlayed,
        wins,
        losses: gamesPlayed - wins,
        winRate: wins / gamesPlayed,
        avgDuration: 1200000 + Math.random() * 300000,
        avgTokens: 80000 + Math.floor(Math.random() * 40000),
        avgCost: 1 + Math.random() * 2,
      });
    }
    
    const totalTime = Date.now() - startTime;
    
    return {
      summary: {
        totalGames: options.numGames * options.models.length,
        totalTime,
        avgTimePerGame: totalTime / (options.numGames * options.models.length),
      },
      results,
      winner: results.reduce((best, m) => m.winRate > best.winRate ? m : best, results[0]),
      recommendations: this.generateRecommendations(results),
    };
  }
  
  private displayResults(results: Record<string, unknown>): void {
    const summary = results.summary as Record<string, number>;
    const resultList = results.results as Array<{
      model: string;
      gamesPlayed: number;
      wins: number;
      losses: number;
      winRate: number;
      avgDuration: number;
      avgTokens: number;
      avgCost: number;
    }>;
    const winner = results.winner as { model: string; winRate: number };
    
    console.log(chalk.green('\n✅ Benchmark Complete!\n'));
    
    console.log(chalk.white('Summary:'));
    console.log(`  Total Games:      ${chalk.yellow(summary.totalGames.toString())}`);
    console.log(`  Total Time:       ${chalk.yellow((summary.totalTime / 1000).toFixed(1) + 's')}`);
    console.log(`  Avg Time/Game:    ${chalk.yellow((summary.avgTimePerGame / 1000).toFixed(1) + 's')}`);
    
    console.log(chalk.white('\n📊 Results by Model:'));
    console.log(chalk.gray('  Model                  Games  Wins  Losses  Win Rate  Avg Tokens  Avg Cost'));
    console.log(chalk.gray('  ' + '─'.repeat(75)));
    
    resultList.forEach(r => {
      const model = r.model.padEnd(20);
      const games = r.gamesPlayed.toString().padStart(5);
      const wins = r.wins.toString().padStart(5);
      const losses = r.losses.toString().padStart(6);
      const winRate = (r.winRate * 100).toFixed(1).padStart(8) + '%';
      const tokens = (r.avgTokens / 1000).toFixed(1).padStart(10) + 'K';
      const cost = '$' + r.avgCost.toFixed(2).padStart(7);
      
      console.log(`  ${model} ${games}  ${wins}  ${losses}  ${winRate}  ${tokens}  ${cost}`);
    });
    
    console.log(chalk.green('\n🏆 Winner: ') + chalk.yellow(winner.model) + 
                chalk.gray(` (${(winner.winRate * 100).toFixed(1)}% win rate)\n`));
    
    // Recommendations
    const recommendations = results.recommendations as string[];
    if (recommendations.length > 0) {
      console.log(chalk.white('💡 Recommendations:'));
      recommendations.forEach(r => {
        console.log(`  • ${r}`);
      });
      console.log('');
    }
  }
  
  private generateRecommendations(results: Array<{
    model: string;
    winRate: number;
    avgCost: number;
  }>): string[] {
    const recommendations: string[] = [];
    
    // Best performer
    const best = results.reduce((b, m) => m.winRate > b.winRate ? m : b, results[0]);
    recommendations.push(`${best.model} has the highest win rate (${(best.winRate * 100).toFixed(1)}%)`);
    
    // Best value
    const value = results.reduce((b, m) => {
      const bValue = b.winRate / b.avgCost;
      const mValue = m.winRate / m.avgCost;
      return mValue > bValue ? m : b;
    }, results[0]);
    recommendations.push(`${value.model} offers the best value (win rate per dollar)`);
    
    // Cost-effective option
    const cheapest = results.reduce((b, m) => m.avgCost < b.avgCost ? m : b, results[0]);
    recommendations.push(`${cheapest.model} is the most cost-effective option`);
    
    return recommendations;
  }
  
  private exportResults(results: Record<string, unknown>, exportPath: string): void {
    const fs = require('fs');
    fs.writeFileSync(exportPath, JSON.stringify(results, null, 2));
    console.log(chalk.green(`\n📁 Results exported to: ${exportPath}\n`));
  }
}

export default BenchmarkCommand;
