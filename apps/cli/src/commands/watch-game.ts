/**
 * Watch Game Command
 * 
 * Watch a game in real-time via WebSocket.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import WebSocket from 'ws';

export class WatchGameCommand extends Command {
  private ws: WebSocket | null = null;
  
  constructor() {
    super('watch-game', 'Watch a game in real-time');
    
    this.argument('<game-id>', 'Game ID to watch');
    this.option('-s, --server <url>', 'Server URL', 'ws://localhost:3000/ws');
    this.option('--no-color', 'Disable colors');
  }
  
  async run(): Promise<void> {
    const [gameId] = this.parseArguments();
    const { server, noColor } = this.parseOptions();
    
    console.log(chalk.cyan(`\n👀 Watching Game: ${gameId}\n`));
    
    try {
      await this.connectToGame(server, gameId);
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to connect to game:'), error);
      process.exit(1);
    }
  }
  
  private async connectToGame(serverUrl: string, gameId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(chalk.gray(`Connecting to ${serverUrl}...`));
      
      try {
        this.ws = new WebSocket(serverUrl);
        
        this.ws.on('open', () => {
          console.log(chalk.green('Connected!\n'));
          
          // Join game
          this.ws!.send(JSON.stringify({
            type: 'JOIN_GAME',
            payload: { gameId },
          }));
          
          resolve();
        });
        
        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.displayMessage(message);
          } catch {
            // Ignore parse errors
          }
        });
        
        this.ws.on('close', () => {
          console.log(chalk.gray('\n\nDisconnected from game server'));
          process.exit(0);
        });
        
        this.ws.on('error', (error) => {
          reject(error);
        });
        
        // Handle Ctrl+C
        process.on('SIGINT', () => {
          if (this.ws) {
            this.ws.close();
          }
          process.exit(0);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  private displayMessage(message: Record<string, unknown>): void {
    const type = message.type as string;
    
    switch (type) {
      case 'GAME_JOINED':
        console.log(chalk.green('✓ Now watching game'));
        break;
        
      case 'GAME_STATE':
        this.displayGameState(message.payload as Record<string, unknown>);
        break;
        
      case 'GAME_EVENT':
        this.displayGameEvent(message.payload as Record<string, unknown>);
        break;
        
      case 'ERROR':
        console.error(chalk.red(`Error: ${message.payload?.message}`));
        break;
    }
  }
  
  private displayGameState(state: Record<string, unknown>): void {
    console.log(chalk.white('\n📊 Game State:'));
    console.log(`  Phase:     ${chalk.cyan(state.phase as string)}`);
    console.log(`  Day:       ${chalk.yellow((state.dayNumber as number).toString())}`);
    console.log(`  Turn:      ${chalk.yellow((state.turnNumber as number).toString())}`);
    console.log(`  Time:      ${chalk.yellow((state.timeRemaining as number).toString())}s`);
    console.log(`  Alive:     ${chalk.green((state.activePlayers as string[]).length.toString())}`);
    
    const players = state.activePlayers as string[];
    if (players && players.length > 0) {
      console.log(chalk.gray('  Players: ') + players.join(', '));
    }
  }
  
  private displayGameEvent(event: Record<string, unknown>): void {
    const type = event.type as string;
    const data = event.data as Record<string, unknown>;
    
    switch (type) {
      case 'PHASE_CHANGED':
        console.log(chalk.cyan(`\n🔄 Phase: ${data.fromPhase} → ${data.toPhase}`));
        break;
        
      case 'PLAYER_JOINED':
        console.log(chalk.green(`\n👤 ${data.name} joined the game`));
        break;
        
      case 'AGENT_SAYS_BROADCASTED':
        console.log(chalk.white(`\n💬 ${data.playerName}: "${data.statement}"`));
        break;
        
      case 'VOTE_CAST':
        console.log(chalk.yellow(`\n🗳️  ${data.voterId} voted for ${data.targetId}`));
        break;
        
      case 'PLAYER_KILLED':
        console.log(chalk.red(`\n💀 ${data.playerName} was killed (${data.role})`));
        break;
        
      case 'PLAYER_LYNCHED':
        console.log(chalk.red(`\n🪨 ${data.playerName} was lynched (${data.role}) - ${data.votes} votes`));
        break;
        
      case 'MAFIA_TEAM_NOTIFIED':
        console.log(chalk.gray(`\n🤫 Mafia team: ${(data.teammates as string[]).join(', ')}`));
        break;
        
      case 'WINNER_DETERMINED':
        const winner = data.winner as string;
        console.log(chalk.green(`\n🏆 ${winner === 'MAFIA' ? 'Mafia' : 'Town'} WINS!`));
        console.log(chalk.gray(`  Mafia alive: ${data.mafiaCount}, Town alive: ${data.townCount}`));
        break;
    }
  }
}

export default WatchGameCommand;
