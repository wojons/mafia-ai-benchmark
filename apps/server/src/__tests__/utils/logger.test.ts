/**
 * OBS-005: LOG_LEVEL was advertised in .env.sample but read by nothing, so an
 * operator asking for `LOG_LEVEL=error` still got every info line. These tests
 * pin the filter, the fallback, and the lazy env read.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  LOG_LEVELS,
  createLogger,
  logger,
  resolveLogLevel,
  type LogSink,
} from '../../utils/logger.js';

function recordingSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  const push = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  return { sink: { log: push, warn: push, error: push }, lines };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('OBS-005 — resolveLogLevel', () => {
  it('accepts the four documented levels', () => {
    for (const level of LOG_LEVELS) {
      expect(resolveLogLevel(level)).toBe(level);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveLogLevel(' ERROR ')).toBe('error');
    expect(resolveLogLevel('Debug')).toBe('debug');
  });

  it('falls back to info for unset or unrecognised values', () => {
    // An operator typo must never silence the server.
    expect(resolveLogLevel(undefined)).toBe('info');
    expect(resolveLogLevel('')).toBe('info');
    expect(resolveLogLevel('verbose')).toBe('info');
    expect(resolveLogLevel('silent')).toBe('info');
  });

  it('reads LOG_LEVEL by default', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    expect(resolveLogLevel()).toBe('warn');
  });
});

describe('OBS-005 — createLogger', () => {
  it('LOG_LEVEL=error suppresses info and debug but keeps warn and error', () => {
    const { sink, lines } = recordingSink();
    const log = createLogger('error', sink);

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    // At error, warn is below the threshold too — only errors survive.
    expect(lines).toEqual(['e']);
    expect(log.enabled('info')).toBe(false);
    expect(log.enabled('warn')).toBe(false);
    expect(log.enabled('error')).toBe(true);
    expect(log.level).toBe('error');
  });

  it('LOG_LEVEL=info keeps the pre-existing volume', () => {
    const { sink, lines } = recordingSink();
    const log = createLogger('info', sink);

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    // debug is the only level info hides — the server never logged below info.
    expect(lines).toEqual(['i', 'w', 'e']);
  });

  it('LOG_LEVEL=debug emits everything', () => {
    const { sink, lines } = recordingSink();
    const log = createLogger('debug', sink);

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(lines).toEqual(['d', 'i', 'w', 'e']);
  });

  it('resolves the level per call, so LOG_LEVEL can change at runtime', () => {
    const { sink, lines } = recordingSink();
    const log = createLogger(undefined, sink);

    vi.stubEnv('LOG_LEVEL', 'error');
    log.info('suppressed');
    log.error('kept');

    vi.stubEnv('LOG_LEVEL', 'debug');
    log.info('now visible');

    expect(lines).toEqual(['kept', 'now visible']);
  });
});

describe('OBS-005 — process logger', () => {
  it('the shared logger resolves LOG_LEVEL per call and writes to the live console', () => {
    vi.stubEnv('LOG_LEVEL', 'error');
    expect(logger.enabled('info')).toBe(false);

    vi.stubEnv('LOG_LEVEL', 'info');
    expect(logger.enabled('info')).toBe(true);

    // Default sink is the console object itself, resolved when the line is
    // written — so a spy installed after import still sees it.
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fresh = createLogger();
    fresh.info('should appear');
    expect(stdout).toHaveBeenCalledTimes(1);

    vi.stubEnv('LOG_LEVEL', 'error');
    fresh.info('should not appear');
    expect(stdout).toHaveBeenCalledTimes(1);
  });
});
