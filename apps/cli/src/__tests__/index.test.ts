/**
 * Smoke tests for CLI entry point (index.ts)
 *
 * index.ts auto-executes main() on import, which calls program.parseAsync() →
 * process.exit(). We mock commander's parseAsync to prevent side effects.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock commander.parseAsync before the index module loads
vi.mock('commander', async (importOriginal) => {
  const actual = await importOriginal<typeof import('commander')>();
  // Wrap Command to make parseAsync a no-op
  const OrigCommand = actual.Command;
  return {
    ...actual,
    Command: class extends OrigCommand {
      parseAsync(..._args: unknown[]): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

import program from '../index.js';

describe('CLI program', () => {
  it('is defined', () => {
    expect(program).toBeDefined();
  });

  it('has expected name "mafiactl"', () => {
    expect(program.name()).toBe('mafiactl');
  });

  it('has at least one command registered', () => {
    const commands = program.commands;
    expect(commands.length).toBeGreaterThan(0);
  });

  it('has all expected top-level commands', () => {
    const commandNames = program.commands.map((c: { name(): string }) => c.name());
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('run-game');
    expect(commandNames).toContain('watch-game');
    expect(commandNames).toContain('list-games');
    expect(commandNames).toContain('config');
    expect(commandNames).toContain('stats');
    expect(commandNames).toContain('benchmark');
  });

  it('has verbose and config global options', () => {
    const opts = program.options;
    const optFlags = opts.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('verbose'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('config'))).toBe(true);
  });
});
