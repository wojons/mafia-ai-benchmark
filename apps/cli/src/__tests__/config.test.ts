/**
 * Tests for ConfigCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { ConfigCommand } from '../commands/config.js';

describe('ConfigCommand', () => {
  let cmd: ConfigCommand;
  let tmpDir: string;
  const configData = {
    numPlayers: 8,
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4',
    nightDuration: 45,
    dayDuration: 90,
    votingDuration: 25,
  };

  beforeEach(() => {
    cmd = new ConfigCommand();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'config-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is instantiable with expected name', () => {
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe('config');
  });

  it('has a description', () => {
    expect(cmd.description()).toBeTruthy();
    expect(typeof cmd.description()).toBe('string');
  });

  it('has show, set, and reset subcommands', () => {
    const names = cmd.commands.map((c: { name(): string }) => c.name());
    expect(names).toContain('show');
    expect(names).toContain('set');
    expect(names).toContain('reset');
  });

  it('showConfig displays config when file exists', async () => {
    writeFileSync(path.join(tmpDir, 'mafia.config.json'), JSON.stringify(configData, null, 2));
    await cmd.showConfig({ json: false });
    expect(console.log).toHaveBeenCalled();
  });

  it('showConfig outputs JSON with --json flag', async () => {
    writeFileSync(path.join(tmpDir, 'mafia.config.json'), JSON.stringify(configData, null, 2));
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cmd.showConfig({ json: true });
    expect(spy).toHaveBeenCalledWith(JSON.stringify(configData, null, 2));
  });

  it('showConfig shows empty message when no config exists', async () => {
    await cmd.showConfig({ json: false });
    expect(console.log).toHaveBeenCalled();
  });

  it('setConfig updates a key in the config file', async () => {
    writeFileSync(path.join(tmpDir, 'mafia.config.json'), JSON.stringify(configData, null, 2));
    await cmd.setConfig('numPlayers', '12');
    const saved = JSON.parse(readFileSync(path.join(tmpDir, 'mafia.config.json'), 'utf-8'));
    expect(saved.numPlayers).toBe(12);
    expect(saved.llmProvider).toBe('anthropic'); // unchanged
  });

  it('setConfig creates config file if missing', async () => {
    await cmd.setConfig('llmModel', 'gpt-4');
    const saved = JSON.parse(readFileSync(path.join(tmpDir, 'mafia.config.json'), 'utf-8'));
    expect(saved.llmModel).toBe('gpt-4');
  });

  it('setConfig parses boolean values', async () => {
    await cmd.setConfig('enable3D', 'true');
    const saved = JSON.parse(readFileSync(path.join(tmpDir, 'mafia.config.json'), 'utf-8'));
    expect(saved.enable3D).toBe(true);
  });

  it('setConfig parses numeric strings', async () => {
    await cmd.setConfig('nightDuration', '45');
    const saved = JSON.parse(readFileSync(path.join(tmpDir, 'mafia.config.json'), 'utf-8'));
    expect(saved.nightDuration).toBe(45);
  });

  it('resetConfig with force writes defaults', async () => {
    writeFileSync(path.join(tmpDir, 'mafia.config.json'), JSON.stringify(configData, null, 2));
    await cmd.resetConfig(true);
    const saved = JSON.parse(readFileSync(path.join(tmpDir, 'mafia.config.json'), 'utf-8'));
    expect(saved.numPlayers).toBe(10);
    expect(saved.llmProvider).toBe('openai');
    expect(saved.llmModel).toBe('openai/gpt-4o-mini');
  });
});
