/**
 * Tests for BenchmarkCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BenchmarkCommand } from '../commands/benchmark.js';

describe('BenchmarkCommand', () => {
  let cmd: BenchmarkCommand;

  beforeEach(() => {
    cmd = new BenchmarkCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('benchmark');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has expected options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('games'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('models'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('parallel'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('quick'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('json'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('export'))).toBe(true);
  });

  it('has export as a subcommand', () => {
    const names = cmd.commands.map((c: { name(): string }) => c.name());
    expect(names).toContain('export');
  });

  it('runs with --quick flag without inquirer prompt', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    await cmd.parseAsync(['node', 'test', '--quick']);
    expect(console.log).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    await cmd.parseAsync(['node', 'test', '--quick', '--json']);
    // JSON.stringify output was called at least once
    expect(console.log).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('generateRecommendations returns best performer, value, and cheapest', () => {
    const results = [
      { model: 'model-a', winRate: 0.7, avgCost: 2.0 },
      { model: 'model-b', winRate: 0.6, avgCost: 0.5 },
      { model: 'model-c', winRate: 0.5, avgCost: 3.0 },
    ];
    const recommendations = cmd['generateRecommendations'](results);
    expect(recommendations).toHaveLength(3);
    expect(recommendations[0]).toContain('model-a'); // highest win rate
    expect(recommendations[1]).toContain('model-b'); // best value (win rate / cost)
    expect(recommendations[2]).toContain('model-b'); // cheapest
  });

  it('exportResults writes results to file', () => {
    const data = { summary: { totalGames: 3 }, results: [] };
    const exportPath = '/tmp/test-export.json';
    // Use fs from the actual module — vitest can spy on named imports
    const fs = require('fs');
    const origWrite = fs.writeFileSync;
    try {
      cmd['exportResults'](data, exportPath);
      // After calling, verify the file was written by reading it back
      const written = fs.readFileSync(exportPath, 'utf-8');
      expect(JSON.parse(written)).toEqual(data);
    } finally {
      fs.writeFileSync = origWrite;
    }
  });
});
