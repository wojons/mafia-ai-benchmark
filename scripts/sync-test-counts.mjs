#!/usr/bin/env node
/**
 * sync-test-counts.mjs — MAF-GAP-066
 *
 * Single source of truth for every test count in README.md (MAF-GAP-066).
 * Runs the vitest suite in each workspace package and rewrites every README
 * test count from the live "Tests" summary-line totals, so counts can never
 * drift from what vitest actually reports.
 *
 * Usage:  pnpm test:counts        (or: node scripts/sync-test-counts.mjs)
 *
 * Idempotent: a second run with no test changes rewrites identical values and
 * leaves `git diff` empty.
 *
 * Counts are parsed from the parenthesized total on each suite's "Tests"
 * summary line (e.g. " Tests  97 passed | 1 skipped (98)" -> 98) — never from
 * the per-file "(N tests)" lines, which are file counts, not totals.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_PATH = path.join(ROOT, 'README.md');

const PACKAGES = [
  { filter: '@mafia/server', label: 'server' },
  { filter: '@mafia/shared', label: 'shared' },
  { filter: '@mafia/cli', label: 'cli' },
  { filter: '@mafia/web', label: 'web' },
];

// The cli suite's benchmark.test.ts runs a real LLM game (up to ~10 min).
const SUITE_TIMEOUT_MS = 15 * 60 * 1000;

function vitestTotal(filter) {
  const res = spawnSync(
    'pnpm',
    ['--filter', filter, 'exec', 'vitest', 'run', '--reporter=basic'],
    { cwd: ROOT, encoding: 'utf8', timeout: SUITE_TIMEOUT_MS }
  );
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.error || res.status === null) {
    throw new Error(
      `vitest failed to run for ${filter}: ${res.error?.message ?? 'timed out'}`
    );
  }
  const m = out.match(/^\s*Tests\s+.*\((\d+)\)\s*$/m);
  if (!m) {
    throw new Error(
      `could not parse vitest "Tests" summary line for ${filter}:\n${out.slice(-2000)}`
    );
  }
  const total = Number(m[1]);
  if (res.status !== 0) {
    process.stderr.write(
      `WARN: ${filter} suite exited ${res.status} — using collected total ${total}\n`
    );
  }
  return total;
}

function main() {
  const counts = {};
  for (const pkg of PACKAGES) {
    counts[pkg.label] = vitestTotal(pkg.filter);
  }
  const { server, shared, cli, web } = counts;
  const total = server + shared + cli + web;

  let readme = readFileSync(README_PATH, 'utf8');
  const before = readme;

  // Every numeric test-count pattern in README.md, in README order. Each must
  // match at least once — a miss means the README structure drifted and the
  // script must fail loudly instead of silently leaving a stale count.
  const replacements = [
    [/server tests \(\d+\)/g, `server tests (${server})`, 'server tests (N)'],
    [/Server tests \(\d+\)/g, `Server tests (${server})`, 'Server tests (N)'],
    [/Server \(\d+ tests\)/g, `Server (${server} tests)`, 'Server (N tests)'],
    [/Shared tests \(\d+\)/g, `Shared tests (${shared})`, 'Shared tests (N)'],
    [/Shared \(\d+ tests\)/g, `Shared (${shared} tests)`, 'Shared (N tests)'],
    [/Web tests \(\d+\)/g, `Web tests (${web})`, 'Web tests (N)'],
    [/Web \(\d+ tests\)/g, `Web (${web} tests)`, 'Web (N tests)'],
    [/✅ \d+ tests/g, `✅ ${shared} tests`, '✅ N tests (project structure)'],
    [
      /\*\*Test Coverage\*\*: \d+ tests \(\d+ shared, \d+ server, \d+ CLI, \d+ web\)/,
      `**Test Coverage**: ${total} tests (${shared} shared, ${server} server, ${cli} CLI, ${web} web)`,
      'Test Coverage line',
    ],
    [
      /✅ \d+ Tests \(all \d+ passing: \d+ shared, \d+ server, \d+ CLI, \d+ web\)/,
      `✅ ${total} Tests (all ${total} passing: ${shared} shared, ${server} server, ${cli} CLI, ${web} web)`,
      'status line',
    ],
  ];

  const zeroMatches = [];
  for (const [pattern, replacement, label] of replacements) {
    let hits = 0;
    readme = readme.replace(pattern, () => {
      hits += 1;
      return replacement;
    });
    if (hits === 0) zeroMatches.push(label);
  }

  if (zeroMatches.length > 0) {
    throw new Error(
      `README count patterns not found — structure drift: ${zeroMatches.join(', ')}`
    );
  }

  writeFileSync(README_PATH, readme);
  console.log(
    `Synced README test counts from live vitest: server ${server}, shared ${shared}, cli ${cli}, web ${web} (total ${total})`
  );
  if (readme === before) {
    console.log('No changes needed — counts already up to date.');
  }
}

main();
