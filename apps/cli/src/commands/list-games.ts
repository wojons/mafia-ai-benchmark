/**
 * List Games Command
 * 
 * List recent and active games.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { formatDistanceToNow } from 'date-fns';

export class ListGamesCommand extends Command {
  constructor() {
    super('list-games', 'List recent and active games');
    
    this.option('--status <status>', 'Filter by status (setup, in_progress, ended)');
    this.option('--limit <n>', 'Maximum games to show', '10');
    this.option('--json', 'Output as JSON');
  }
  
  async run(): Promise<void> {
    const { status, limit, json } = this.parseOptions();
    
    console.log(chalk.cyan('\n📋 Recent Games\n'));
    
    try {
      const games = await this.fetchGames(status, parseInt(limit));
      
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
    } catch (error) {
      console.error(chalk.red('Failed to fetch games:', error));
    }
  }
  
  private async fetchGames(status?: string, limit?: number): Promise<Array<{
    id: string;
    status: string;
    players: number;
    createdAt: string;
  }>> {
    // TODO: Fetch from server
    // Simulated data for now
    return [
      {
        id: 'game-abc123',
        status: 'IN_PROGRESS',
        players: 10,
        createdAt: '2 minutes ago',
      },
      {
        id: 'game-def456',
        status: 'ENDED',
        players: 10,
        createdAt: '1 hour ago',
      },
      {
        id: 'game-ghi789',
        status: 'ENDED',
        players: 8,
        createdAt: '3 hours ago',
      },
    ];
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
