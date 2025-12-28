/**
 * Finite State Machine (FSM) Game Engine
 * 
 * Core game state machine for the Mafia AI Benchmark system.
 * Manages game phases, transitions, and state validation.
 */

import { 
  Game, 
  GameState, 
  GamePhase, 
  GameEvent, 
  Player, 
  Vote, 
  NightAction,
  GameConfig,
  RoleType
} from '../types/index.js';
import { createEvent, EventType, GameEvent as GameEventType } from '../events/index.js';

// FSM State interface
export interface FSMState {
  enter(game: Game): void;
  exit(game: Game): void;
  update(game: Game, deltaTime: number): void;
  handleEvent(game: Game, event: GameEvent): void;
  getName(): string;
}

// FSM Context
export interface FSMContext {
  currentState: FSMState;
  stateHistory: string[];
  eventQueue: GameEvent[];
  timers: Map<string, number>;
  subscriptions: Map<string, Set<(event: GameEvent) => void>>;
}

// State machine implementation
export class GameFSM {
  private states: Map<GamePhase, FSMState>;
  private context: FSMContext;
  private game: Game;
  
  constructor(game: Game) {
    this.game = game;
    this.states = new Map();
    this.context = {
      currentState: new SetupState(),
      stateHistory: [],
      eventQueue: [],
      timers: new Map(),
      subscriptions: new Map(),
    };
    
    this.initializeStates();
  }
  
  private initializeStates(): void {
    this.states.set('SETUP', new SetupState());
    this.states.set('NIGHT_ACTIONS', new NightActionsState());
    this.states.set('MORNING_REVEAL', new MorningRevealState());
    this.states.set('DAY_DISCUSSION', new DayDiscussionState());
    this.states.set('DAY_VOTING', new DayVotingState());
    this.states.set('RESOLUTION', new ResolutionState());
    this.states.set('GAME_OVER', new GameOverState());
    
    // Initialize in SETUP state
    this.context.currentState = this.states.get('SETUP')!;
  }
  
  public getCurrentState(): GamePhase {
    return this.game.currentState.phase;
  }
  
  public getCurrentStateName(): string {
    return this.context.currentState.getName();
  }
  
  public transitionTo(phase: GamePhase, event?: GameEvent): void {
    const newState = this.states.get(phase);
    if (!newState) {
      throw new Error(`Invalid state: ${phase}`);
    }
    
    // Exit current state
    this.context.currentState.exit(this.game);
    
    // Record state history
    this.context.stateHistory.push(this.game.currentState.phase);
    
    // Update game state
    this.game.currentState.phase = phase;
    
    // Enter new state
    this.context.currentState = newState;
    this.context.currentState.enter(this.game);
    
    // Emit state change event if event provided
    if (event) {
      this.emit('stateChange', event);
    }
  }
  
  public update(deltaTime: number): void {
    this.context.currentState.update(this.game, deltaTime);
    
    // Update timers
    for (const [timerId, timeRemaining] of this.context.timers) {
      const newTime = timeRemaining - deltaTime;
      if (newTime <= 0) {
        this.context.timers.delete(timerId);
        this.emit('timerExpired', { timerId });
      } else {
        this.context.timers.set(timerId, newTime);
      }
    }
  }
  
  public handleEvent(event: GameEvent): void {
    // Queue admin events
    if (event.visibility === 'ADMIN') {
      this.context.eventQueue.push(event);
      return;
    }
    
    // Handle event in current state
    this.context.currentState.handleEvent(this.game, event);
    
    // Emit to subscribers
    this.emit(event.type, event);
  }
  
  public setTimer(timerId: string, duration: number): void {
    this.context.timers.set(timerId, duration);
  }
  
  public getTimer(timerId: string): number | undefined {
    return this.context.timers.get(timerId);
  }
  
  public clearTimer(timerId: string): void {
    this.context.timers.delete(timerId);
  }
  
  public subscribe(eventType: string, callback: (event: GameEvent) => void): () => void {
    if (!this.context.subscriptions.has(eventType)) {
      this.context.subscriptions.set(eventType, new Set());
    }
    this.context.subscriptions.get(eventType)!.add(callback);
    
    return () => {
      this.context.subscriptions.get(eventType)?.delete(callback);
    };
  }
  
