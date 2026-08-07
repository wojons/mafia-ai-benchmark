/**
 * Mafia CLI — shared server URL configuration.
 *
 * Single source of truth for the compose API/WS endpoints. The real mafia
 * server is exposed on host port :3004 (see docker-compose.yml — API :3004,
 * WS /ws). Port :3000 is shadowed on this host by the DuckBrain HTTP daemon,
 * so it must never be the CLI default.
 */

export const DEFAULT_SERVER_URL = 'http://localhost:3004';
export const DEFAULT_WS_URL = 'ws://localhost:3004/ws';

/**
 * Resolve the HTTP server base URL for API commands.
 * Precedence: explicit --server flag > MAFIA_SERVER_URL env > DEFAULT_SERVER_URL.
 */
export function resolveServerUrl(cliServer?: string): string {
  return cliServer || process.env.MAFIA_SERVER_URL || DEFAULT_SERVER_URL;
}

/**
 * Convert an HTTP(S) base URL to its WebSocket endpoint.
 * ws:// and wss:// URLs pass through untouched; https:// maps to wss://.
 */
export function toWsUrl(raw: string): string {
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
    return raw;
  }
  const scheme = raw.startsWith('https://') ? 'wss://' : 'ws://';
  const rest = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `${scheme}${rest}/ws`;
}

/**
 * Resolve the WebSocket URL for watch-game.
 * Precedence: explicit --server flag (ws:// used verbatim, http(s)://
 * converted) > MAFIA_SERVER_URL (converted) > DEFAULT_WS_URL.
 */
export function resolveWsUrl(cliServer?: string): string {
  return toWsUrl(cliServer || process.env.MAFIA_SERVER_URL || DEFAULT_WS_URL);
}
