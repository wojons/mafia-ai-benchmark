import pino, { Logger as PinoLogger, DestinationStream } from 'pino';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// ─── Type Definitions ────────────────────────────────────────────────────────

/** Log levels in order of increasing severity. */
export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  SILENT = Infinity,
}

/** Shape of every structured JSON log entry emitted by this system. */
export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  gameId?: string;
  playerId?: string;
  message: string;
  data?: unknown;
}

/** Pino-level numeric mapping (pino uses 10=trace, 20=debug, 30=info, 40=warn, 50=error). */
const PINO_LEVEL_MAP: Record<LogLevel, pino.LevelWithSilent> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
  [LogLevel.SILENT]: 'silent',
};

export interface ConsoleTransportOptions {
  /** Pretty-print to console (default: false → raw JSON) */
  pretty?: boolean;
}

export interface FileTransportOptions {
  /** Path to log file. Directories are created automatically. */
  path: string;
}

export interface EventBusTransportOptions {
  /** An existing EventEmitter to publish log entries to. */
  emitter: EventEmitter;
  /** Event name to emit (default: 'log'). */
  event?: string;
}

export interface TransportConfig {
  console?: boolean | ConsoleTransportOptions;
  file?: string | FileTransportOptions;
  eventBus?: EventBusTransportOptions;
}

export interface LoggerConfig {
  level: LogLevel;
  component: string;
  transports?: TransportConfig;
  gameId?: string;
  playerId?: string;
}

// ─── Known pino-internal keys to filter out of the data field ────────────────
const PINO_INTERNALS = new Set([
  'level', 'time', 'pid', 'hostname', 'component', 'gameId', 'playerId', 'msg', 'message',
]);

// ─── EventBus Stream ─────────────────────────────────────────────────────────

/**
 * Writable stream that transforms pino's raw JSON into spec-compliant
 * LogEntry objects and emits them on the provided EventEmitter.
 */
class EventBusStream {
  private buffer = '';
  private emitter: EventEmitter;
  private eventName: string;

  constructor(emitter: EventEmitter, eventName: string) {
    this.emitter = emitter;
    this.eventName = eventName;
  }

  /** pino calls this with each chunk (a string). */
  write(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        try {
          const raw = JSON.parse(line);
          this.emitter.emit(this.eventName, this.transform(raw));
        } catch {
          // Malformed JSON — silently discard
        }
      }
    }
  }

  /** Transform pino's native format → spec LogEntry format. */
  private transform(raw: Record<string, unknown>): LogEntry {
    const {
      level,
      time,
      component,
      gameId,
      playerId,
      msg,
      message: msgAlt,
      ...rest
    } = raw;

    const entry: LogEntry = {
      timestamp: (typeof time === 'string' ? time : String(time ?? '')) as string,
      level: (typeof level === 'string' ? level : String(level ?? '')) as string,
      component: (typeof component === 'string' ? component : 'unknown') as string,
      message: (typeof msg === 'string' ? msg : typeof msgAlt === 'string' ? msgAlt : '') as string,
    };

    if (gameId !== undefined) entry.gameId = gameId as string;
    if (playerId !== undefined) entry.playerId = playerId as string;

    // Collect extra fields as data
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
      if (!PINO_INTERNALS.has(key)) {
        data[key] = rest[key];
      }
    }
    if (Object.keys(data).length > 0) {
      entry.data = data;
    }

    return entry;
  }

  end(): void {
    if (this.buffer.trim()) {
      try {
        const raw = JSON.parse(this.buffer);
        this.emitter.emit(this.eventName, this.transform(raw));
      } catch { /* discard */ }
      this.buffer = '';
    }
  }

  destroy(): void { /* no-op */ }
}

// ─── Logger Class ────────────────────────────────────────────────────────────

/**
 * Structured JSON logger wrapping pino.
 *
 * Supports four log levels (DEBUG/INFO/WARN/ERROR), three transports
 * (console, file, EventBus), and child loggers with contextual
 * correlation IDs (gameId / playerId).
 */
export class Logger {
  private pino: PinoLogger;
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = config;

    const streams: DestinationStream[] = [];
    const transports = config.transports ?? {};

    // --- Console transport ---
    if (transports.console !== undefined && transports.console !== false) {
      streams.push(
        pino.destination({ dest: process.stdout.fd, sync: true }),
      );
    }

    // --- File transport ---
    if (transports.file) {
      const fileOpts: FileTransportOptions =
        typeof transports.file === 'string'
          ? { path: transports.file }
          : transports.file;
      const dir = path.dirname(fileOpts.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      streams.push(pino.destination({ dest: fileOpts.path, sync: false }));
    }

    // --- EventBus transport ---
    if (transports.eventBus) {
      const ebOpts = transports.eventBus;
      const eventName = ebOpts.event ?? 'log';
      const busStream = new EventBusStream(ebOpts.emitter, eventName);
      streams.push(busStream as unknown as DestinationStream);
    }

    // If no transports specified, default to raw-JSON console
    if (streams.length === 0) {
      streams.push(
        pino.destination({ dest: process.stdout.fd, sync: true }),
      );
    }

    // Merge all streams via multistream
    const multistream = streams.length === 1
      ? streams[0]
      : (pino.multistream(
          streams.map((s) => ({ stream: s })),
        ) as unknown as DestinationStream);

    const pinoLevel = PINO_LEVEL_MAP[config.level] ?? 'info';

    this.pino = pino(
      {
        level: pinoLevel,
        messageKey: 'message',
        formatters: {
          level(label: string) {
            return { level: label.toUpperCase() };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        mixin() {
          const ctx: Record<string, unknown> = {
            component: config.component,
          };
          if (config.gameId) ctx.gameId = config.gameId;
          if (config.playerId) ctx.playerId = config.playerId;
          return ctx;
        },
      },
      multistream,
    );
  }

  /** Log at DEBUG level. */
  debug(message: string, data?: unknown): void {
    this.pino.debug(data, message);
  }

  /** Log at INFO level. */
  info(message: string, data?: unknown): void {
    this.pino.info(data, message);
  }

  /** Log at WARN level. */
  warn(message: string, data?: unknown): void {
    this.pino.warn(data, message);
  }

  /** Log at ERROR level. */
  error(message: string, data?: unknown): void {
    this.pino.error(data, message);
  }

  /**
   * Create a child logger that inherits this logger's config, overriding or
   * appending correlation IDs. Useful for per-game or per-player logging.
   */
  child(opts: { gameId?: string; playerId?: string; component?: string }): Logger {
    const childConfig: LoggerConfig = {
      ...this.config,
      gameId: opts.gameId ?? this.config.gameId,
      playerId: opts.playerId ?? this.config.playerId,
      component: opts.component ?? this.config.component,
    };
    return new Logger(childConfig);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new Logger instance.
 *
 * @example
 * ```ts
 * const log = createLogger({ level: LogLevel.INFO, component: 'GameEngine' });
 * log.info('Game started', { players: 4 });
 * ```
 */
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}
