/**
 * Tests for InitCommand
 */
import { describe, it, expect } from 'vitest';
import { InitCommand } from '../commands/init.js';

describe('InitCommand', () => {
  it('is instantiable', () => {
    const cmd = new InitCommand();
    expect(cmd).toBeDefined();
  });

  it('has expected name "init"', () => {
    const cmd = new InitCommand();
    expect(cmd.name()).toBe('init');
  });

  it('has a description', () => {
    const cmd = new InitCommand();
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has force, quiet, and default options', () => {
    const cmd = new InitCommand();
    const opts = cmd.options;
    const optFlags = opts.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('force'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('quiet'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('default'))).toBe(true);
  });
});
