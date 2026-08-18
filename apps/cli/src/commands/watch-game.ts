/**
 * Watch Game Command
 * 
 * Watch a game in real-time via WebSocket.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import WebSocket from 'ws';
import { resolveWsUrl } from '../config.js';

export class WatchGameCommand extends Command {
  private ws: WebSocket | null = null;
  
  constructor() {
    super('watch-game');
    this.description('Watch a game in real-time');
    
    this.argument('<game-id>', 'Game ID to watch');
    this.option('-s, --server <url>', 'Server URL (default: ws://localhost:3004/ws)');
    this.option('--no-color', 'Disable colors');

    this.action(async () => { await this.run(); });
  }
  
  async run(): Promise<void> {
    const [gameId] = this.args;
    const { server } = this.opts();
    // Resolve at run time, not in the option default: the env fallback
    // (MAFIA_SERVER_URL) can only be read once the command executes.
    const serverUrl = resolveWsUrl(server as string | undefined);
    
    console.log(chalk.cyan(`\n👀 Watching Game: ${gameId}\n`));
    
    try {
      await this.connectToGame(serverUrl, gameId);
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
        console.error(chalk.red(`Error: ${(message.payload as Record<string, unknown>)?.message}`));
        break;
    }
  }
  
  private displayGameState(payload: Record<string, unknown>): void {
    // The server wraps the state under payload.state (apps/server/src/websocket);
    // accept a bare state object too for robustness (MAF-GAP-046).
    const state = (payload.state as Record<string, unknown> | undefined) ?? payload;

    const phase = state.phase as string | undefined;
    const dayNumber = state.dayNumber as number | undefined;
    const turnNumber = state.turnNumber as number | undefined;
    const timeRemaining = state.timeRemaining as number | undefined;
    const activePlayers = state.activePlayers as string[] | undefined;

    console.log(chalk.white('\n📊 Game State:'));
    console.log(`  Phase:     ${chalk.cyan(phase ?? '—')}`);
    console.log(`  Day:       ${chalk.yellow(dayNumber !== undefined ? dayNumber.toString() : '—')}`);
    console.log(`  Turn:      ${chalk.yellow(turnNumber !== undefined ? turnNumber.toString() : '—')}`);
    console.log(`  Time:      ${chalk.yellow(timeRemaining !== undefined ? timeRemaining.toString() : '—')}s`);
    console.log(`  Alive:     ${chalk.green(activePlayers !== undefined ? activePlayers.length.toString() : '—')}`);

    if (activePlayers && activePlayers.length > 0) {
      console.log(chalk.gray('  Players: ') + activePlayers.join(', '));
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
        
      case 'WINNER_DETERMINED': {
        const winner = data.winner as string;
        console.log(chalk.green(`\n🏆 ${winner === 'MAFIA' ? 'Mafia' : 'Town'} WINS!`));
        console.log(chalk.gray(`  Mafia alive: ${data.mafiaCount}, Town alive: ${data.townCount}`));
        break;
      }
    }
  }
}

export default WatchGameCommand;
