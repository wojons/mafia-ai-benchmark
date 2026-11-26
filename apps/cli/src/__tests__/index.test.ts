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
      async parseAsync(..._args: unknown[]): Promise<this> {
        return Promise.resolve(this as unknown as this);
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

  it('enables positional options on the program and the benchmark command (MAF-L1-FM-004)', () => {
    // Structural pin: ExportCommand re-declares --server/--games under the
    // benchmark parent; positional parsing is what keeps `benchmark export
    // --server X` from landing --server on the parent instead of the export
    // subcommand. The flag must be set at BOTH levels — the root program
    // lifts the 'benchmark' operand and would otherwise parse the options
    // itself before benchmark's own boundary could trip. Behavioral pins
    // (both option placements reach the export fetch URL) live in
    // export.test.ts, MAF-L1-FM-004 describe block.
    const positional = (cmd: unknown) =>
      (cmd as { _enablePositionalOptions?: boolean })._enablePositionalOptions === true;
    expect(positional(program)).toBe(true);
    const bench = program.commands.find((c: { name(): string }) => c.name() === 'benchmark');
    expect(bench).toBeDefined();
    expect(positional(bench)).toBe(true);
  });
});
