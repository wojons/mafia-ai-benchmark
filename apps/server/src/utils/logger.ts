/**
 * OBS-005: minimal leveled logger.
 *
 * `.env.sample` has advertised LOG_LEVEL since MAF-GAP, but no code read it:
 * every server log line was an unconditional console.* call, so an operator
 * asking for `LOG_LEVEL=error` still got a request log per request and no way
 * to silence it. This module is the single place that decides, per call,
 * whether a line is emitted. No dependencies, no transports, no formatting
 * machinery — stdout/stderr stay exactly what Docker and journald already read.
 *
 * The level is resolved LAZILY on every call rather than captured at import:
 * `dotenv.config()` runs after module evaluation in index.ts, and a test (or an
 * operator's `LOG_LEVEL=debug node ...`) must be able to change the level
 * without re-importing the module.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Severity order. A logger set to N emits lines of severity >= N. */
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Map a raw LOG_LEVEL string to a level.
 *
 * Anything unrecognised (including unset, empty, or `silent` — a spelling we do
 * not support) falls back to `info`, which is what the server logged at before
 * this module existed: an operator typo must never silence the server.
 */
export function resolveLogLevel(raw: string | undefined = process.env.LOG_LEVEL): LogLevel {
  const normalized = (raw ?? '').trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalized) ? (normalized as LogLevel) : 'info';
}

/** The slice of console this module needs — injectable so tests can capture. */
export interface LogSink {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface Logger {
  readonly level: LogLevel;
  enabled(level: LogLevel): boolean;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Build a logger.
 *
 * @param level a fixed level, or a resolver called per log call (defaults to
 *              reading LOG_LEVEL at call time).
 * @param sink  destination; defaults to the global console. `debug`/`info` go
 *              to stdout via console.log, `warn`/`error` to their own channels
 *              so `docker logs` and journald keep their existing split.
 */
export function createLogger(
  level: LogLevel | (() => LogLevel) = () => resolveLogLevel(),
  sink: LogSink = console,
): Logger {
  const current = (): LogLevel => (typeof level === 'function' ? level() : level);
  // The channel is looked up on the sink AT CALL TIME (not captured at
  // construction), so a replaced console — a test spy, or an operator's wrapper
  // installed before require — still receives the line.
  const at = (
    wanted: LogLevel,
    channel: 'log' | 'warn' | 'error',
  ): ((...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      if (LEVEL_SEVERITY[wanted] >= LEVEL_SEVERITY[current()]) sink[channel](...args);
    };
  };

  return {
    get level(): LogLevel {
      return current();
    },
    enabled(wanted: LogLevel): boolean {
      return LEVEL_SEVERITY[wanted] >= LEVEL_SEVERITY[current()];
    },
    debug: at('debug', 'log'),
    info: at('info', 'log'),
    warn: at('warn', 'warn'),
    error: at('error', 'error'),
  };
}

/** Process-wide logger honouring LOG_LEVEL. */
export const logger: Logger = createLogger();
