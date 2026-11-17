#!/usr/bin/env node
/**
 * check-usage-skill-coaching.mjs — DF-MAFIA-AI-BENCHMARK-49
 *
 * WHY THIS EXISTS
 * ---------------
 * skills/mafia-usage/SKILL.md is coaching prose: it tells an agent what the
 * running benchmark API does and which defects are closed. Prose has no
 * compiler, so it rots silently — and it already did. The skill taught that
 * GET /api/v1/benchmark/report "omits the mock-game count": true on
 * 2026-10-23, false the moment DF-MAFIA-AI-BENCHMARK-41-R2 published
 * `summary.mockGames` alongside a `summary.population` object whose buckets
 * reconcile to `totalGames` (apps/server/src/services/stats-collector/index.ts,
 * pinned by apps/server/src/__tests__/services/benchmark-report-population.test.ts).
 * The sentence was corrected by hand; nothing tied it to the contract, so the
 * next contract change would rot it again.
 *
 * This checker is that tie. It is static — it reads two tracked files and
 * needs no server, no build and no install:
 *
 *   FLAG A — contract drift. FORBIDDEN_CLAIMS below is a small declarative
 *            table: each entry names one claim the skill must never make
 *            again, why it is false, and which contract supersedes it. A
 *            future stale claim earns exactly ONE new table line.
 *   FLAG B — stale citation. Every `DF-MAFIA-AI-BENCHMARK-<n>` id mentioned
 *            anywhere in the skill must have status "complete" in the tracked
 *            board, because "this defect is closed" is only safe while the
 *            board agrees. The elided list form the skill actually uses
 *            ("DF-MAFIA-AI-BENCHMARK-10, -11, -34, and -35") is expanded, so a
 *            citation cannot hide behind shorthand.
 *
 * Prose is matched per markdown block, not per line: a claim may wrap. A block
 * that also carries a retirement/denial marker ("retired", "no longer", "must
 * not", "instead of assuming", ...) is skipped, because that is prose telling
 * the reader the claim is dead — that is the shape of the corrected passage,
 * not a regression.
 *
 * Usage:
 *   node scripts/check-usage-skill-coaching.mjs [options]
 *     --skill <path>   skill markdown to check (default skills/mafia-usage/SKILL.md)
 *     --board <path>   JSONL board to read    (default .coding-hermes/board/tasks.jsonl)
 *     --dry-run        report findings, still exit 0
 *     --json           machine-readable output (still fails closed unless --dry-run)
 *     --help           this text
 *
 * Exit codes: 0 clean (or --dry-run), 1 findings, 2 could not check (fail closed).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SKILL = path.join(ROOT, 'skills', 'mafia-usage', 'SKILL.md');
const DEFAULT_BOARD = path.join(ROOT, '.coding-hermes', 'board', 'tasks.jsonl');

const CONTRACT_REPORT =
  'GET /api/v1/benchmark/report summary publishes mockGames + population{totalGames,completedGames,mockGames,inProgress,failedGames,cancelledGames} ' +
  '(apps/server/src/services/stats-collector/index.ts; pinned by apps/server/src/__tests__/services/benchmark-report-population.test.ts, DF-MAFIA-AI-BENCHMARK-41-R2)';

/**
 * FLAG A — forbidden coaching claims.
 *
 * Add one entry per stale claim the skill must never make again. `pattern` runs
 * against a whole markdown block (claims wrap); `why` and `contractRef` are the
 * explanation an editor reads when the guard reds. Keep patterns narrow: a
 * claim this table does not name is allowed.
 */
