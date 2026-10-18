import { execFileSync } from 'child_process';
import { join } from 'path';
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';

/**
 * DF-MAFIA-AI-BENCHMARK-38 — deploy-refresh mechanism tests.
 *
 * Behavioral: the script is driven against a TEMP stamp file via the
 * DEPLOY_REFRESH_STAMP override, so these tests never read or write the live
 * .deploy-stamp and never require docker (CI has none). The dry-run flag is
 * used for drift-arm assertions so no build is ever triggered.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'deploy-refresh.sh');

interface RunResult {
  status: number;
  stdout: string;
}

function runRefresh(envOverrides: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

function makeTempStampDir(): string {
  return mkdtempSync(join(tmpdir(), 'deploy-refresh-test-'));
}

function currentHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).trim();
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe('deploy-refresh mechanism (DF-MAFIA-AI-BENCHMARK-38)', () => {
  it('script exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(isExecutable(SCRIPT)).toBe(true);
  });

  it('exits 0 and does nothing when stamp matches HEAD (no drift)', () => {
    const dir = makeTempStampDir();
    const stampPath = join(dir, 'stamp');
    try {
      const head = currentHeadSha();
      writeFileSync(stampPath, `${head}\n`);
      const r = runRefresh({ DEPLOY_REFRESH_STAMP: stampPath });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('no rebuild needed');
      expect(readFileSync(stampPath, 'utf-8').trim()).toBe(head);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent: two consecutive no-drift runs both exit 0 and leave the stamp', () => {
    const dir = makeTempStampDir();
    const stampPath = join(dir, 'stamp');
    try {
      const head = currentHeadSha();
      writeFileSync(stampPath, `${head}\n`);
      const r1 = runRefresh({ DEPLOY_REFRESH_STAMP: stampPath });
      const r2 = runRefresh({ DEPLOY_REFRESH_STAMP: stampPath });
      expect(r1.status).toBe(0);
      expect(r2.status).toBe(0);
      expect(r1.stdout).toContain('no rebuild needed');
      expect(r2.stdout).toContain('no rebuild needed');
      expect(readFileSync(stampPath, 'utf-8').trim()).toBe(head);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects drift (stale stamp) and plans a rebuild — dry run never touches docker or the stamp', () => {
    const dir = makeTempStampDir();
    const stampPath = join(dir, 'stamp');
    try {
      const stale = 'a'.repeat(40);
      writeFileSync(stampPath, `${stale}\n`);
      const r = runRefresh({
        DEPLOY_REFRESH_STAMP: stampPath,
        DEPLOY_REFRESH_DRY_RUN: '1',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('drift detected');
      expect(r.stdout).toContain('would run: docker compose build server web');
      expect(readFileSync(stampPath, 'utf-8').trim()).toBe(stale);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a missing stamp file as drift (first deploy after clone)', () => {
    const dir = makeTempStampDir();
    try {
      const r = runRefresh({
        DEPLOY_REFRESH_STAMP: join(dir, 'does-not-exist'),
        DEPLOY_REFRESH_DRY_RUN: '1',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('no valid stamp');
      expect(r.stdout).toContain('would run: docker compose build server web');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cron wrapper exists, is executable, and execs the real script', () => {
    const wrapper = join(REPO_ROOT, 'scripts', 'deploy-refresh-cron.sh');
    expect(existsSync(wrapper)).toBe(true);
    expect(isExecutable(wrapper)).toBe(true);
    const content = readFileSync(wrapper, 'utf-8');
    expect(content).toContain('deploy-refresh.sh');
  });

  it('docs/DEPLOY-REFRESH.md documents the mechanism and the installed wiring', () => {
    const doc = join(REPO_ROOT, 'docs', 'DEPLOY-REFRESH.md');
    expect(existsSync(doc)).toBe(true);
    const content = readFileSync(doc, 'utf-8');
    expect(content).toContain('.deploy-stamp');
    expect(content).toContain('mafia-deploy-refresh.timer');
    expect(content).toContain('docker compose build server web');
  });

  it('.deploy-stamp is gitignored (runtime state never committed)', () => {
    const out = execFileSync('git', ['check-ignore', '-v', '.deploy-stamp'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(out).toContain('.gitignore');
  });
});
