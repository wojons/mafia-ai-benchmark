/**
 * Tests for RunGameCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RunGameCommand } from '../commands/run-game.js';

describe('RunGameCommand', () => {
  let cmd: RunGameCommand;

  beforeEach(() => {
    cmd = new RunGameCommand();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('run-game');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has expected options', () => {
    const optFlags = cmd.options.map((o: { flags: string }) => o.flags);
    expect(optFlags.some((f: string) => f.includes('config'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('players'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('provider'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('model'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('auto'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('watch'))).toBe(true);
    expect(optFlags.some((f: string) => f.includes('server'))).toBe(true);
  });

  it('starts a game with --auto flag via POST /api/v1/games', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ success: true, data: { gameId: 'game-456', status: 'setup' } }),
      text: async () => '',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await cmd.parseAsync(['node', 'test', '--auto']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('/api/v1/games');
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('starts a game with --yes flag (alias for --auto) via POST /api/v1/games', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ success: true, data: { gameId: 'game-789', status: 'setup' } }),
      text: async () => '',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await cmd.parseAsync(['node', 'test', '--yes']);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as any).mock.calls[0][0];
    expect(url).toContain('/api/v1/games');
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('exits with code 1 on server connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await cmd.parseAsync(['node', 'test', '--auto']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits with code 1 on API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server Error',
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await cmd.parseAsync(['node', 'test', '--auto']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('provides default game config', () => {
    const config = cmd['getDefaultGameConfig']();
    expect(config).toBeDefined();
    expect(config.numPlayers).toBe(10);
    expect(config.llmProvider).toBe('openai');
    expect(config.llmModel).toBe('openai/gpt-4o-mini');
    expect(config.nightDuration).toBe(60);
    expect(config.dayDuration).toBe(120);
    expect(config.votingDuration).toBe(30);
    expect(config.roles).toHaveLength(5);
  });

  // MAF-GAP-046: mafiactl init writes a NESTED config shape
  // ({game: {nightPhaseDuration, ...}, llm: {provider, model}}) while
  // loadConfig used to cast it straight onto the FLAT GameConfig interface,
  // printing "Night: undefineds / Provider: undefined" etc. These tests pin
  // the normalization of both shapes.
  it('loadConfig normalizes the nested init config shape (game.* / llm.*)', () => {
    const nested = {
      name: 'Mafia Game',
      version: '1.0.0',
      game: {
        numPlayers: 5,
        roles: [{ role: 'MAFIA', count: 3 }],
        nightPhaseDuration: 60,
        dayPhaseDuration: 120,
        votingDuration: 30,
        tieBreaker: 'RANDOM',
        allowSelfVote: false,
      },
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
        temperature: 0.7,
        maxTokens: 2000,
      },
      visualization: { enable3D: false, enableVoice: false },
      logging: { level: 'INFO', file: './logs/mafia.log' },
    };
    const configPath = path.join(os.tmpdir(), `mafia-config-nested-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(nested));
    try {
      const config = cmd['loadConfig'](configPath);
      expect(config).not.toBeNull();
      expect(config!.numPlayers).toBe(5);
      expect(config!.llmProvider).toBe('anthropic');
      expect(config!.llmModel).toBe('claude-sonnet-4.5');
      expect(config!.nightDuration).toBe(60);
      expect(config!.dayDuration).toBe(120);
      expect(config!.votingDuration).toBe(30);
      expect(config!.roles).toEqual([{ role: 'MAFIA', count: 3 }]);
    } finally {
      fs.unlinkSync(configPath);
    }
  });

  it('loadConfig keeps the flat config shape working', () => {
    const flat = {
      numPlayers: 7,
      llmProvider: 'google',
      llmModel: 'gemini-2.5-pro',
      nightDuration: 45,
      dayDuration: 90,
      votingDuration: 20,
      roles: [{ role: 'VILLAGER', count: 7 }],
    };
    const configPath = path.join(os.tmpdir(), `mafia-config-flat-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(flat));
    try {
      const config = cmd['loadConfig'](configPath);
      expect(config).not.toBeNull();
      expect(config!.numPlayers).toBe(7);
      expect(config!.llmProvider).toBe('google');
      expect(config!.llmModel).toBe('gemini-2.5-pro');
      expect(config!.nightDuration).toBe(45);
      expect(config!.dayDuration).toBe(90);
      expect(config!.votingDuration).toBe(20);
      expect(config!.roles).toEqual([{ role: 'VILLAGER', count: 7 }]);
    } finally {
      fs.unlinkSync(configPath);
    }
  });

  it('loadConfig falls back to defaults for missing fields (never undefined)', () => {
    // The sparse repo-root mafia.config.json shape: no game/llm keys at all.
    const sparse = { 'provider.openai.key': 'test-key' };
    const configPath = path.join(os.tmpdir(), `mafia-config-sparse-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(sparse));
    try {
      const config = cmd['loadConfig'](configPath);
      expect(config).not.toBeNull();
      expect(config!.numPlayers).toBe(10);
      expect(config!.llmProvider).toBe('openai');
      expect(config!.llmModel).toBe('openai/gpt-4o-mini');
      expect(config!.nightDuration).toBe(60);
      expect(config!.dayDuration).toBe(120);
      expect(config!.votingDuration).toBe(30);
    } finally {
      fs.unlinkSync(configPath);
    }
  });

  it('run() with a nested init config prints no "undefined"', async () => {
    const nested = {
      game: { numPlayers: 5, nightPhaseDuration: 60, dayPhaseDuration: 120, votingDuration: 30 },
      llm: { provider: 'openai', model: 'openai/gpt-4o-mini' },
    };
    const configPath = path.join(os.tmpdir(), `mafia-config-run-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(nested));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { gameId: 'game-046', status: 'setup' } }),
      text: async () => '',
    }));
    try {
      await cmd.parseAsync(['node', 'test', '--yes', '--players', '5', '-c', configPath]);
      const logged = (console.log as any).mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
      expect(logged).not.toContain('undefined');
      expect(logged).toContain('Players:     5');
      expect(logged).toContain('Provider:    openai');
      expect(logged).toMatch(/Night:\s+60s/);
      expect(logged).toMatch(/Day:\s+120s/);
      expect(logged).toMatch(/Voting:\s+30s/);
    } finally {
      fs.unlinkSync(configPath);
    }
  });
});
