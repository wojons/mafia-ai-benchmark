const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws';

type EventHandler = (data: unknown) => void;

interface WSMessage {
  type: string;
  payload: unknown;
  timestamp?: string;
  requestId?: string;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<EventHandler>>;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private messageQueue: WSMessage[] = [];
  private connected: boolean = false;
  
  constructor(url: string = WS_BASE) {
    this.url = url;
    this.handlers = new Map();
  }
  
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          
          // Send queued messages
          while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            if (message && this.ws) {
              this.ws.send(JSON.stringify(message));
            }
          }
          
          // Emit connected event
          this.emit('CONNECTED', { timestamp: new Date().toISOString() });
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WSMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };
        
        this.ws.onclose = (event) => {
          this.connected = false;
          this.emit('DISCONNECTED', { code: event.code, reason: event.reason });
          
          // Attempt to reconnect
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), delay);
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this.connected = false;
    }
  }
  
  send(message: WSMessage): void {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      this.messageQueue.push(message);
    }
  }
  
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }
  
  off(eventType: string, handler?: EventHandler): void {
    if (handler) {
      this.handlers.get(eventType)?.delete(handler);
    } else {
      this.handlers.delete(eventType);
    }
  }
  
  private handleMessage(message: WSMessage): void {
    const { type, payload, timestamp } = message;
    
    // Emit to specific handlers
    this.emit(type, payload);
    
    // Also emit generic events
    if (type.includes('_')) {
      const category = type.split('_')[0];
      this.emit(category, message);
    }
  }
  
  private emit(eventType: string, data: unknown): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in WebSocket handler for ${eventType}:`, error);
        }
      });
    }
  }
  
  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  
  // Convenience methods for common operations
  subscribe(eventTypes: string[]): void {
    this.send({
      type: 'SUBSCRIBE',
      payload: { eventTypes },
    });
  }
  
  unsubscribe(eventTypes: string[]): void {
    this.send({
      type: 'UNSUBSCRIBE',
      payload: { eventTypes },
    });
  }
  
  ping(): void {
    this.send({ type: 'PING', payload: {} });
  }
}

// Export singleton instance
export const websocket = new WebSocketService();

export default websocket;
