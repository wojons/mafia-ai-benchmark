/**
 * Tests for ExportCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExportCommand } from '../commands/export.js';

describe('ExportCommand', () => {
  let cmd: ExportCommand;

  beforeEach(() => {
    cmd = new ExportCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('export');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has expected options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('format'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('games'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('output'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('server'))).toBe(true);
  });

  it('fetches JSON export from /api/v1/benchmark/export', async () => {
    const mockData = { results: [{ model: 'test', winRate: 0.8 }] };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
      text: async () => '',
    }));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    cmd.parse(['node', 'test']);
    await cmd.run();

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('/api/v1/benchmark/export');
    exitSpy.mockRestore();
  });

  it('fetches CSV export format', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => 'model,winRate\nmodel-a,0.8',
    }));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    cmd.parse(['node', 'test', '--format', 'csv']);
    await cmd.run();

    expect(fetch).toHaveBeenCalled();
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('format=csv');
    exitSpy.mockRestore();
  });

  it('rejects invalid format with exit code 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    cmd.parse(['node', 'test', '--format', 'xml']);
    await cmd.run();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('writes output to file when --output is specified', async () => {
    const tmpFile = '/tmp/mafia-export-test-' + Date.now() + '.json';
    const mockData = { results: [] };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
      text: async () => '',
    }));

    cmd.parse(['node', 'test', '--output', tmpFile]);
    await cmd.run();

    // Verify file was written by reading it back
    const fs = await import('fs');
    expect(fs.existsSync(tmpFile)).toBe(true);
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(JSON.parse(content)).toEqual(mockData);
    fs.unlinkSync(tmpFile);
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('exits with code 1 on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    cmd.parse(['node', 'test']);
    await cmd.run();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
