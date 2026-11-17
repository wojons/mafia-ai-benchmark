/**
 * Falsifiability suite for scripts/check-usage-skill-coaching.mjs
 * (DF-MAFIA-AI-BENCHMARK-49).
 *
 * A drift guard that has only ever run against a clean tree proves nothing, so
 * every arm here is exercised in BOTH directions: the real tree passes, an
 * injected stale claim reds it, deleting the claim greens it again; a cited id
 * that is not complete reds the citation arm, a board where every cited id is
 * complete passes. All mutations happen on temp copies — the repo's skill and
 * board are only ever read.
 *
 * Run: node --test scripts/check-usage-skill-coaching.test.mjs
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(ROOT, 'scripts', 'check-usage-skill-coaching.mjs');
const SKILL = path.join(ROOT, 'skills', 'mafia-usage', 'SKILL.md');
const BOARD = path.join(ROOT, '.coding-hermes', 'board', 'tasks.jsonl');

const CITED_IDS = [
  'DF-MAFIA-AI-BENCHMARK-10',
  'DF-MAFIA-AI-BENCHMARK-11',
  'DF-MAFIA-AI-BENCHMARK-34',
  'DF-MAFIA-AI-BENCHMARK-35',
];

const ORIGINAL_SKILL = readFileSync(SKILL, 'utf8');
const ORIGINAL_BOARD_ROWS = readFileSync(BOARD, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line));

const TMP = mkdtempSync(path.join(os.tmpdir(), 'usage-skill-guard-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

function runGuard(args) {
  const result = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

let fixtureCounter = 0;
function tempFile(name, contents) {
  fixtureCounter += 1;
  const file = path.join(TMP, `${fixtureCounter}-${name}`);
  writeFileSync(file, contents);
  return file;
}

function boardFixture(statusOverrides, rows = ORIGINAL_BOARD_ROWS) {
  const mutated = rows.map((row) =>
    Object.hasOwn(statusOverrides, row.id) ? { ...row, status: statusOverrides[row.id] } : row
  );
  return tempFile('board.jsonl', `${mutated.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

// --- (a) the real tree is clean, and the run is not vacuous ------------------
test('real tree: clean run exits 0 and actually scanned the skill and board', () => {
  const { code, stdout, stderr } = runGuard(['--json']);
  assert.equal(stderr, '', 'checker should not write to stderr on a clean tree');
  assert.equal(code, 0, `expected exit 0 on the real tree, got ${code}\n${stdout}`);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.findings, []);
  assert.ok(payload.checks.blocksScanned > 0, 'the checker must have scanned the skill (a vacuous pass is not a pass)');
  assert.ok(payload.checks.forbiddenClaims.length >= 2, 'the declarative claim table must carry the contract-drift rules');
  assert.equal(payload.checks.citedIds.length, CITED_IDS.length, 'every closed-defect id the skill cites must be resolved');
  for (const cited of payload.checks.citedIds) {
    assert.equal(cited.ok, true, `${cited.id} should be complete on the real board`);
  }
});

// --- (b) (c) the forbidden sentence is caught, then can be removed -----------
test('injected "omits the mock-game count" reds the guard and names the phrase', () => {
  const drift = tempFile(
    'skill-drift.md',
    `${ORIGINAL_SKILL}\n\n## Stale coaching (injected by the test)\n\nThe report omits the mock-game count.\n`
  );
  const { code, stdout } = runGuard(['--skill', drift]);
  assert.equal(code, 1, `expected exit 1 for the injected claim, got ${code}\n${stdout}`);
  assert.match(stdout, /omits the mock-game count/, 'output must quote the offending phrase');
  assert.match(stdout, /\[contract-drift\] report-hides-mock-count/);
  assert.match(stdout, /skill-drift\.md:\d+:/, 'output must name file:line');
});

test('removing the injected sentence returns the same copy to a clean run', () => {
  const copy = tempFile('skill-restored.md', `${ORIGINAL_SKILL}\n\nThe report omits the mock-game count.\n`);
  assert.equal(runGuard(['--skill', copy]).code, 1, 'premise: the drift copy must red the guard');

  writeFileSync(copy, ORIGINAL_SKILL);
  const { code, stdout } = runGuard(['--skill', copy]);
  assert.equal(code, 0, `expected exit 0 after removing the sentence, got ${code}\n${stdout}`);
  assert.match(stdout, /usage-skill coaching guard: OK/);
});

test('close variants of the omission claim are covered by the table', () => {
  const variants = [
    'The report does not state the full mock-game population.',
    'The population buckets do not sum to totalGames.',
    'The report summary has no `population` object.',
    'The population excludes mock games entirely.',
  ];
  for (const sentence of variants) {
    const copy = tempFile('skill-variant.md', `${ORIGINAL_SKILL}\n\n## Variant\n\n${sentence}\n`);
    const { code, stdout } = runGuard(['--skill', copy]);
    assert.equal(code, 1, `expected exit 1 for "${sentence}", got ${code}\n${stdout}`);
    assert.match(stdout, /\[contract-drift\]/);
  }
});

test('the corrected passage shape is not flagged (retirement guard)', () => {
  const copy = tempFile(
    'skill-retired.md',
    `${ORIGINAL_SKILL}\n\n## Correction\n\nThe old note that the report omits the mock-game count is retired.\n`
  );
  const { code, stdout } = runGuard(['--skill', copy]);
  assert.equal(code, 0, `a sentence retiring the claim must stay clean, got ${code}\n${stdout}`);
});

// --- (d) (e) stale-citation arm, both directions ----------------------------
test('a cited id that is not complete reds the guard and names the id and status', () => {
  // Premise: the real board says -34 is complete, so only the fixture differs.
  const realRow = ORIGINAL_BOARD_ROWS.find((row) => row.id === 'DF-MAFIA-AI-BENCHMARK-34');
  assert.ok(realRow, 'premise: the real board must carry DF-MAFIA-AI-BENCHMARK-34');
  assert.equal(realRow.status, 'complete', 'premise: DF-MAFIA-AI-BENCHMARK-34 is complete in the real board');

  const board = boardFixture({ 'DF-MAFIA-AI-BENCHMARK-34': 'pending' });
  const fixtureRow = readFileSync(board, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((row) => row.id === 'DF-MAFIA-AI-BENCHMARK-34');
  assert.equal(fixtureRow.status, 'pending', 'premise: the fixture really downgrades the cited id');

  const { code, stdout } = runGuard(['--board', board]);
  assert.equal(code, 1, `expected exit 1 for the pending citation, got ${code}\n${stdout}`);
  assert.match(stdout, /\[stale-citation\] DF-MAFIA-AI-BENCHMARK-34/);
  assert.match(stdout, /status "pending"/);
  assert.match(stdout, /SKILL\.md:\d+:/, 'the finding must point at the citing line in the skill');
});

test('a board where every cited id is complete passes', () => {
  const minimalRows = CITED_IDS.map((id) => ({ id, status: 'complete' }));
  assert.equal(minimalRows.length, CITED_IDS.length);
  const board = tempFile('board-complete.jsonl', `${minimalRows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const { code, stdout } = runGuard(['--board', board, '--json']);
  assert.equal(code, 0, `expected exit 0 when every cited id is complete, got ${code}\n${stdout}`);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.checks.citedIds.length, CITED_IDS.length);
});

test('a cited id missing from the board is a stale citation, not a pass', () => {
  const board = tempFile('board-minimal.jsonl', `${JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-10', status: 'complete' })}\n`);
  const { code, stdout } = runGuard(['--board', board]);
  assert.equal(code, 1, `an unresolvable citation must fail closed, got ${code}\n${stdout}`);
  assert.match(stdout, /no board row has that id/);
});

test('the elided list form ("-10, -11, and -35") is expanded into citations', () => {
  const skill = tempFile(
    'skill-elided.md',
    '# Synthetic skill\n\nThe closed defects DF-MAFIA-AI-BENCHMARK-10, -11, and -35 must not be reported as open.\n'
  );
  const pendingBoard = tempFile(
    'board-elided.jsonl',
    [
      JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-10', status: 'complete' }),
      JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-11', status: 'complete' }),
      JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-35', status: 'pending' }),
    ].join('\n') + '\n'
  );

  const stale = runGuard(['--skill', skill, '--board', pendingBoard]);
  assert.equal(stale.code, 1, `elided citation must be resolved, got ${stale.code}\n${stale.stdout}`);
  assert.match(stale.stdout, /\[stale-citation\] DF-MAFIA-AI-BENCHMARK-35/);

  const completeBoard = tempFile(
    'board-elided-complete.jsonl',
    [
      JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-10', status: 'complete' }),
      JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-11', status: 'complete' }),
      JSON.stringify({ id: 'DF-MAFIA-AI-BENCHMARK-35', status: 'complete' }),
    ].join('\n') + '\n'
  );
  const clean = runGuard(['--skill', skill, '--board', completeBoard]);
  assert.equal(clean.code, 0, `all-complete elided citations must pass, got ${clean.code}\n${clean.stdout}`);
});

// --- CLI contract: --dry-run, --json, fail-closed ---------------------------
test('--dry-run reports findings but still exits 0', () => {
  const copy = tempFile('skill-dryrun.md', `${ORIGINAL_SKILL}\n\nThe report omits the mock-game count.\n`);
  const { code, stdout } = runGuard(['--skill', copy, '--dry-run']);
  assert.equal(code, 0, `--dry-run must exit 0, got ${code}\n${stdout}`);
  assert.match(stdout, /\[contract-drift\]/, '--dry-run must still print the finding');
});

test('--json is machine-readable and fails closed without --dry-run', () => {
  const copy = tempFile('skill-json.md', `${ORIGINAL_SKILL}\n\nThe report omits the mock-game count.\n`);
  const { code, stdout } = runGuard(['--skill', copy, '--json']);
  assert.equal(code, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.exitCode, 1);
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0].kind, 'contract-drift');
  assert.equal(payload.findings[0].id, 'report-hides-mock-count');
  assert.ok(payload.findings[0].line > 0);
  assert.match(payload.findings[0].contractRef, /benchmark\/report/);
});

test('an unreadable skill or board fails closed with exit 2', () => {
  const missingSkill = runGuard(['--skill', path.join(TMP, 'does-not-exist.md')]);
  assert.equal(missingSkill.code, 2, 'a missing skill file must never be a silent pass');
  assert.match(missingSkill.stderr, /ERROR — cannot read/);

  const missingBoard = runGuard(['--board', path.join(TMP, 'no-board.jsonl')]);
  assert.equal(missingBoard.code, 2, 'a missing board must never be a silent pass');
  assert.match(missingBoard.stderr, /ERROR — cannot read/);
});

test('an unknown flag is a usage error, not a silent pass', () => {
  const { code, stderr } = runGuard(['--nope']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown argument: --nope/);
});
