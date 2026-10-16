import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPTS = join(REPO_ROOT, 'scripts');

function run(cmd: string) {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env, PATH: process.env.PATH! },
  });
}

describe('deploy-refresh mechanism (DF-38)', () => {
  it('deploy-refresh.sh exists and is executable', () => {
    const script = join(SCRIPTS, 'deploy-refresh.sh');
    expect(existsSync(script)).toBe(true);
  });

  it('cron wrapper exists', () => {
    const wrapper = join(SCRIPTS, 'deploy-refresh-cron.sh');
    expect(existsSync(wrapper)).toBe(true);
  });

  it('script exits 0 when containers are fresh', () => {
    const result = run('bash scripts/deploy-refresh.sh');
    expect(result).toContain('fresh');
  });

  it('post-commit hook wires into deploy-refresh', () => {
    const hook = join(REPO_ROOT, '.git', 'hooks', 'post-commit');
    const content = require('fs').readFileSync(hook, 'utf-8');
    expect(content).toContain('deploy-refresh');
  });
});