  private emit(eventType: string, data: unknown): void {
    this.context.subscriptions.get(eventType)?.forEach(callback => {
      try {
        callback(data as GameEvent);
      } catch (error) {
        console.error(`Error in subscription callback for ${eventType}:`, error);
      }
    });
  }
  
  public getStateHistory(): string[] {
    return [...this.context.stateHistory];
  }
  
  public getPendingEvents(): GameEvent[] {
    return [...this.context.eventQueue];
  }
  
  public processPendingEvents(): void {
    const events = [...this.context.eventQueue];
    this.context.eventQueue = [];
    
    events.forEach(event => {
      this.handleEvent(event);
    });
  }
}

// Individual State Implementations

class SetupState implements FSMState {
  getName(): string {
    return 'SETUP';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'SETUP';
    game.status = 'SETUP';
    console.log('[FSM] Entering SETUP state');
  }
  
  exit(game: Game): void {
    console.log('[FSM] Exiting SETUP state');
  }
  
  update(game: Game, deltaTime: number): void {
    // Check if we can start the game
    const alivePlayers = game.players.filter(p => p.isAlive);
    if (alivePlayers.length >= game.config.minPlayers && game.status === 'SETUP') {
      // Check if all players are ready
      const allReady = alivePlayers.every(p => p.role !== 'UNASSIGNED');
      if (allReady) {
        // Transition to NIGHT_ACTIONS
        // This will be triggered by explicit start game command
      }
    }
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    switch (event.type) {
      case 'PLAYER_JOINED':
        this.handlePlayerJoined(game, event);
        break;
      case 'PLAYER_LEFT':
        this.handlePlayerLeft(game, event);
        break;
      case 'ROLES_ASSIGNED':
        this.handleRolesAssigned(game, event);
        break;
      case 'GAME_STARTED':
        this.handleGameStarted(game, event);
        break;
    }
  }
  
  private handlePlayerJoined(game: Game, event: GameEvent): void {
    game.players.push({
      id: event.actorId!,
      name: (event.data as { name: string }).name,
      role: 'UNASSIGNED',
      isAlive: true,
      isMafia: false,
      joinOrder: game.players.length,
    });
  }
  
  private handlePlayerLeft(game: Game, event: GameEvent): void {
    game.players = game.players.filter(p => p.id !== event.actorId);
  }
  
  private handleRolesAssigned(game: Game, event: GameEvent): void {
    const assignments = (event.data as { assignments: { playerId: string; role: RoleType }[] }).assignments;
    
    assignments.forEach(assignment => {
      const player = game.players.find(p => p.id === assignment.playerId);
      if (player) {
        player.role = assignment.role;
        player.isMafia = assignment.role === 'MAFIA';
      }
    });
  }
  
  private handleGameStarted(game: Game, event: GameEvent): void {
    game.startedAt = new Date();
    game.status = 'IN_PROGRESS';
    game.currentState.dayNumber = 1;
    game.currentState.turnNumber = 1;
    game.currentState.activePlayers = game.players.filter(p => p.isAlive).map(p => p.id);
    
    // Transition to NIGHT_ACTIONS
    // This will be done by the game engine
  }
}

class NightActionsState implements FSMState {
  private actionTimeout?: ReturnType<typeof setTimeout>;
  
  getName(): string {
    return 'NIGHT_ACTIONS';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'NIGHT_ACTIONS';
    game.currentState.timeRemaining = game.config.nightPhaseDuration;
    game.currentState.nightActions = [];
    
    // Reset night actions for all players
    game.players.forEach(player => {
      player.isMafia = player.role === 'MAFIA'; // Reset mafia flag for current night
    });
    
    console.log(`[FSM] Entering NIGHT_ACTIONS (Day ${game.currentState.dayNumber})`);
    
    // Set timeout for night phase
    this.actionTimeout = setTimeout(() => {
      this.handleTimeout(game);
    }, game.config.nightPhaseDuration * 1000);
  }
  
  exit(game: Game): void {
    if (this.actionTimeout) {
      clearTimeout(this.actionTimeout);
    }
  }
  
