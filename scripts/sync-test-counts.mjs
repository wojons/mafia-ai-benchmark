#!/usr/bin/env node
/**
 * sync-test-counts.mjs — single source of truth for every test count in README.md
 * (MAF-GAP-066, repaired by README-013).
 *
 * Runs the vitest suite in each workspace package and rewrites every README test
 * count from the live "Tests" summary line, so the numbers on the page can never
 * drift from what vitest actually reports.
 *
 * Usage:
 *   pnpm test:counts                                  # rewrite README in place
 *   node scripts/sync-test-counts.mjs --dry-run       # print the rewrites, write nothing
 *   node scripts/sync-test-counts.mjs --check         # exit 1 when README is stale
 *
 * Honesty contract (README-013):
 *   - Every suite's split is parsed from its own summary line
 *     ("Tests  644 passed | 19 skipped (663)"), never from per-file "(N tests)"
 *     counts, which are file counts rather than totals.
 *   - The skipped figure is always stated explicitly on the page
 *     ("N of M Tests passing (K skipped)"). The old "all N passing" template is
 *     gone and `assertNoAllPassingClaim()` refuses to write it back.
 *   - If a summary line cannot yield a passed/skipped/total split the run fails
 *     loudly instead of assuming a suite skipped nothing.
 *
 * Idempotent: a second run over unchanged suites rewrites identical values and
 * leaves `git diff` empty.
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

// The cli suite's benchmark.test.ts can run a real LLM game (up to ~10 min).
const SUITE_TIMEOUT_MS = 15 * 60 * 1000;

// ANSI sequences vitest emits when the reporter is not writing to a TTY
// (FORCE_COLOR, CI colour support, pnpm's pipe handling). Stripped before any
// matching so "\u001b[32mTests\u001b[39m" parses like "Tests". The control
// characters are built at runtime (never written literally) because matching
// them is the entire point of this table.
const ESC = String.fromCharCode(0x1b); // ESC
const BEL = String.fromCharCode(0x07); // BEL
const C1_CSI = String.fromCharCode(0x9b); // 8-bit CSI
const ANSI_PATTERNS = [
  new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g'), // CSI (colours, cursor moves)
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'), // OSC (links, titles)
  new RegExp(`${ESC}[()][A-Za-z0-9]`, 'g'), // charset selection
  new RegExp(`${ESC}[=>]`, 'g'), // keypad modes
  new RegExp(`${C1_CSI}[0-?]*[ -/]*[@-~]`, 'g'), // 8-bit CSI
];

function stripAnsi(text) {
  let out = String(text ?? '');
  for (const pattern of ANSI_PATTERNS) out = out.replace(pattern, '');
  return out;
}

/**
 * Parse one suite result into { passed, failed, skipped, todo, total }.
 *
 * The summary line shapes vitest produces:
 *   "Tests  420 passed (420)"
 *   "Tests  644 passed | 19 skipped (663)"
 *   "Tests  1 failed | 115 passed | 1 skipped (116)"
 *
 * `total` is the parenthesized figure and `passed` is mandatory: without both
 * there is no split to publish, so the run fails instead of guessing zero.
 */
