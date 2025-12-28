/**
 * Stats Command
 * 
 * Display game and model statistics.
 */

import { Command } from 'commander';
import chalk from 'chalk';

export class StatsCommand extends Command {
  constructor() {
    super('stats', 'Display game and model statistics');
    
    this.option('--json', 'Output as JSON');
    this.option('--games', 'Show game statistics');
    this.option('--models', 'Show model comparison');
    this.option('--verbose', 'Show detailed statistics');
  }
  
  async run(): Promise<void> {
    const { json, games, models, verbose } = this.parseOptions();
    
    console.log(chalk.cyan('\n📊 Mafia AI Benchmark Statistics\n'));
    
    try {
      const stats = await this.fetchStats();
      
      if (json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      
      // Game statistics
      console.log(chalk.white('📈 Game Statistics:'));
      console.log(`  Total Games:       ${chalk.yellow(stats.totalGames.toString())}`);
      console.log(`  Active Games:      ${chalk.green(stats.activeGames.toString())}`);
      console.log(`  Completed Games:   ${chalk.gray(stats.completedGames.toString())}`);
      console.log(`  Mafia Wins:        ${chalk.red(stats.mafiaWins.toString())}`);
      console.log(`  Town Wins:         ${chalk.blue(stats.townWins.toString())}`);
      console.log(`  Avg Duration:      ${chalk.yellow(this.formatDuration(stats.avgDuration))}`);
      
      // Mafia win rate
      if (stats.completedGames > 0) {
        const mafiaWinRate = (stats.mafiaWins / stats.completedGames * 100).toFixed(1);
        const townWinRate = (stats.townWins / stats.completedGames * 100).toFixed(1);
        console.log(`  Mafia Win Rate:    ${chalk.red(mafiaWinRate + '%')}`);
        console.log(`  Town Win Rate:     ${chalk.blue(townWinRate + '%')}`);
      }
      
      console.log('');
      
      // Model statistics
      console.log(chalk.white('🤖 Model Performance (Top 5):'));
      console.log(chalk.gray('  Provider/Model          Games  Win Rate  Avg Tokens  Avg Cost'));
      console.log(chalk.gray('  ' + '─'.repeat(65)));
      
      stats.topModels.slice(0, 5).forEach((model, i) => {
        const rank = (i + 1).toString().padStart(2);
        const name = `${model.provider}/${model.model}`.padEnd(24);
        const gamesStr = model.gamesPlayed.toString().padStart(5);
        const winRate = (model.winRate * 100).toFixed(1).padStart(7) + '%';
        const tokens = (model.avgTokens / 1000).toFixed(1).padStart(8) + 'K';
        const cost = '$' + model.avgCost.toFixed(2).padStart(6);
        
        console.log(`  ${rank} ${name} ${gamesStr}  ${winRate}  ${tokens}  ${cost}`);
      });
      
      console.log('');
      
      if (verbose) {
        console.log(chalk.white('💰 Cost Summary:'));
        console.log(`  Total Tokens Used:    ${chalk.yellow((stats.totalTokens / 1000000).toFixed(2) + 'M')}`);
        console.log(`  Total Cost:           ${chalk.yellow('$' + stats.totalCost.toFixed(2))}`);
        console.log(`  Avg Cost/Game:        ${chalk.yellow('$' + stats.avgCostPerGame.toFixed(2))}`);
        
        console.log('');
        
        console.log(chalk.white('⚡ Performance:'));
        console.log(`  Total API Calls:      ${chalk.yellow(stats.totalAPICalls.toString())}`);
        console.log(`  Avg Latency:          ${chalk.yellow(stats.avgLatency.toFixed(0) + 'ms')}`);
        console.log(`  Error Rate:           ${chalk.red((stats.errorRate * 100).toFixed(2) + '%')}`);
      }
      
      console.log('');
    } catch (error) {
      console.error(chalk.red('Failed to fetch statistics:', error));
    }
  }
  
  private async fetchStats(): Promise<Record<string, unknown>> {
    // TODO: Fetch from server
    // Simulated data
    return {
      totalGames: 156,
      activeGames: 3,
      completedGames: 153,
      mafiaWins: 72,
      townWins: 81,
      avgDuration: 1250000, // ms
      totalTokens: 45800000,
      totalCost: 342.50,
      avgCostPerGame: 2.24,
      totalAPICalls: 4520,
      avgLatency: 245,
      errorRate: 0.02,
      topModels: [
        { provider: 'anthropic', model: 'claude-sonnet-4.5', gamesPlayed: 45, winRate: 0.58, avgTokens: 125000, avgCost: 1.85 },
        { provider: 'openai', model: 'gpt-5.1', gamesPlayed: 38, winRate: 0.55, avgTokens: 98000, avgCost: 1.22 },
        { provider: 'google', model: 'gemini-2.5-pro', gamesPlayed: 32, winRate: 0.52, avgTokens: 112000, avgCost: 0.95 },
        { provider: 'xai', model: 'grok-4-fast', gamesPlayed: 24, winRate: 0.48, avgTokens: 85000, avgCost: 0.42 },
        { provider: 'groq', model: 'llama-3.3-70b', gamesPlayed: 17, winRate: 0.45, avgTokens: 45000, avgCost: 0.18 },
      ],
    };
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
}

export default StatsCommand;
