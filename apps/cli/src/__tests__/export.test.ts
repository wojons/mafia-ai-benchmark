/**
 * Tests for ExportCommand
 *
 * MAF-L1-FM-003: the original tests called `cmd.parse([...])` and then
 * `await cmd.run()` DIRECTLY, bypassing commander's action dispatch — the
 * exact path that was broken (ExportCommand had no action handler, so the
 * real CLI silently exited 0 with empty stdout+stderr). All dispatch tests
 * here now go through `await cmd.parseAsync([...])`, which exercises the
 * real wiring: parse → action handler → run().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExportCommand } from '../commands/export.js';
import { BenchmarkCommand } from '../commands/benchmark.js';

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

  it('has a wired action handler (regression: silent exit 0, MAF-L1-FM-003)', () => {
    // commander stores the bound handler on the (private) _actionHandler
    // field once .action() has been called; it is null until then. This is
    // the structural pin for the bug: without wiring, parse matched the
    // subcommand and exited 0 silently. The behavioral pins are in the
    // parseAsync tests below.
    const handler = (cmd as unknown as { _actionHandler?: unknown })._actionHandler;
    expect(typeof handler).toBe('function');
  });

  it('real commander dispatch performs the export (no silent exit 0)', async () => {
    const mockData = { results: [{ model: 'test', winRate: 0.8 }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
      text: async () => '',
    }));
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Pre-fix this returned immediately: no fetch, no output, exit 0.
    await cmd.parseAsync(['node', 'test']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(url).toContain('/api/v1/benchmark/export');
    // The fetched payload reached stdout.
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('winRate'));
  });

  it('dispatch through the parent benchmark command reaches run()', async () => {
    // The production path: `mafiactl benchmark export` parses `export` as a
    // SUBCOMMAND of benchmark. Pre-fix, commander matched the subcommand,
    // found no action, and silently exited 0.
    const mockData = { results: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
      text: async () => '',
    }));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const bench = new BenchmarkCommand();
    await bench.parseAsync(['node', 'test', 'export']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(url).toContain('/api/v1/benchmark/export');
  });

  it('fetch failure via dispatch exits 1 WITH an error message (no silent exit 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const errSpy = vi.spyOn(console, 'error');

    await cmd.parseAsync(['node', 'test']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot connect to server'));
  });

  it('invalid format via dispatch exits 1 with an error message', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const errSpy = vi.spyOn(console, 'error');
    // Defense: mock fetch + stdout so a stubbed process.exit can never
    // fall through to a real network call or dump a live payload.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
      text: async () => '',
    }));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await cmd.parseAsync(['node', 'test', '--format', 'xml']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid format'));
  });

  it('fetches JSON export from /api/v1/benchmark/export', async () => {
    const mockData = { results: [{ model: 'test', winRate: 0.8 }] };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
      text: async () => '',
    }));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await cmd.parseAsync(['node', 'test']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(url).toContain('/api/v1/benchmark/export');
    exitSpy.mockRestore();
  });

  it('fetches CSV export format', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => 'model,winRate\nmodel-a,0.8',
    }));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await cmd.parseAsync(['node', 'test', '--format', 'csv']);

    expect(fetch).toHaveBeenCalled();
    const url = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(url).toContain('format=csv');
    exitSpy.mockRestore();
  });

  it('writes output to file when --output is specified', async () => {
    const tmpFile = '/tmp/mafia-export-test-' + Date.now() + '-' + process.pid + '.json';
    const mockData = { results: [] };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
      text: async () => '',
    }));

    await cmd.parseAsync(['node', 'test', '--output', tmpFile]);

    // Verify file was written by reading it back
    const fs = await import('fs');
    expect(fs.existsSync(tmpFile)).toBe(true);
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(JSON.parse(content)).toEqual(mockData);
    fs.unlinkSync(tmpFile);
    exitSpy.mockRestore();
  });
});
