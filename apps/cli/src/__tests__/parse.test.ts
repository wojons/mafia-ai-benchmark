/**
 * Parse-level integration tests for the real argv path (MAF-GAP-009).
 *
 * These spawn the actual CLI (`node tsx-cli src/index.ts ...`) with
 * process.argv-like arguments, proving that commander `.action()`
 * handlers are wired — commands previously printed NOTHING and exited 0
 * because only `cmd.run()` was tested directly in unit tests.
 *
 * Spawning (rather than importing ../index.js) avoids the module's
 * top-level `main()` calling parseAsync(process.argv) with vitest's own
 * argv, which would trip the `command:*` handler's process.exit(1).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(__filename);

// Resolve the tsx CLI entry (devDependency of @mafia/cli) and the CLI entry point.
const tsxCli = nodeRequire.resolve('tsx/cli');
const cliEntry = path.resolve(__dirname, '../index.ts');

const tmpDirs: string[] = [];

function makeTempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mafiactl-parse-'));
  tmpDirs.push(dir);
  return dir;
}

async function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxCli, cliEntry, ...args],
      { cwd, env: process.env, timeout: 60000 }
    );
    return { stdout, stderr, code: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      code: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI parse path (real argv)', () => {
  it(
    'mafiactl init --default fires .action() and writes mafia.config.json',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, ['init', '--default']);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      // The bug: command printed NOTHING and exited 0. Now it must produce output.
      expect(stdout).toContain('Configuration created with defaults');
      // Real side effect: the config file must exist in the cwd.
      expect(existsSync(path.join(cwd, 'mafia.config.json'))).toBe(true);
    },
    90000
  );

  it(
    'mafiactl list-games --help exits 0 with usage output (no server needed)',
    async () => {
      const cwd = makeTempCwd();
      const { stdout, stderr, code } = await runCli(cwd, ['list-games', '--help']);

      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect(stdout).toContain('Usage');
      expect(stdout).toContain('List recent and active games');
      expect(stdout).toContain('--server');
    },
    90000
  );
});
