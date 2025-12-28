/**
 * WebSocket Handler
 * 
 * Real-time game updates via WebSocket connections.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { ServerContext } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

interface WSClient {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
  userId?: string;
  gameId?: string;
}

interface WSMessage {
  type: string;
  payload: Record<string, unknown>;
  requestId?: string;
}

interface WSBroadcastOptions {
  gameId?: string;
  visibility?: 'PUBLIC' | 'PRIVATE' | 'ADMIN';
  excludeClientId?: string;
}

export class WebSocketHandler {
  private wss: WebSocketServer;
  private context: ServerContext;
  private clients: Map<string, WSClient>;
  private clientByWs: Map<WebSocket, string>;
  
  constructor(wss: WebSocketServer, context: ServerContext) {
    this.wss = wss;
    this.context = context;
    this.clients = new Map();
    this.clientByWs = new Map();
    
    this.setupServer();
  }
  
  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });
    
    console.log('✅ WebSocket server initialized');
  }
  
  private handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();
    const client: WSClient = {
      id: clientId,
      ws,
      subscriptions: new Set(),
    };
    
    this.clients.set(clientId, client);
    this.clientByWs.set(ws, clientId);
    
    console.log(`[WebSocket] Client connected: ${clientId}`);
    
    // Send connection confirmation
    this.sendToClient(clientId, {
      type: 'CONNECTED',
      payload: { clientId },
    });
    
    // Handle messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        this.handleMessage(clientId, message);
      } catch (error) {
        console.error('[WebSocket] Invalid message:', error);
        this.sendToClient(clientId, {
          type: 'ERROR',
          payload: { message: 'Invalid message format' },
        });
      }
    });
    
    // Handle close
    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WebSocket] Client ${clientId} error:`, error);
    });
  }
  
  private handleMessage(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    switch (message.type) {
      case 'PING':
        this.sendToClient(clientId, { type: 'PONG', payload: {} });
        break;
        
      case 'SUBSCRIBE':
        this.handleSubscribe(clientId, message.payload);
        break;
        
      case 'UNSUBSCRIBE':
        this.handleUnsubscribe(clientId, message.payload);
        break;
        
      case 'JOIN_GAME':
        this.handleJoinGame(clientId, message.payload);
        break;
        
      case 'LEAVE_GAME':
        this.handleLeaveGame(clientId);
        break;
        
      case 'SEND_ACTION':
        this.handleSendAction(clientId, message.payload);
        break;
        
      case 'REQUEST_STATE':
        this.handleRequestState(clientId, message.payload);
        break;
        
      default:
        this.sendToClient(clientId, {
          type: 'ERROR',
          payload: { message: `Unknown message type: ${message.type}` },
        });
    }
  }
  
  private handleSubscribe(clientId: string, payload: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const eventTypes = payload.eventTypes as string[];
    if (Array.isArray(eventTypes)) {
      eventTypes.forEach(type => {
        client.subscriptions.add(type);
      });
    }
    
    this.sendToClient(clientId, {
      type: 'SUBSCRIBED',
      payload: { eventTypes },
    });
  }
  
  private handleUnsubscribe(clientId: string, payload: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const eventTypes = payload.eventTypes as string[];
    if (Array.isArray(eventTypes)) {
      eventTypes.forEach(type => {
        client.subscriptions.delete(type);
      });
    }
    
    this.sendToClient(clientId, {
      type: 'UNSUBSCRIBED',
      payload: { eventTypes },
    });
  }
  
  private handleJoinGame(clientId: string, payload: Record<string, unknown>): void {
    const gameId = payload.gameId as string;
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.gameId = gameId;
    client.subscriptions.add(`game:${gameId}`);
    
    // Subscribe to game-specific events
    this.context.eventBus.subscribe(
      `game:${gameId}`,
      (event) => {
        // Filter by visibility if needed
        this.broadcastToGame(gameId, event, { excludeClientId: clientId });
      }
    );
    
    this.sendToClient(clientId, {
      type: 'GAME_JOINED',
      payload: { gameId },
    });
    
    // Send current game state
    const state = this.context.gameEngine.getGameState(gameId);
    if (state) {
      this.sendToClient(clientId, {
        type: 'GAME_STATE',
        payload: { state },
      });
    }
  }
  
  private handleLeaveGame(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    if (client.gameId) {
      client.subscriptions.delete(`game:${client.gameId}`);
      client.gameId = undefined;
    }
    
    this.sendToClient(clientId, {
      type: 'GAME_LEFT',
      payload: {},
    });
  }
  
  private handleSendAction(clientId: string, payload: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client || !client.gameId) {
      this.sendToClient(clientId, {
        type: 'ERROR',
        payload: { message: 'Not in a game' },
      });
      return;
    }
    
    const { actionType, targetId, ...rest } = payload;
    
    try {
      switch (actionType) {
        case 'VOTE':
          this.context.gameEngine.submitVote(
            client.gameId,
            rest.voterId as string,
            targetId as string
          );
          break;
          
        case 'NIGHT_ACTION':
          this.context.gameEngine.submitNightAction(
            client.gameId,
            rest.playerId as string,
            rest.action as string,
            targetId as string
          );
          break;
          
        case 'ACCUSATION':
          this.context.gameEngine.makeAccusation(
            client.gameId,
            rest.accuserId as string,
            targetId as string,
            rest.accusation as string,
            rest.evidence as string
          );
          break;
          
        case 'ROLE_CLAIM':
          this.context.gameEngine.claimRole(
            client.gameId,
            rest.playerId as string,
            rest.role as 'MAFIA' | 'DOCTOR' | 'SHERIFF' | 'VIGILANTE' | 'VILLAGER'
          );
          break;
      }
      
      this.sendToClient(clientId, {
        type: 'ACTION_SENT',
        payload: { actionType, targetId },
      });
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'ERROR',
        payload: { message: 'Failed to send action' },
      });
    }
  }
  
  private handleRequestState(clientId: string, payload: Record<string, unknown>): void {
    const gameId = payload.gameId as string;
    const state = this.context.gameEngine.getGameState(gameId);
    
    if (state) {
      this.sendToClient(clientId, {
        type: 'GAME_STATE',
        payload: { state },
      });
    } else {
      this.sendToClient(clientId, {
        type: 'ERROR',
        payload: { message: 'Game not found' },
      });
    }
  }
  
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    if (client.gameId) {
      client.subscriptions.delete(`game:${client.gameId}`);
    }
    
    this.clients.delete(clientId);
    this.clientByWs.delete(client.ws);
    
    console.log(`[WebSocket] Client disconnected: ${clientId}`);
  }
  
  private sendToClient(clientId: string, message: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;
    
    client.ws.send(JSON.stringify({
      ...message,
      timestamp: new Date().toISOString(),
      requestId: (message as WSMessage).requestId,
    }));
  }
  
  broadcastToGame(gameId: string, event: Record<string, unknown>, options?: WSBroadcastOptions): void {
    this.clients.forEach((client) => {
      if (options?.excludeClientId && client.id === options.excludeClientId) {
        return;
      }
      
      if (client.gameId === gameId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'GAME_EVENT',
          payload: event,
          timestamp: new Date().toISOString(),
        }));
      }
    });
  }
  
  broadcastToAll(event: Record<string, unknown>): void {
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'BROADCAST',
          payload: event,
          timestamp: new Date().toISOString(),
        }));
      }
    });
  }
  
  getConnectedClients(): number {
    return this.clients.size;
  }
  
  getClientsInGame(gameId: string): string[] {
    const clients: string[] = [];
    this.clients.forEach((client) => {
      if (client.gameId === gameId) {
        clients.push(client.id);
      }
    });
    return clients;
  }
}

export function setupWebSocket(wss: WebSocketServer, context: ServerContext): WebSocketHandler {
  return new WebSocketHandler(wss, context);
}

export default WebSocketHandler;