function parseSuiteSummary(filter, rawOutput) {
  const output = stripAnsi(rawOutput);
  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => /^[ \t]*Tests[ \t]+\S/.test(line));

  const line = lines.at(-1);
  if (!line) {
    throw new Error(
      `could not parse vitest "Tests" summary line for ${filter} — no summary line in output:\n${output.slice(-2000)}`
    );
  }

  const totalMatch = line.match(/\((\d+)\)[ \t]*$/);
  const passedMatch = line.match(/(\d+)[ \t]+passed/);
  if (!totalMatch || !passedMatch) {
    throw new Error(
      `vitest summary line for ${filter} has no usable passed/skipped split ` +
        `(need "N passed ... (TOTAL)"): "${line.trim()}" — refusing to assume a skip count`
    );
  }

  const failedMatch = line.match(/(\d+)[ \t]+failed/);
  const skippedMatch = line.match(/(\d+)[ \t]+skipped/);
  const todoMatch = line.match(/(\d+)[ \t]+todo/);

  const total = Number(totalMatch[1]);
  const passed = Number(passedMatch[1]);
  const failed = failedMatch ? Number(failedMatch[1]) : 0;
  const todo = todoMatch ? Number(todoMatch[1]) : 0;

  let skipped;
  if (skippedMatch) {
    skipped = Number(skippedMatch[1]);
  } else {
    // vitest omits "| 0 skipped" when nothing was skipped. That omission is
    // verified arithmetically against the reported total — it is not assumed.
    skipped = total - passed - failed - todo;
    if (skipped < 0) {
      throw new Error(
        `vitest summary line for ${filter} is inconsistent: "${line.trim()}" ` +
          `(passed ${passed} + failed ${failed} + todo ${todo} exceeds total ${total})`
      );
    }
    process.stderr.write(
      `note: ${filter} summary reports no "skipped" token — derived skipped=${skipped} ` +
        `from total-passed-failed-todo (${total}-${passed}-${failed}-${todo})\n`
    );
  }

  if (passed + failed + skipped + todo !== total) {
    throw new Error(
      `vitest summary line for ${filter} does not add up: "${line.trim()}" ` +
        `(passed ${passed} + failed ${failed} + skipped ${skipped} + todo ${todo} != total ${total})`
    );
  }

  return { passed, failed, skipped, todo, total, line: line.trim() };
}

function vitestSummary(filter) {
  const res = spawnSync(
    'pnpm',
    ['--filter', filter, 'exec', 'vitest', 'run', '--reporter=basic'],
    { cwd: ROOT, encoding: 'utf8', timeout: SUITE_TIMEOUT_MS }
  );
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.error || res.status === null) {
    throw new Error(
      `vitest failed to run for ${filter}: ${res.error?.message ?? 'timed out'}`
    );
  }
  const summary = parseSuiteSummary(filter, output);
  if (res.status !== 0) {
    process.stderr.write(
      `WARN: ${filter} suite exited ${res.status} — using its reported summary anyway ` +
        `(${summary.passed} passed, ${summary.skipped} skipped, ${summary.total} total)\n`
    );
  }
  return summary;
}

/** One "Tests  X passed | Y skipped (T)" summary line as vitest would print it. */
function renderSummaryLine(label, suite) {
  const parts = [];
  if (suite.failed > 0) parts.push(`${suite.failed} failed`);
  parts.push(`${suite.passed} passed`);
  if (suite.skipped > 0) parts.push(`${suite.skipped} skipped`);
  if (suite.todo > 0) parts.push(`${suite.todo} todo`);
  return `${label.padEnd(8)}Tests  ${parts.join(' | ')} (${suite.total})`;
}