export const FORBIDDEN_CLAIMS = [
  {
    id: 'report-hides-mock-count',
    pattern:
      /\b(?:omits?|omitting|omitted|excludes?|excluding|excluded|hides?|hiding|hidden|drops?|dropping|dropped|leaves? out|leaving out|does not (?:state|report|publish|expose|include|declare|show)|doesn't (?:state|report|publish|expose|include|declare|show))\b[^.;]{0,90}?\bmock(?:[-\s]?games?)?\b[^.;]{0,70}?\b(?:count|counts|population|number|total|totals)\b/i,
    why: 'The report summary publishes the mock-game count in mockGames and repeats it inside the population object, so no report surface hides or omits it.',
    contractRef: CONTRACT_REPORT,
  },
  {
    id: 'population-excludes-mock-games',
    pattern:
      /\b(?:population|totalGames|census)\b[^.;]{0,90}?\b(?:excludes?|excluding|excluded|omits?|omitting|ignores?|ignoring|leaves? out|without|does not (?:include|count|cover|declare)|doesn't (?:include|count|cover|declare))\b[^.;]{0,60}?\bmock(?:[-\s]?games?)?\b/i,
    why: 'mockGames is one of the population buckets; the census is not mock-free and a sentence claiming otherwise is stale.',
    contractRef: CONTRACT_REPORT,
  },
  {
    id: 'population-buckets-do-not-sum',
    pattern:
      /\b(?:buckets?|population|breakdown|census)\b[^.;]{0,90}?\b(?:do(?:es)? ?not|doesn'?t|don'?t|never|cannot|can'?t|no longer)\b[^.;]{0,50}?\bsums?\b[^.;]{0,50}?\btotalGames\b/i,
    why: 'The buckets are disjoint by construction (cancelled rows are split out of the legacy failedGames bucket), so they reconcile exactly to totalGames; claiming they do not is a stale read of the pre-DF-MAFIA-AI-BENCHMARK-41-R2 surface.',
    contractRef: CONTRACT_REPORT,
  },
  {
    id: 'report-summary-has-no-population',
    pattern:
      /\b(?:report|summary|benchmark\/report|api\/v1\/benchmark\/report)\b[^.;]{0,90}?\b(?:has no|have no|had no|lacks?|lacking|is missing|are missing|omits?|omitting|without|does not (?:declare|publish|include|expose|contain)|doesn't (?:declare|publish|include|expose|contain))\b[^.;]{0,70}?\bpopulation\b/i,
    why: 'summary.population exists and declares every bucket; a claim that the summary has no population object is the retired pre-41-R2 shape.',
    contractRef: CONTRACT_REPORT,
  },
];

/**
 * A block that says the claim is dead is the correction, not a regression:
 * "the old \"the report hides the mock count\" note is retired".
 */
const RETIREMENT_MARKERS =
  /\b(?:retired|retires|no longer|not true|is false|was true|superseded|corrected|obsolete|withdrawn|must not|should not|do not assume|don't assume|instead of assuming)\b/i;

/** Full ids, including the `-R<n>` rework suffix and the `36b` style suffix. */
const CITATION_RE = /DF-MAFIA-AI-BENCHMARK-(\d+[A-Za-z]?(?:-R\d+)?)/g;
/** `, -11` / `, and -35` / `, DF-MAFIA-AI-BENCHMARK-36b` continuations of an id list. */
const CONTINUATION_RE = /^\s*,\s*(?:and\s+)?(?:DF-MAFIA-AI-BENCHMARK-|-)(\d+[A-Za-z]?(?:-R\d+)?)(?![0-9A-Za-z])/;

function displayPath(p) {
  const rel = path.relative(ROOT, p);
  return rel && !rel.startsWith('..') ? rel : p;
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    const e = new Error(`cannot read ${displayPath(file)}: ${err.message}`);
    e.code = 'UNREADABLE_INPUT';
    throw e;
  }
}

/**
 * Split a document into scannable blocks: a block ends at a sentence
 * terminator, at a blank line, or where a new markdown block starts, so a
 * wrapped sentence stays whole while neighbouring bullets/headings never merge.
 */
export function blocksOf(text) {
  const lines = text.split('\n');
  const startsBlock = (line) => /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\||```|~~~)/.test(line);
  const endsSentence = (line) => /[.!?]["')\]`]*\s*$/.test(line);

  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === '') {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    const previous = current ? current.lines[current.lines.length - 1] : null;
    if (!current || startsBlock(line) || endsSentence(previous)) {
      if (current) blocks.push(current);
      current = { startLine: lineNo, lines: [] };
    }
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ startLine: b.startLine, text: b.lines.join('\n') }));
}

