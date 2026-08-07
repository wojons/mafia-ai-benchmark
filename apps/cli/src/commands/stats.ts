/**
 * Stats Command
 * 
 * Display game and model statistics.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveServerUrl } from '../config.js';

interface Stats {
  totalGames: number;
  activeGames: number;
  completedGames: number;
  mafiaWins: number;
  townWins: number;
  avgDuration: number;
  topModels: Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    winRate: number;
    avgTokens: number;
    avgCost: number;
  }>;
  totalTokens: number;
  totalCost: number;
  avgCostPerGame: number;
  totalAPICalls: number;
  avgLatency: number;
  errorRate: number;
}

export class StatsCommand extends Command {
  constructor() {
    super('stats');
    this.description('Display game and model statistics');
    
    this.option('--json', 'Output as JSON');
    this.option('--games', 'Show game statistics');
    this.option('--models', 'Show model comparison');
    this.option('--verbose', 'Show detailed statistics');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');

    this.action(async () => { await this.run(); });
  }
  
  async run(): Promise<void> {
    const { json, games: _games, models: _models, verbose, server } = this.opts();
    
    const serverUrl = resolveServerUrl(server);
    
    console.log(chalk.cyan('\n📊 Mafia AI Benchmark Statistics\n'));
    
    try {
      const stats = await this.fetchStats(serverUrl);
      
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
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
        console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
      } else {
        console.error(chalk.red(`\n❌ Failed to fetch statistics: ${error.message}`));
      }
    }
  }
  
  private async fetchStats(serverUrl: string): Promise<Stats> {
    const url = `${serverUrl}/api/v1/stats`;
    const modelUrl = `${serverUrl}/api/v1/stats/models`;

    console.log(chalk.gray(`📡 Fetching statistics from ${url}...`));

    // Fetch game stats
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const body = await response.json() as { success: boolean; data: Record<string, unknown> };
    const data = (body.data || {}) as Record<string, unknown>;

    // Fetch model comparison (best-effort — non-fatal if unavailable)
    let topModels: Stats['topModels'] = [];
    try {
      const modelResponse = await fetch(modelUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (modelResponse.ok) {
        const modelBody = await modelResponse.json() as { success: boolean; data: Array<Record<string, unknown>> };
        const models = Array.isArray(modelBody.data) ? modelBody.data : [];
        topModels = models.map((m) => ({
          provider: (m.provider as string) || 'unknown',
          model: (m.model as string) || 'unknown',
          gamesPlayed: (m.gamesPlayed as number) || 0,
          winRate: (m.winRate as number) || 0,
          avgTokens: (m.avgTokens as number) || 0,
          avgCost: (m.avgCost as number) || 0,
        }));
      }
    } catch {
      // Model stats unavailable — continue with empty list
    }

    // Map server data → Stats interface, defaulting fields the server may not provide
    return {
      totalGames: (data.totalGames as number) || 0,
      activeGames: (data.activeGames as number) || 0,
      completedGames: (data.completedGames as number) || 0,
      mafiaWins: (data.mafiaWins as number) || 0,
      townWins: (data.townWins as number) || 0,
      avgDuration: (data.avgDuration as number) || 0,
      totalTokens: (data.totalTokens as number) || 0,
      totalCost: (data.totalCost as number) || 0,
      avgCostPerGame: (data.avgCostPerGame as number) || 0,
      totalAPICalls: (data.totalAPICalls as number) || 0,
      avgLatency: (data.avgLatency as number) || 0,
      errorRate: (data.errorRate as number) || 0,
      topModels,
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