/** Build the ordered list of README count sites and how each one renders. */
function buildSites(counts) {
  const { server, shared, cli, web } = counts;
  const total = server.total + shared.total + cli.total + web.total;
  const passed = server.passed + shared.passed + cli.passed + web.passed;
  const skipped = server.skipped + shared.skipped + cli.skipped + web.skipped;
  const tally = `${shared.total} shared, ${server.total} server, ${cli.total} CLI, ${web.total} web`;

  return [
    {
      label: 'hero feature bullet',
      pattern:
        /\*\*🧪 \d+ Tests\*\*: Comprehensive test coverage \(\d+ shared, \d+ server, \d+ CLI, \d+ web\)/g,
      render: () => `**🧪 ${total} Tests**: Comprehensive test coverage (${tally})`,
    },
    {
      label: 'Server Commands table',
      pattern: /Verify server tests \(\d+\)/g,
      render: () => `Verify server tests (${server.total})`,
    },
    {
      label: 'Root Commands — server',
      pattern: /# Server tests \(\d+\)/g,
      render: () => `# Server tests (${server.total})`,
    },
    {
      label: 'Root Commands — shared',
      pattern: /# Shared tests \(\d+\)/g,
      render: () => `# Shared tests (${shared.total})`,
    },
    // README-013: the CLI line inside the root-command block had no pattern at all.
    {
      label: 'Root Commands — CLI',
      pattern: /# CLI tests \(\d+\)/g,
      render: () => `# CLI tests (${cli.total})`,
    },
    {
      label: 'Root Commands — web',
      pattern: /# Web tests \(\d+\)/g,
      render: () => `# Web tests (${web.total})`,
    },
    {
      label: 'project structure — shared',
      pattern: /✅ \d+ tests/g,
      render: () => `✅ ${shared.total} tests`,
    },
    {
      label: 'Running Tests — server',
      pattern: /# Server \(\d+ tests\)/g,
      render: () => `# Server (${server.total} tests)`,
    },
    {
      label: 'Running Tests — shared',
      pattern: /# Shared \(\d+ tests\)/g,
      render: () => `# Shared (${shared.total} tests)`,
    },
    {
      label: 'Running Tests — CLI',
      pattern: /# CLI \(\d+ tests\)/g,
      render: () => `# CLI (${cli.total} tests)`,
    },
    {
      label: 'Running Tests — web',
      pattern: /# Web \(\d+ tests\)/g,
      render: () => `# Web (${web.total} tests)`,
    },
    {
      label: 'Test Coverage — collected counts',
      pattern:
        /\*\*Test Coverage\*\*: \d+ tests \(\d+ shared, \d+ server, \d+ CLI, \d+ web\)/g,
      render: () => `**Test Coverage**: ${total} tests (${tally})`,
    },
    {
      label: 'Test Coverage — passed/skipped split',
      pattern: /\*\*\d+ passing, \d+ skipped\*\*/g,
      render: () => `**${passed} passing, ${skipped} skipped**`,
    },
    {
      label: 'suite summary block — shared',
      pattern: /^shared[ \t]+Tests[ \t]+\d+ passed[^\n]*$/gm,
      render: () => renderSummaryLine('shared', shared),
    },
    {
      label: 'suite summary block — server',
      pattern: /^server[ \t]+Tests[ \t]+\d+ passed[^\n]*$/gm,
      render: () => renderSummaryLine('server', server),
    },
    {
      label: 'suite summary block — cli',
      pattern: /^cli[ \t]+Tests[ \t]+\d+ passed[^\n]*$/gm,
      render: () => renderSummaryLine('cli', cli),
    },
    {
      label: 'suite summary block — web',
      pattern: /^web[ \t]+Tests[ \t]+\d+ passed[^\n]*$/gm,
      render: () => renderSummaryLine('web', web),
    },
    {
      label: 'passing arithmetic sentence',
      pattern:
        /so the passing figure is `[^`]*` out of `[^`]*` collected, with the remaining \d+ skipped\./g,
      render: () =>
        'so the passing figure is `' +
        `${shared.passed} + ${server.passed} + ${cli.passed} + ${web.passed} = ${passed}` +
        '` out of `' +
        `${shared.total} + ${server.total} + ${cli.total} + ${web.total} = ${total}` +
        '` collected, with the remaining ' +
        `${skipped} skipped.`,
    },
    {
      label: 'Status line',
      pattern:
        /✅ \d+ of \d+ Tests passing \(\d+ skipped; \d+ shared, \d+ server, \d+ CLI, \d+ web\)/g,
      render: () =>
        `✅ ${passed} of ${total} Tests passing (${skipped} skipped; ${tally})`,
    },
  ];
}

/**
 * Apply every site. Returns the new text plus per-site hit/change records so
 * --dry-run and --check can name exactly which sites moved.
 */
function applySites(readme, counts) {
  const results = [];
  let out = readme;
  for (const site of buildSites(counts)) {
    let hits = 0;
    const changes = [];
    out = out.replace(site.pattern, (match) => {
      hits += 1;
      const next = site.render();
      if (next !== match) changes.push({ before: match, after: next });
      return next;
    });
    results.push({ label: site.label, hits, changes });
  }
  return { readme: out, results };
}

