import { useEffect, useRef, useState } from 'react';
import { websocket } from '../services/websocket';

export interface ConnectionWatchdogState {
  /** No inbound frames for the idle window; socket was judged dead. */
  stale: boolean;
  /** A reconnect attempt is in flight (socket closed or stale recovery). */
  reconnecting: boolean;
  /** Timestamp (epoch ms) of the last observed activity event, if any. */
  lastActivityAt: number | null;
}

/**
 * DF-MAFIA-AI-BENCHMARK-31: surface the WebSocket service's connection
 * watchdog to React.
 *
 * The blank watch view failure was a frozen tree over a half-open socket:
 * readyState OPEN, no inbound frames, onclose never fired. The service layer
 * now detects that (STALE_CONNECTION) and reconnects; this hook makes the
 * recovery VISIBLE — it flips `stale`/`reconnecting` so the watch view can
 * render a reconnecting indicator instead of sitting silent, and invokes
 * `onStale` once per stale episode so the caller can re-fetch game state
 * (a mid-game remount/refetch is what re-opens the silent blank window).
 */
export function useConnectionWatchdog(
  gameId: string | null,
  onStale?: () => void,
): ConnectionWatchdogState {
  const [stale, setStale] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  // onStale must fire ONCE per stale episode (a mid-game re-fetch loop is
  // exactly what we are guarding against).
  const staleEpisodeOpen = useRef(false);
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;

  useEffect(() => {
    if (!gameId) return;

    const unsubs = [
      websocket.on('STALE_CONNECTION', () => {
        // One onStale per stale episode: duplicate announces (or a second
        // registered handler) must not trigger repeated mid-game re-fetches.
        if (staleEpisodeOpen.current) return;
        staleEpisodeOpen.current = true;
        setStale(true);
        setReconnecting(true);
        onStaleRef.current?.();
      }),
      websocket.on('RECONNECTING', () => {
        setReconnecting(true);
      }),
      websocket.on('CONNECTED', () => {
        // A fresh open (watchdog reconnect or manual) ends the stale episode.
        if (staleEpisodeOpen.current) {
          staleEpisodeOpen.current = false;
          setLastActivityAt(Date.now());
        }
        setStale(false);
        setReconnecting(false);
      }),
      websocket.on('DISCONNECTED', () => {
        // Normal close: reconnect machinery takes over — show the indicator
        // so the UI never looks frozen while it runs.
        setReconnecting(true);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [gameId]);

  return { stale, reconnecting, lastActivityAt };
}

export default useConnectionWatchdog;