function lineOfIndex(block, index) {
  let line = block.startLine;
  for (let i = 0; i < index; i++) if (block.text[i] === '\n') line++;
  return line;
}

/** FLAG A: forbidden claims, per block, minus blocks that retire the claim. */
export function findForbiddenClaims(skillText, skillFile) {
  const findings = [];
  for (const block of blocksOf(skillText)) {
    if (RETIREMENT_MARKERS.test(block.text)) continue;
    for (const claim of FORBIDDEN_CLAIMS) {
      const match = claim.pattern.exec(block.text);
      if (!match) continue;
      const snippet = match[0].replace(/\s+/g, ' ').trim();
      findings.push({
        kind: 'contract-drift',
        id: claim.id,
        file: skillFile,
        line: lineOfIndex(block, match.index),
        message: `forbidden claim matched "${snippet.length > 140 ? `${snippet.slice(0, 137)}...` : snippet}" — ${claim.why}`,
        contractRef: claim.contractRef,
      });
      break; // one finding per claim id per block keeps the report readable
    }
  }
  return findings;
}

/**
 * Every cited benchmark id, with its citation lines. Handles the elided list
 * form ("DF-MAFIA-AI-BENCHMARK-10, -11, and -35") so shorthand cannot hide a
 * stale citation.
 */
export function citationsInSkill(skillText) {
  const cited = new Map();
  const add = (id, lineNo) => {
    const entry = cited.get(id) ?? { id, lines: [] };
    if (!entry.lines.includes(lineNo)) entry.lines.push(lineNo);
    cited.set(id, entry);
  };

  skillText.split('\n').forEach((line, index) => {
    const lineNo = index + 1;
    CITATION_RE.lastIndex = 0;
    let match;
    while ((match = CITATION_RE.exec(line)) !== null) {
      add(`DF-MAFIA-AI-BENCHMARK-${match[1]}`, lineNo);
      let rest = line.slice(CITATION_RE.lastIndex);
      let continuation;
      while ((continuation = CONTINUATION_RE.exec(rest)) !== null) {
        add(`DF-MAFIA-AI-BENCHMARK-${continuation[1]}`, lineNo);
        rest = rest.slice(continuation[0].length);
      }
    }
  });

  return [...cited.values()].sort((a, b) => a.lines[0] - b.lines[0] || a.id.localeCompare(b.id));
}

/** id -> status. JSONL is an append log, so the last row for an id wins. */
export function readBoardStatus(boardText) {
  const status = new Map();
  const badLines = [];
  boardText.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row.id === 'string') {
        status.set(row.id, { status: String(row.status ?? ''), line: index + 1 });
      }
    } catch {
      badLines.push(index + 1);
    }
  });
  return { status, badLines };
}

/** FLAG B: every cited id must be complete on the board. */
export function findStaleCitations(skillText, skillFile, boardText, boardFile) {
  const { status, badLines } = readBoardStatus(boardText);
  const findings = badLines.map((line) => ({
    kind: 'board-unreadable',
    id: 'board-parse',
    file: boardFile,
    boardFile,
    line,
    message: 'board line is not valid JSON, so citation status cannot be trusted (fail closed)',
  }));

  const citations = citationsInSkill(skillText).map((citation) => {
    const boardRow = status.get(citation.id);
    const citationStatus = boardRow ? boardRow.status : 'missing';
    const ok = citationStatus === 'complete';
    if (!ok) {
      findings.push({
        kind: 'stale-citation',
        id: citation.id,
        file: skillFile,
        boardFile,
        line: citation.lines[0],
        status: citationStatus,
        message: boardRow
          ? `cited as a closed defect but the board says status "${citationStatus}" (expected "complete"); cited on line(s) ${citation.lines.join(', ')}`
          : `cited as a closed defect but no board row has that id (expected status "complete"); cited on line(s) ${citation.lines.join(', ')}`,
      });
    }
    return { ...citation, status: citationStatus, ok };
  });

  return { findings, citations };
}

