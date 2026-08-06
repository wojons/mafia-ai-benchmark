/**
 * Type declarations for response-parser.js (CommonJS module).
 * Kept in sync with the implementation in response-parser.js.
 */

export interface ParsedAgentResponse {
  think: string;
  says: string;
  action: { target?: string; [key: string]: unknown } | null;
  format: 'json' | 'markers' | 'plain' | 'fallback';
}

export interface SayQualityGate {
  /**
   * Validate and record a player's statement.
   * @returns the statement to broadcast, or null when it must be dropped
   *   (empty, placeholder, consecutive duplicate, or 3rd+ exact repeat).
   */
  check(playerId: string, says: string): string | null;
  /** Clear per-player state (e.g. between games). */
  reset(): void;
}

/** Parse raw LLM output into think/says/action. Says is never filler. */
export declare function parseAgentResponse(text: string): ParsedAgentResponse;

/** Create a per-game quality gate with isolated per-player state. */
export declare function createSayQualityGate(): SayQualityGate;

/** Trim/normalize whitespace of a raw string. */
export declare function clean(text: string): string;
