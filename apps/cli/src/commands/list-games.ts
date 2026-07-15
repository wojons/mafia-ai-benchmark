/**
 * List Games Command
 * 
 * List recent and active games.
 */

import { Command } from 'commander';
import chalk from 'chalk';

export class ListGamesCommand extends Command {
  constructor() {
    super('list-games');
    this.description('List recent and active games');
    
    this.option('--status <status>', 'Filter by status (setup, in_progress, ended)');
    this.option('--limit <n>', 'Maximum games to show', '10');
    this.option('--json', 'Output as JSON');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3000)');
  }
  
  async run(): Promise<void> {
    const { status, limit, json, server } = this.opts();
    
    const serverUrl = server || process.env.MAFIA_SERVER_URL || 'http://localhost:3000';
    
    console.log(chalk.cyan('\n📋 Recent Games\n'));
    
    try {
      const games = await this.fetchGames(serverUrl, status, parseInt(limit));
      
      if (json) {
        console.log(JSON.stringify(games, null, 2));
        return;
      }
      
      if (games.length === 0) {
        console.log(chalk.gray('No games found.\n'));
        return;
      }
      
      console.log(chalk.white('  ID                    Status          Players  Created'));
      console.log(chalk.gray('  ' + '─'.repeat(80)));
      
      games.forEach(game => {
        const statusColor = this.getStatusColor(game.status);
        console.log(
          chalk.gray('  ') +
          game.id.substring(0, 20).padEnd(20) + ' ' +
          statusColor(game.status.padEnd(13)) + ' ' +
          game.players.toString().padEnd(8) +
          game.createdAt
        );
      });
      
      console.log(chalk.gray('\nTotal: ' + games.length + ' games\n'));
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
        console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
      } else {
        console.error(chalk.red(`\n❌ Failed to fetch games: ${error.message}`));
      }
    }
  }
  
  private async fetchGames(serverUrl: string, status?: string, limit?: number): Promise<Array<{
    id: string;
    status: string;
    players: number;
    createdAt: string;
  }>> {
    const params = new URLSearchParams();
    if (status) params.set('status', status.toUpperCase());
    if (limit) params.set('limit', limit.toString());
    const query = params.toString();
    const url = `${serverUrl}/api/v1/games${query ? '?' + query : ''}`;

    console.log(chalk.gray(`📡 Fetching games from ${url}...`));

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const body = await response.json() as { success: boolean; data: Array<Record<string, unknown>> };
    const games = Array.isArray(body.data) ? body.data : [];

    return games.map((g) => {
      const createdAtRaw = g.createdAt as string | number | Date | undefined;
      let createdAtStr: string;
      if (!createdAtRaw) {
        createdAtStr = 'unknown';
      } else if (typeof createdAtRaw === 'number') {
        createdAtStr = new Date(createdAtRaw).toLocaleString();
      } else if (createdAtRaw instanceof Date) {
        createdAtStr = createdAtRaw.toLocaleString();
      } else {
        createdAtStr = String(createdAtRaw);
      }
      return {
        id: (g.id as string) || 'unknown',
        status: (g.status as string) || 'UNKNOWN',
        players: (g.players as number) || 0,
        createdAt: createdAtStr,
      };
    });
  }
  
  private getStatusColor(status: string): (text: string) => string {
    switch (status.toUpperCase()) {
      case 'SETUP':
        return chalk.blue;
      case 'IN_PROGRESS':
        return chalk.green;
      case 'ENDED':
        return chalk.gray;
      default:
        return chalk.white;
    }
  }
}

export default ListGamesCommand;