  update(game: Game, deltaTime: number): void {
    game.currentState.timeRemaining -= deltaTime;
    
    // Check if all night actions are submitted
    const requiredActions = this.getRequiredNightActions(game);
    const submittedActions = game.currentState.nightActions.length;
    
    if (submittedActions >= requiredActions.length) {
      // All actions submitted, proceed to morning reveal
      this.transitionToMorningReveal(game);
    }
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    switch (event.type) {
      case 'NIGHT_ACTION_SUBMITTED':
        this.handleNightActionSubmitted(game, event);
        break;
      case 'MAFIA_KILL_ATTEMPTED':
        this.handleMafiaKillAttempted(game, event);
        break;
      case 'SHERIFF_INVESTIGATION_SUBMITTED':
        this.handleSheriffInvestigation(game, event);
        break;
      case 'DOCTOR_PROTECTION_SUBMITTED':
        this.handleDoctorProtection(game, event);
        break;
      case 'VIGILANTE_SHOT_SUBMITTED':
        this.handleVigilanteShot(game, event);
        break;
    }
  }
  
  private getRequiredNightActions(game: Game): string[] {
    const actions: string[] = [];
    
    game.players
      .filter(p => p.isAlive)
      .forEach(player => {
        if (player.role === 'MAFIA') {
          // Mafia needs to coordinate on one kill
          if (!actions.includes('MAFIA_KILL')) {
            actions.push('MAFIA_KILL');
          }
        } else if (player.role === 'DOCTOR') {
          actions.push('DOCTOR_PROTECT');
        } else if (player.role === 'SHERIFF') {
          actions.push('SHERIFF_INVESTIGATE');
        } else if (player.role === 'VIGILANTE') {
          const shotsRemaining = this.getShotsRemaining(game, player.id);
          if (shotsRemaining > 0) {
            actions.push('VIGILANTE_SHOOT');
          }
        }
      });
    
    return actions;
  }
  
  private getShotsRemaining(game: Game, vigilanteId: string): number {
    const vigilante = game.players.find(p => p.id === vigilanteId);
    if (!vigilante || vigilante.role !== 'VIGILANTE') {
      return 0;
    }
    
    // Count previous vigilante shots
    const previousShots = game.events.filter(
      e => e.type === 'VIGILANTE_SHOT_FIRED' && 
           (e.data as { vigilanteId: string }).vigilanteId === vigilanteId
    ).length;
    
    return 1 - previousShots; // One shot total
  }
  
  private handleNightActionSubmitted(game: Game, event: GameEvent): void {
    const data = event.data as {
      actorId: string;
      action: string;
      targetId: string;
    };
    
    game.currentState.nightActions.push({
      actorId: data.actorId,
      action: data.action as NightAction['action'],
      targetId: data.targetId,
      timestamp: event.timestamp,
      nightNumber: game.currentState.dayNumber,
    });
  }
  
  private handleMafiaKillAttempted(game: Game, event: GameEvent): void {
    // Mafia coordination is handled by the agent system
    // This event is logged for tracking
    console.log(`[FSM] Mafia kill attempted by ${event.actorId} targeting ${event.targetId}`);
  }
  
  private handleSheriffInvestigation(game: Game, event: GameEvent): void {
    // Sheriff investigation is handled by the agent system
    // Result will be determined during morning reveal
    console.log(`[FSM] Sheriff investigation by ${event.actorId} targeting ${event.targetId}`);
  }
  
  private handleDoctorProtection(game: Game, event: GameEvent): void {
    console.log(`[FSM] Doctor protection by ${event.actorId} targeting ${event.targetId}`);
  }
  
  private handleVigilanteShot(game: Game, event: GameEvent): void {
    console.log(`[FSM] Vigilante shot by ${event.actorId} targeting ${event.targetId}`);
  }
  
  private handleTimeout(game: Game): void {
    // Force transition to morning reveal with whatever actions have been submitted
    this.transitionToMorningReveal(game);
  }
  
  private transitionToMorningReveal(game: Game): void {
    // Process all night actions and create reveal events
    this.processNightActions(game);
    
    // Transition to MORNING_REVEAL
    game.currentState.phase = 'MORNING_REVEAL';
  }
  