export function check({ skillFile, boardFile }) {
  const skillText = readText(skillFile);
  const boardText = readText(boardFile);
  const claimFindings = findForbiddenClaims(skillText, skillFile);
  const { findings: citationFindings, citations } = findStaleCitations(skillText, skillFile, boardText, boardFile);
  const findings = [...claimFindings, ...citationFindings].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
  return {
    ok: findings.length === 0,
    skillFile,
    boardFile,
    findings,
    checks: {
      forbiddenClaims: FORBIDDEN_CLAIMS.map((claim) => claim.id),
      blocksScanned: blocksOf(skillText).length,
      citedIds: citations,
    },
  };
}

export function formatFinding(finding) {
  const where = `${displayPath(finding.file)}:${finding.line}`;
  if (finding.kind === 'contract-drift') {
    return `${where}: [contract-drift] ${finding.id} — ${finding.message} [contract: ${finding.contractRef}]`;
  }
  if (finding.kind === 'stale-citation') {
    return `${where}: [stale-citation] ${finding.id} ${finding.message} [board: ${displayPath(finding.boardFile)}]`;
  }
  return `${where}: [${finding.kind}] ${finding.id} — ${finding.message}`;
}

function parseArgs(argv) {
  const options = { skill: DEFAULT_SKILL, board: DEFAULT_BOARD, dryRun: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skill' || arg === '--board') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a path`);
      options[arg === '--skill' ? 'skill' : 'board'] = path.resolve(value);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    'usage: node scripts/check-usage-skill-coaching.mjs [--skill <path>] [--board <path>] [--dry-run] [--json]',
    '',
    '  --skill <path>  skill markdown to check (default skills/mafia-usage/SKILL.md)',
    '  --board <path>  JSONL board to read    (default .coding-hermes/board/tasks.jsonl)',
    '  --dry-run       report findings, exit 0',
    '  --json          machine-readable output',
    '',
    'exit: 0 clean (or --dry-run), 1 findings, 2 could not check',
  ].join('\n');
}

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`usage-skill coaching guard: ERROR — ${err.message}\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  let result;
  try {
    result = check({ skillFile: options.skill, boardFile: options.board });
  } catch (err) {
    process.stderr.write(`usage-skill coaching guard: ERROR — ${err.message}\n`);
    return 2;
  }

  const exitCode = result.ok || options.dryRun ? 0 : 1;

  if (options.json) {
    const payload = {
      ok: result.ok,
      dryRun: options.dryRun,
      exitCode,
      skill: displayPath(result.skillFile),
      board: displayPath(result.boardFile),
      findings: result.findings.map((finding) => ({
        kind: finding.kind,
        id: finding.id,
        file: displayPath(finding.file),
        line: finding.line,
        status: finding.status,
        message: finding.message,
        contractRef: finding.contractRef,
      })),
      checks: result.checks,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return exitCode;
  }

  for (const finding of result.findings) process.stdout.write(`${formatFinding(finding)}\n`);

  const cited = result.checks.citedIds;
  const complete = cited.filter((citation) => citation.ok).length;
  const verdict = result.ok ? 'OK' : 'FAIL';
  const dryRunNote = options.dryRun && !result.ok ? ', dry-run so exit 0' : '';
  process.stdout.write(
    `usage-skill coaching guard: ${verdict} — ${result.findings.length} finding(s); ` +
      `${result.checks.forbiddenClaims.length} forbidden-claim rules over ${result.checks.blocksScanned} blocks; ` +
      `${complete}/${cited.length} cited ids complete${dryRunNote}\n` +
      `  skill: ${displayPath(result.skillFile)}\n  board: ${displayPath(result.boardFile)}\n`
  );
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
