import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger, LogLevel, Logger, LogEntry } from '../../logging';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a logger that sends all output to an EventBus, plus captures it in
 * an array for assertions. Disables console output.
 */
function makeTestLogger(overrides: {
  level?: LogLevel;
  component?: string;
  gameId?: string;
  playerId?: string;
} = {}): { log: Logger; entries: LogEntry[] } {
  const emitter = new EventEmitter();
  const entries: LogEntry[] = [];
  emitter.on('log', (entry: LogEntry) => entries.push(entry));

  const log = createLogger({
    level: overrides.level ?? LogLevel.INFO,
    component: overrides.component ?? 'TestComponent',
    gameId: overrides.gameId,
    playerId: overrides.playerId,
    transports: {
      console: false,
      eventBus: { emitter },
    },
  });

  return { log, entries };
}

/** Create a temp file path that will be cleaned up. */
function tempFilePath(): string {
  return path.join(
    os.tmpdir(),
    `logging-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Logging Service', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const fp of tempFiles) {
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
    }
    tempFiles.length = 0;
  });

  // ─── Test 1: Level Filtering ─────────────────────────────────────────────

  describe('level filtering', () => {
    it('should emit INFO logs but suppress DEBUG when level is INFO', () => {
      const { log, entries } = makeTestLogger({ level: LogLevel.INFO });
      log.debug('should not appear');
      log.info('should appear');

      expect(entries.length).toBe(1);
      expect(entries[0].message).toBe('should appear');
      expect(entries[0].level).toBe('INFO');
    });

    it('should emit ERROR logs but suppress WARN when level is ERROR', () => {
      const { log, entries } = makeTestLogger({ level: LogLevel.ERROR });
      log.warn('should not appear');
      log.error('should appear');

      expect(entries.length).toBe(1);
      expect(entries[0].message).toBe('should appear');
      expect(entries[0].level).toBe('ERROR');
    });

    it('should emit all levels when level is DEBUG', () => {
      const { log, entries } = makeTestLogger({ level: LogLevel.DEBUG });
      log.debug('debug msg');
      log.info('info msg');
      log.warn('warn msg');
      log.error('error msg');

      expect(entries.length).toBe(4);
      expect(entries[0].message).toBe('debug msg');
      expect(entries[0].level).toBe('DEBUG');
      expect(entries[1].message).toBe('info msg');
      expect(entries[1].level).toBe('INFO');
      expect(entries[2].message).toBe('warn msg');
      expect(entries[2].level).toBe('WARN');
      expect(entries[3].message).toBe('error msg');
      expect(entries[3].level).toBe('ERROR');
    });

    it('should suppress all messages when level is SILENT', () => {
      const { log, entries } = makeTestLogger({ level: LogLevel.SILENT });
      log.error('should not appear');
      expect(entries.length).toBe(0);
    });
  });

  // ─── Test 2: JSON Format ──────────────────────────────────────────────────

  describe('JSON format', () => {
    it('should emit valid JSON with all required fields', () => {
      const { log, entries } = makeTestLogger({
        component: 'GameEngine',
        gameId: 'game-123',
        playerId: 'player-abc',
      });

      log.info('Game round started', { round: 1, phase: 'night' });

      expect(entries.length).toBe(1);
      const entry = entries[0];

      // All entries have these required fields
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level', 'INFO');
      expect(entry).toHaveProperty('component', 'GameEngine');
      expect(entry).toHaveProperty('message', 'Game round started');

      // Optional correlation IDs
      expect(entry).toHaveProperty('gameId', 'game-123');
      expect(entry).toHaveProperty('playerId', 'player-abc');

      // Data is nested under the `data` field
      expect(entry).toHaveProperty('data');
      expect(entry.data).toEqual({ round: 1, phase: 'night' });

      // Timestamp should be ISO 8601
      expect(() => new Date(entry.timestamp)).not.toThrow();
      expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should omit optional fields when not provided', () => {
      const { log, entries } = makeTestLogger({ component: 'NoCorrelation' });
      log.info('Simple message');

      const entry = entries[0];
      expect(entry.gameId).toBeUndefined();
      expect(entry.playerId).toBeUndefined();
      expect(entry.data).toBeUndefined();
    });
  });

  // ─── Test 3: Child Loggers with Correlation IDs ───────────────────────────

  describe('child loggers', () => {
    it('should inherit parent config and override gameId', () => {
      const { log: parent, entries } = makeTestLogger({
        component: 'Server',
        gameId: 'global',
      });
      const child = parent.child({ gameId: 'game-456' });
      child.info('Child message');

      const entry = entries[0];
      expect(entry.component).toBe('Server');
      expect(entry.gameId).toBe('game-456');
    });

    it('should allow overriding component in child', () => {
      const { log: parent, entries } = makeTestLogger({
        component: 'Server',
      });
      const child = parent.child({ component: 'PlayerHandler', playerId: 'p1' });
      child.info('Handling player');

      const entry = entries[0];
      expect(entry.component).toBe('PlayerHandler');
      expect(entry.playerId).toBe('p1');
    });

    it('should respect level filtering in child loggers', () => {
      const emitter = new EventEmitter();
      const childEntries: LogEntry[] = [];
      emitter.on('log', (e: LogEntry) => childEntries.push(e));

      const parent = createLogger({
        level: LogLevel.WARN,
        component: 'Parent',
        transports: { console: false, eventBus: { emitter } },
      });
      const child = parent.child({ gameId: 'g1' });
      child.info('should not appear');
      child.warn('should appear');

      expect(childEntries.length).toBe(1);
      expect(childEntries[0].message).toBe('should appear');
      expect(childEntries[0].level).toBe('WARN');
    });
  });

  // ─── Test 4: File Transport ───────────────────────────────────────────────

  describe('file transport', () => {
    it('should write JSON log entries to a file', async () => {
      const fp = tempFilePath();
      tempFiles.push(fp);

      const log = createLogger({
        level: LogLevel.INFO,
        component: 'FileTest',
        transports: { console: false, file: { path: fp } },
      });
      log.info('File log entry', { key: 'value' });

      // pino file writes are async; poll for data
      await new Promise<void>((resolve) => {
        const start = Date.now();
        const check = () => {
          try {
            const content = fs.readFileSync(fp, 'utf-8').trim();
            if (content.includes('File log entry')) {
              // File has pino-native JSON: uses 'time' not 'timestamp', 'message' (since we set messageKey)
              const raw = JSON.parse(content.split('\n')[0]);
              expect(raw.component).toBe('FileTest');
              expect(raw.message).toBe('File log entry');
              expect(raw.key).toBe('value');
              resolve();
              return;
            }
          } catch {
            // file not ready yet
          }
          if (Date.now() - start > 4000) {
            const content = fs.readFileSync(fp, 'utf-8').trim();
            expect(content).toContain('File log entry');
            resolve();
            return;
          }
          setTimeout(check, 50);
        };
        setTimeout(check, 50);
      });
    }, 8000);
  });

  // ─── Test 5: EventBus Transport ───────────────────────────────────────────

  describe('eventBus transport', () => {
    it('should emit log entries as events on the provided EventEmitter', () => {
      const emitter = new EventEmitter();
      const logEntries: LogEntry[] = [];

      emitter.on('myLogs', (entry: LogEntry) => {
        logEntries.push(entry);
      });

      const log = createLogger({
        level: LogLevel.INFO,
        component: 'EventBusTest',
        transports: {
          console: false,
          eventBus: { emitter, event: 'myLogs' },
        },
      });

      log.info('Event 1', { num: 1 });
      log.warn('Event 2', { num: 2 });

      expect(logEntries.length).toBe(2);
      expect(logEntries[0].message).toBe('Event 1');
      expect(logEntries[0].level).toBe('INFO');
      expect(logEntries[0].data).toEqual({ num: 1 });
      expect(logEntries[1].message).toBe('Event 2');
      expect(logEntries[1].level).toBe('WARN');
      expect(logEntries[1].data).toEqual({ num: 2 });
    });
  });
});