  private processNightActions(game: Game): void {
    // Process mafia kill
    const mafiaKill = game.currentState.nightActions.find(
      a => a.action === 'MAFIA_KILL'
    );
    
    if (mafiaKill) {
      // Determine if kill is successful
      const target = game.players.find(p => p.id === mafiaKill.targetId);
      const doctorProtect = game.currentState.nightActions.find(
        a => a.action === 'DOCTOR_PROTECT' && a.targetId === mafiaKill.targetId
      );
      
      if (target && !doctorProtect) {
        // Kill successful
        target.isAlive = false;
        game.currentState.eliminatedPlayers.push(target.id);
      }
    }
    
    // Process vigilante shot
    const vigilanteShot = game.currentState.nightActions.find(
      a => a.action === 'VIGILANTE_SHOOT'
    );
    
    if (vigilanteShot) {
      const target = game.players.find(p => p.id === vigilanteShot.targetId);
      if (target) {
        target.isAlive = false;
        game.currentState.eliminatedPlayers.push(target.id);
      }
    }
    
    // Update active players
    game.currentState.activePlayers = game.players
      .filter(p => p.isAlive)
      .map(p => p.id);
  }
}

class MorningRevealState implements FSMState {
  getName(): string {
    return 'MORNING_REVEAL';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'MORNING_REVEAL';
    console.log(`[FSM] Entering MORNING_REVEAL (Day ${game.currentState.dayNumber})`);
    
    // Process night actions and generate reveal events
    this.processNightReveals(game);
  }
  
  exit(game: Game): void {
    console.log('[FSM] Exiting MORNING_REVEAL state');
  }
  
  update(game: Game, deltaTime: number): void {
    // Stay in this state briefly to show night results
    // Then automatically transition to DAY_DISCUSSION
    setTimeout(() => {
      game.currentState.phase = 'DAY_DISCUSSION';
    }, 3000); // 3 second reveal
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    // No specific event handling in this state
  }
  
  private processNightReveals(game: Game): void {
    // Check for deaths
    const deaths = game.currentState.eliminatedPlayers.filter(
      id => !game.events.some(
        e => e.type === 'PLAYER_KILLED' && e.targetId === id
      )
    );
    
    deaths.forEach(playerId => {
      const player = game.players.find(p => p.id === playerId);
      if (player) {
        // Create death events
        console.log(`[FSM] ${player.name} was killed at night`);
      }
    });
    
    // Check for sheriff investigation results
    const sheriffInvestigation = game.currentState.nightActions.find(
      a => a.action === 'SHERIFF_INVESTIGATE'
    );
    
    if (sheriffInvestigation) {
      const target = game.players.find(p => p.id === sheriffInvestigation.targetId);
      if (target) {
        // Sheriff learns target's alignment
        console.log(`[FSM] Sheriff investigated ${target.name}: ${target.isMafia ? 'MAFIA' : 'NOT MAFIA'}`);
      }
    }
  }
}

class DayDiscussionState implements FSMState {
  private discussionTimeout?: ReturnType<typeof setTimeout>;
  
  getName(): string {
    return 'DAY_DISCUSSION';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'DAY_DISCUSSION';
    game.currentState.timeRemaining = game.config.dayPhaseDuration;
    game.currentState.votes = [];
    
    console.log(`[FSM] Entering DAY_DISCUSSION (Day ${game.currentState.dayNumber})`);
    
    // Set timeout for discussion phase
    this.discussionTimeout = setTimeout(() => {
      this.handleTimeout(game);
    }, game.config.dayPhaseDuration * 1000);
  }
  
  exit(game: Game): void {
    if (this.discussionTimeout) {
      clearTimeout(this.discussionTimeout);
    }
  }
  
  update(game: Game, deltaTime: number): void {
    game.currentState.timeRemaining -= deltaTime;
    
    // Check if voting should start early (all players have spoken)
    const activePlayers = game.currentState.activePlayers;
    if (activePlayers.length === 0) {
      this.transitionToVoting(game);
    }
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    switch (event.type) {
      case 'ACCUSATION_MADE':
        this.handleAccusation(game, event);
        break;
      case 'VOTE_CAST':
        this.handleVoteCast(game, event);
        break;
      case 'ROLE_CLAIMED':
        this.handleRoleClaimed(game, event);
        break;
      case 'PLAYER_ELIMINATED':
        this.handlePlayerEliminated(game, event);
        break;
    }
  }
  