/**
 * Structural guard: the page must never make an unsplit "all N passing" claim.
 * Runs on the rendered text before anything is written so a future edit to the
 * replacement table (or a hand edit) cannot smuggle the old template back.
 */
function assertNoAllPassingClaim(readme) {
  const offenders = readme
    .split('\n')
    .filter((line) => /all\s+\d+\s+(?:tests\s+)?passing/i.test(line));
  if (offenders.length > 0) {
    throw new Error(
      `refusing to write a false "all passing" claim — the split must be explicit:\n${offenders.join('\n')}`
    );
  }
}

function main(argv) {
  const flags = new Set(argv);
  const known = new Set(['--dry-run', '--check']);
  for (const flag of flags) {
    if (!known.has(flag)) {
      throw new Error(`unknown argument "${flag}" — usage: sync-test-counts.mjs [--dry-run|--check]`);
    }
  }
  if (flags.has('--dry-run') && flags.has('--check')) {
    throw new Error('--dry-run and --check are mutually exclusive');
  }
  const dryRun = flags.has('--dry-run');
  const check = flags.has('--check');

  const counts = {};
  for (const pkg of PACKAGES) {
    counts[pkg.label] = vitestSummary(pkg.filter);
    console.log(`[${pkg.label}] ${counts[pkg.label].line}`);
  }

  const readme = readFileSync(README_PATH, 'utf8');
  const { readme: nextReadme, results } = applySites(readme, counts);

  const missing = results.filter((r) => r.hits === 0).map((r) => r.label);
  if (missing.length > 0) {
    throw new Error(
      `README count patterns not found — structure drift: ${missing.join(', ')}`
    );
  }

  assertNoAllPassingClaim(nextReadme);

  const changedSites = results.filter((r) => r.changes.length > 0);

  if (dryRun) {
    if (changedSites.length === 0) {
      console.log('--dry-run: README already matches live vitest output — nothing to rewrite.');
      return;
    }
    console.log(`--dry-run: would rewrite ${changedSites.length} site(s), writing nothing:`);
    for (const site of changedSites) {
      for (const { before, after } of site.changes) {
        console.log(`  - ${site.label}\n      from: ${before}\n      to:   ${after}`);
      }
    }
    return;
  }

  if (check) {
    if (changedSites.length > 0) {
      console.error(`--check: README is STALE at ${changedSites.length} site(s):`);
      for (const site of changedSites) {
        for (const { before, after } of site.changes) {
          console.error(`  - ${site.label}: ${before}  ->  ${after}`);
        }
      }
      process.exitCode = 1;
      return;
    }
    console.log('--check: README test counts match live vitest output.');
    return;
  }

  const { server, shared, cli, web } = counts;
  const total = server.total + shared.total + cli.total + web.total;
  const passed = server.passed + shared.passed + cli.passed + web.passed;
  const skipped = server.skipped + shared.skipped + cli.skipped + web.skipped;

  if (nextReadme === readme) {
    console.log(
      `No changes needed — counts already up to date (${passed} of ${total} passing, ` +
        `${skipped} skipped: server ${server.total}, shared ${shared.total}, ` +
        `cli ${cli.total}, web ${web.total}).`
    );
    return;
  }

  writeFileSync(README_PATH, nextReadme);
  console.log(
    `Synced README test counts from live vitest: ${passed} of ${total} passing, ` +
      `${skipped} skipped (server ${server.total}, shared ${shared.total}, ` +
      `cli ${cli.total}, web ${web.total}); rewrote ${changedSites.length} site(s): ` +
      changedSites.map((site) => site.label).join(', ')
  );
}

// Exported so the parsing rules can be probed directly (the generator itself
// runs only through the entrypoint guard below).
export { stripAnsi, parseSuiteSummary, renderSummaryLine, buildSites, applySites };

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
