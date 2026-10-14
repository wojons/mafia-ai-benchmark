const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:3004/ws';

// DF-MAFIA-AI-BENCHMARK-31: idle window for the connection watchdog. A live
// game emits events every few seconds; 45s of total inbound silence means the
// socket is effectively dead even if readyState still says OPEN (the blank
// watch view failure mode).
const WATCHDOG_IDLE_MS = 45_000;

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
  // DF-MAFIA-AI-BENCHMARK-31 watchdog: tracks inbound activity and tears the
  // socket down + reconnects when nothing arrives for WATCHDOG_IDLE_MS. A
  // half-open socket (readyState OPEN, no frames — NAT drop, dead upstream)
  // never fires onclose, so without this the UI silently freezes.
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogFired: boolean = false;
  /** Idle window before the socket is judged dead (test-seam overridable). */
  private watchdogIdleMs: number = WATCHDOG_IDLE_MS;
  /** Socket factory seam so tests inject a fake WebSocket transport. */
  private createSocket: (url: string) => WebSocket;

  constructor(
    url: string = WS_BASE,
    opts?: { wsFactory?: (url: string) => WebSocket; watchdogIdleMs?: number },
  ) {
    this.url = url;
    this.handlers = new Map();
    if (opts?.watchdogIdleMs !== undefined) this.watchdogIdleMs = opts.watchdogIdleMs;
    this.createSocket = opts?.wsFactory ?? defaultWebsocketFactory;
  }

  /**
   * Arm/reset the idle watchdog. Called from onopen and every onmessage —
   * so any inbound frame (state update, PONG, event) keeps the connection
   * alive. On expiry: emit STALE_CONNECTION, close the dead socket, and
   * reconnect (the onclose path also re-arms via reconnect attempts).
   */
  private armWatchdog(): void {
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);
    if (this.watchdogFired) {
      // One STALE_CONNECTION per dead-socket episode: re-arming after a fire
      // must not re-announce an already-announced staleness on the next frame.
      this.watchdogFired = false;
      this.emit('RECONNECTING', { reason: 'stale-connection-recovered' });
    }
    this.watchdogTimer = setTimeout(() => {
      this.watchdogFired = true;
      this.emit('STALE_CONNECTION', {
        idleMs: this.watchdogIdleMs,
        readyState: this.ws?.readyState,
      });
      // Force the dead/half-open socket closed; the onclose handler performs
      // the actual reconnect. If close() does not trigger onclose (kernel
      // socket already gone), schedule the reconnect directly.
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          /* already closing/closed */
        }
      }
      if (this.connected) {
        // onclose did not fire from our close() (e.g. fire-and-forget socket
        // already dead without an event) — reconnect inline.
        this.connected = false;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          setTimeout(() => this.connect(), delay);
        }
      }
    }, this.watchdogIdleMs);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = this.createSocket(this.url);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          // DF-MAFIA-AI-BENCHMARK-31: arm the idle watchdog on every open.
          this.armWatchdog();

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
          // Any inbound frame proves the socket is alive — restart the idle
          // window (DF-MAFIA-AI-BENCHMARK-31).
          this.armWatchdog();
          try {
            const message = JSON.parse(event.data) as WSMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          this.connected = false;
          if (this.watchdogTimer !== null) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
          }
          this.emit('DISCONNECTED', { code: event.code, reason: event.reason });

          // Attempt to reconnect
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.emit('RECONNECTING', {
              attempt: this.reconnectAttempts,
              maxAttempts: this.maxReconnectAttempts,
              delayMs: delay,
            });
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
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.watchdogFired = false;
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
    const { type, payload } = message;
    
    // Emit to specific handlers
    this.emit(type, payload);
    
    // Also emit generic events
    if (type.includes('_')) {
      const category = type.split('_')[0];
      this.emit(category, message);
    }
  }
  
  /**
   * Public emit surface: production code only consumes `on`, but the
   * watchdog hook tests drive the singleton's event bus directly (the same
   * dispatch path the internal watchdog/reconnect machinery uses).
   */
  emit(eventType: string, data: unknown): void {
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
  // gameId is the real per-game channel (JOIN_GAME registration). A plain
  // SUBSCRIBE {gameId} used to ack while registering nothing (silent no-op
  // trap, DF-MAFIA-AI-BENCHMARK-19) — route it through JOIN_GAME instead.
  subscribe(eventTypes: string[], gameId?: string): void {
    if (gameId) {
      this.joinGame(gameId);
      return;
    }
    this.send({
      type: 'SUBSCRIBE',
      payload: { eventTypes },
    });
  }

  joinGame(gameId: string): void {
    this.send({
      type: 'JOIN_GAME',
      payload: { gameId },
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

/** Production socket constructor (test seam: WebSocketService opts.wsFactory). */
export const defaultWebsocketFactory = (url: string): WebSocket => new WebSocket(url);

// Export singleton instance
export const websocket = new WebSocketService();

export { WebSocketService };

export default websocket;