  private handleAccusation(game: Game, event: GameEvent): void {
    // Record accusation for game history
    console.log(`[FSM] ${event.actorId} accused ${event.targetId}`);
  }
  
  private handleVoteCast(game: Game, event: GameEvent): void {
    // Record vote (preliminary, not final)
    const data = event.data as { voterId: string; targetId: string };
    game.currentState.votes.push({
      voterId: data.voterId,
      targetId: data.targetId,
      timestamp: event.timestamp,
      phase: 'DAY_DISCUSSION',
      dayNumber: game.currentState.dayNumber,
    });
  }
  
  private handleRoleClaimed(game: Game, event: GameEvent): void {
    console.log(`[FSM] ${event.actorId} claimed ${(event.data as { role: RoleType }).role}`);
  }
  
  private handlePlayerEliminated(game: Game, event: GameEvent): void {
    game.currentState.activePlayers = game.currentState.activePlayers.filter(
      id => id !== event.targetId
    );
    game.currentState.eliminatedPlayers.push(event.targetId!);
  }
  
  private handleTimeout(game: Game): void {
    this.transitionToVoting(game);
  }
  
  private transitionToVoting(game: Game): void {
    game.currentState.phase = 'DAY_VOTING';
  }
}

class DayVotingState implements FSMState {
  private votingTimeout?: ReturnType<typeof setTimeout>;
  
  getName(): string {
    return 'DAY_VOTING';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'DAY_VOTING';
    game.currentState.timeRemaining = game.config.votingDuration;
    game.currentState.votes = [];
    
    console.log(`[FSM] Entering DAY_VOTING (Day ${game.currentState.dayNumber})`);
    
    // Set timeout for voting phase
    this.votingTimeout = setTimeout(() => {
      this.handleTimeout(game);
    }, game.config.votingDuration * 1000);
  }
  
  exit(game: Game): void {
    if (this.votingTimeout) {
      clearTimeout(this.votingTimeout);
    }
  }
  
  update(game: Game, deltaTime: number): void {
    game.currentState.timeRemaining -= deltaTime;
    
    // Check if all votes are in
    const activePlayers = game.currentState.activePlayers;
    const votesReceived = game.currentState.votes.length;
    
    if (votesReceived >= activePlayers.length) {
      // All votes received, process results
      this.processVotingResults(game);
    }
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    switch (event.type) {
      case 'VOTE_CAST':
        this.handleVoteCast(game, event);
        break;
    }
  }
  
  private handleVoteCast(game: Game, event: GameEvent): void {
    const data = event.data as { voterId: string; targetId: string };
    
    // Remove previous vote from this voter if exists
    game.currentState.votes = game.currentState.votes.filter(
      v => v.voterId !== data.voterId
    );
    
    // Add new vote
    game.currentState.votes.push({
      voterId: data.voterId,
      targetId: data.targetId,
      timestamp: event.timestamp,
      phase: 'DAY_VOTING',
      dayNumber: game.currentState.dayNumber,
    });
  }
  
  private processVotingResults(game: Game): void {
    // Count votes
    const voteCounts = new Map<string, number>();
    
    game.currentState.votes.forEach(vote => {
      const count = voteCounts.get(vote.targetId) || 0;
      voteCounts.set(vote.targetId, count + 1);
    });
    
    // Find target with most votes
    let maxVotes = 0;
    let targets: string[] = [];
    
    voteCounts.forEach((count, targetId) => {
      if (count > maxVotes) {
        maxVotes = count;
        targets = [targetId];
      } else if (count === maxVotes) {
        targets.push(targetId);
      }
    });
    
    if (targets.length === 1) {
      // Single target with most votes
      this.lynchPlayer(game, targets[0], maxVotes);
    } else {
      // Tie - use tie breaker
      this.handleTie(game, targets, maxVotes);
    }
  }
  
