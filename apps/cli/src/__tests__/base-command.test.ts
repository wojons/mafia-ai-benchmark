/**
 * Tests for BaseCommand class
 */
import { describe, it, expect, vi } from 'vitest';
import { BaseCommand } from '../commands/base-command.js';

// Concrete subclass for testing the abstract BaseCommand
class TestCommand extends BaseCommand {
  constructor() {
    super('test-cmd', 'A test command');
  }

  async run(): Promise<void> {
    this.log('test log');
    this.success('test success');
  }
}

describe('BaseCommand', () => {
  it('is instantiable via concrete subclass', () => {
    const cmd = new TestCommand();
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('test-cmd');
    expect(cmd.description()).toBe('A test command');
  });

  it('has verbose, json, and quiet options', () => {
    const cmd = new TestCommand();
    const opts = cmd.options;
    const optFlags = opts.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('verbose'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('json'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('quiet'))).toBe(true);
  });

  it('log() writes to stdout when not quiet', () => {
    const cmd = new TestCommand();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['log']('hello');
    expect(spy).toHaveBeenCalledWith('hello');
    spy.mockRestore();
  });

  it('log() does NOT write when quiet', () => {
    const cmd = new TestCommand();
    // Set quiet via internal property (opts() returns parsed CLI args during normal flow)
    cmd['quiet'] = true;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['log']('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('showError() writes to stderr', () => {
    const cmd = new TestCommand();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cmd['showError']('something broke');
    expect(spy).toHaveBeenCalledWith('❌ something broke');
    spy.mockRestore();
  });

  it('warn() writes to console.warn', () => {
    const cmd = new TestCommand();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cmd['warn']('heads up');
    expect(spy).toHaveBeenCalledWith('⚠️  heads up');
    spy.mockRestore();
  });

  it('success() writes to stdout', () => {
    const cmd = new TestCommand();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['success']('all good');
    expect(spy).toHaveBeenCalledWith('✅ all good');
    spy.mockRestore();
  });

  it('info() writes to stdout', () => {
    const cmd = new TestCommand();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['info']('fyi');
    expect(spy).toHaveBeenCalledWith('ℹ️  fyi');
    spy.mockRestore();
  });

  it('debug() writes when verbose', () => {
    const cmd = new TestCommand();
    cmd['verbose'] = true;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['debug']('trace info');
    expect(spy).toHaveBeenCalledWith('🔍 trace info');
    spy.mockRestore();
  });

  it('debug() does NOT write when not verbose', () => {
    const cmd = new TestCommand();
    cmd['verbose'] = false;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['debug']('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('outputJSON() writes JSON to stdout', () => {
    const cmd = new TestCommand();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cmd['outputJSON']({ key: 'value' });
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ key: 'value' }, null, 2));
    spy.mockRestore();
  });
});
