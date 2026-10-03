/**
 * Real-argv CLI surface tests carried from the legacy standalone
 * integration.test.js runner (MAF-GAP-074).
 *
 * The 261-line apps/cli/src/integration.test.js was a custom pass/fail-counter
 * runner (execSync children, own counters, process.exit summary). It was
 * excluded by the package vitest config (only src .test.ts/.test.tsx files
 * are matched) and referenced by no script/turbo/CI task, so its tests
 * silently never executed — and it had gone STALE: it invoked
 * `games list|create|watch` / `config get|set` / `init --force` / `stats
 * --model` / `benchmark --quick` subcommands that no longer exist in
 * mafiactl (today: init/run-game/watch-game/list-games/config/stats/
 * benchmark), and asserted an "Unknown command" exit-1 error path the current
 * default help action replaces. Its valid arms (still-live server fetches,
 * --version/--help) are superseded by index.test.ts / stats.test.ts /
 * parse.test.ts / benchmark.test.ts.
 *
 * What was NOT covered anywhere else — the raw --version output and the
 * rejected-unknown-option exit path via the real argv boundary — is pinned
 * here. Spawning through tsx (same pattern as parse.test.ts) proves the
 * program's own parse path, not a stubbed commander.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync } from 'fs';
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
  const dir = mkdtempSync(path.join(tmpdir(), 'mafiactl-integration-'));
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

describe('CLI surface (real argv, from legacy integration.test.js)', () => {
  it('--version prints the package version on stdout and exits 0', async () => {
    const cwd = makeTempCwd();
    const { stdout, code } = await runCli(cwd, ['--version']);

    expect(code).toBe(0);
    // stdout must be a bare version (commander's -V), not help text.
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 60000);

  it('an unknown option is rejected on stderr with exit 1', async () => {
    const cwd = makeTempCwd();
    const { stderr, code } = await runCli(cwd, ['--invalid-option']);

    expect(code).toBe(1);
    expect(stderr).toContain("unknown option '--invalid-option'");
  }, 60000);
});