  private lynchPlayer(game: Game, playerId: string, votes: number): void {
    const player = game.players.find(p => p.id === playerId);
    if (player) {
      player.isAlive = false;
      game.currentState.eliminatedPlayers.push(playerId);
      game.currentState.activePlayers = game.currentState.activePlayers.filter(
        id => id !== playerId
      );
      
      console.log(`[FSM] ${player.name} was lynched with ${votes} votes`);
      
      // Check for game over conditions
      if (this.checkGameOver(game)) {
        game.currentState.phase = 'GAME_OVER';
        return;
      }
    }
    
    // Transition to next night
    game.currentState.dayNumber++;
    game.currentState.turnNumber++;
    game.currentState.phase = 'NIGHT_ACTIONS';
  }
  
  private handleTie(game: Game, targets: string[], votes: number): void {
    // Use configured tie breaker
    switch (game.config.tieBreaker) {
      case 'RANDOM':
        const randomIndex = Math.floor(Math.random() * targets.length);
        this.lynchPlayer(game, targets[randomIndex], votes);
        break;
      case 'FIRST':
        this.lynchPlayer(game, targets[0], votes);
        break;
      case 'LAST':
        this.lynchPlayer(game, targets[targets.length - 1], votes);
        break;
      case 'SKIP':
        // Skip lynching this round
        console.log('[FSM] Voting resulted in tie - lynching skipped');
        game.currentState.dayNumber++;
        game.currentState.phase = 'NIGHT_ACTIONS';
        break;
    }
  }
  
  private checkGameOver(game: Game): boolean {
    const alivePlayers = game.players.filter(p => p.isAlive);
    const mafiaAlive = alivePlayers.filter(p => p.role === 'MAFIA').length;
    const townAlive = alivePlayers.filter(p => p.role !== 'MAFIA').length;
    
    // Mafia wins if they equal or outnumber town
    if (mafiaAlive >= townAlive) {
      console.log('[FSM] Mafia wins!');
      return true;
    }
    
    // Town wins if all mafia are dead
    if (mafiaAlive === 0) {
      console.log('[FSM] Town wins!');
      return true;
    }
    
    return false;
  }
  
  private handleTimeout(game: Game): void {
    this.processVotingResults(game);
  }
}

class ResolutionState implements FSMState {
  getName(): string {
    return 'RESOLUTION';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'RESOLUTION';
    console.log('[FSM] Entering RESOLUTION state');
  }
  
  exit(game: Game): void {
    console.log('[FSM] Exiting RESOLUTION state');
  }
  
  update(game: Game, deltaTime: number): void {
    // Auto-transition to game over
    setTimeout(() => {
      game.currentState.phase = 'GAME_OVER';
    }, 1000);
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    // No specific event handling
  }
}

class GameOverState implements FSMState {
  getName(): string {
    return 'GAME_OVER';
  }
  
  enter(game: Game): void {
    game.currentState.phase = 'GAME_OVER';
    game.status = 'ENDED';
    game.endedAt = new Date();
    
    console.log('[FSM] Entering GAME_OVER state');
    
    // Calculate final results
    this.calculateGameResults(game);
  }
  
  exit(game: Game): void {
    console.log('[FSM] Exiting GAME_OVER state');
  }
  
  update(game: Game, deltaTime: number): void {
    // No updates in game over state
  }
  
  handleEvent(game: Game, event: GameEvent): void {
    // No event handling in game over
  }
  
  private calculateGameResults(game: Game): void {
    const alivePlayers = game.players.filter(p => p.isAlive);
    const mafiaAlive = alivePlayers.filter(p => p.role === 'MAFIA').length;
    
    // Determine winner
    const winner = mafiaAlive > 0 ? 'MAFIA' : 'TOWN';
    
    console.log(`[FSM] Game ended. Winner: ${winner}`);
    
    // Log final statistics
    console.log(`[FSM] Final Statistics:`);
    console.log(`  - Duration: ${game.endedAt!.getTime() - game.startedAt!.getTime()}ms`);
    console.log(`  - Total Turns: ${game.currentState.turnNumber}`);
    console.log(`  - Final Day: ${game.currentState.dayNumber}`);
    console.log(`  - Players: ${game.players.length}`);
    console.log(`  - Survivors: ${alivePlayers.length}`);
  }
}

// Export state machine factory
export function createGameFSM(game: Game): GameFSM {
  return new GameFSM(game);
}
