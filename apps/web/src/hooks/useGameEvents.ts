import { useEffect, useRef, useState, useCallback } from 'react';

export interface GameEvent {
  id: string;
  gameId: string;
  type: string;
  timestamp: string;
  visibility: string;
  actorId?: string;
  targetId?: string;
  data: Record<string, unknown>;
  metadata: {
    turnNumber: number;
    dayNumber: number;
    phase: string;
    sequence: number;
  };
}

type EventHandler = (event: GameEvent) => void;

/**
 * Hook to connect to the game WebSocket and receive real-time events.
 * Connects to ws://localhost:3004/ws and parses incoming JSON events.
 * Automatically reconnects on disconnect.
 */
export function useGameEvents(gameId: string | null) {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const eventsRef = useRef<GameEvent[]>([]);

  const addEvent = useCallback((event: GameEvent) => {
    eventsRef.current = [...eventsRef.current, event].slice(-200);
    setEvents([...eventsRef.current]);
  }, []);

  const on = useCallback((eventType: string, handler: EventHandler) => {
    if (!handlersRef.current.has(eventType)) {
      handlersRef.current.set(eventType, new Set());
    }
    handlersRef.current.get(eventType)!.add(handler);
    return () => {
      handlersRef.current.get(eventType)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!gameId) return;

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3004/ws';
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    function connect() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          reconnectAttempts = 0;
          // Join the game room
          ws.send(JSON.stringify({
            type: 'JOIN_GAME',
            payload: { gameId },
          }));
        };

        ws.onmessage = (msgEvent) => {
          try {
            const message = JSON.parse(msgEvent.data);

            // Handle different message types
            if (message.type === 'GAME_EVENT' && message.payload) {
              const event: GameEvent = {
                id: message.payload.id || crypto.randomUUID(),
                gameId: message.payload.gameId || gameId,
                type: message.payload.type || 'UNKNOWN',
                timestamp: message.payload.timestamp || message.timestamp || new Date().toISOString(),
                visibility: message.payload.visibility || 'PUBLIC',
                actorId: message.payload.actorId,
                targetId: message.payload.targetId,
                data: message.payload.data || message.payload,
                metadata: message.payload.metadata || {
                  turnNumber: 0,
                  dayNumber: 0,
                  phase: 'UNKNOWN',
                  sequence: 0,
                },
              };
              addEvent(event);

              // Notify handlers
              const typeHandlers = handlersRef.current.get(event.type);
              if (typeHandlers) {
                typeHandlers.forEach(h => { try { h(event); } catch (e) { /* ignore */ } });
              }
              const allHandlers = handlersRef.current.get('*');
              if (allHandlers) {
                allHandlers.forEach(h => { try { h(event); } catch (e) { /* ignore */ } });
              }
            } else if (message.type === 'CONNECTED') {
              setConnected(true);
            } else if (message.type === 'GAME_STATE') {
              // Could handle game state update here
            }
          } catch (e) {
            console.error('[useGameEvents] Failed to parse message:', e);
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            reconnectTimer = setTimeout(connect, delay);
          }
        };

        ws.onerror = () => {
          // onclose will be triggered after this
        };
      } catch (e) {
        console.error('[useGameEvents] Connection failed:', e);
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts++;
          reconnectTimer = setTimeout(connect, delay);
        }
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [gameId, addEvent]);

  const send = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { events, connected, on, send };
}

export default useGameEvents;
