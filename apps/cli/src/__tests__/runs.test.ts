/**
 * Tests for the per-run JSONL run-record corpus (MAF-LAYER-1).
 *
 * Deterministic parts (header shaping, event ordering, serialization
 * idempotency, index dedup) are unit-tested with fixtures — no live LLM
 * game and no live server are required. File-state behavior runs against a
 * temp data dir with a stubbed global fetch serving the REST payloads the
 * export path consumes (GET /api/v1/games/:id + /replay).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import * as http from 'http';
import { spawn } from 'child_process';

import type { ApiEvent, ApiGameDetail } from '../runs-format.js';
import {
  buildIndexEntry,
  buildRunRecord,
  deriveRunProvenance,
  orderEvents,
  projectEvent,
  serializeIndexLine,
  serializeRunFile,
} from '../runs-format.js';
import { exportGame, RunsCommand, withIndexLock } from '../commands/runs.js';

// ---------- fixtures ----------

function makeGame(overrides: Partial<ApiGameDetail> = {}): ApiGameDetail {
  return {
    id: 'game-1',
    createdAt: '2026-11-21T01:35:30.657Z',
    startedAt: null,
    endedAt: '2026-11-21T01:37:27.433Z',
    status: 'ENDED',
    winner: 'TOWN',
    players: [
      { id: 'p2', name: 'B', role: 'DOCTOR', isAlive: true, isMafia: false, joinOrder: 1, won: 1, provider: 'openai', model: 'openai/gpt-4o-mini' },
      { id: 'p1', name: 'A', role: 'MAFIA', isAlive: false, isMafia: true, joinOrder: 0, won: 0, provider: 'openai', model: 'openai/gpt-4o-mini' },
    ],
    ...overrides,
  };
}

function makeEvent(id: string, ts: string, sequence: number, overrides: Partial<ApiEvent> = {}): ApiEvent {
  return {
    id,
    type: 'VOTE_CAST',
    timestamp: ts,
    actorId: 'p1',
    visibility: 'PUBLIC',
    data: { targetId: 'p2' },
    metadata: { sequence, turnNumber: 1, dayNumber: 1, phase: 'DAY_VOTING' },
    ...overrides,
  };
}

// ---------- header shaping ----------

describe('buildRunRecord (header shaping)', () => {
  it('line-1 header carries game_id/started_at/ended_at/num_players/winner', () => {
    const record = buildRunRecord(makeGame());
    expect(record.game_id).toBe('game-1');
    // Legacy games never record startedAt -> createdAt stands in.
    expect(record.started_at).toBe('2026-11-21T01:35:30.657Z');
    expect(record.ended_at).toBe('2026-11-21T01:37:27.433Z');
    expect(record.num_players).toBe(2);
    expect(record.winner).toBe('TOWN');
  });

  it('labels a fully attributed single-model run provenance=single (MAF-INIT-001)', () => {
    const record = buildRunRecord(makeGame());
    expect(record.provenance).toBe('single');
  });

  it('labels a fully attributed multi-model run provenance=mixed (MAF-INIT-001)', () => {
    const game = makeGame();
    game.players[1] = { ...game.players[1], model: 'openai/gpt-4o' };
    const record = buildRunRecord(game);
    expect(record.provenance).toBe('mixed');
  });

  it('labels a run with ANY unattributed seat provenance=unknown — never invented (MAF-INIT-001)', () => {
    // The historical 18/200 corpus shape: one seat without provider+model.
    const game = makeGame();
    game.players[1] = { ...game.players[1], provider: undefined, model: undefined };
    const record = buildRunRecord(game);
    expect(record.provenance).toBe('unknown');
    // No attribution is fabricated for the unattributed seat.
    expect(record.seats[0].provider).toBeNull();
    expect(record.seats[0].model).toBeNull();
  });

  it('carries the label onto the index entry too (MAF-INIT-001)', () => {
    const record = buildRunRecord(makeGame());
    const entry = buildIndexEntry(record, 'game-1.jsonl');
    expect(entry.provenance).toBe('single');
  });

  it('deriveRunProvenance is unknown for an empty seat list', () => {
    expect(deriveRunProvenance([])).toBe('unknown');
  });

  it('orders seats by joinOrder and numbers them 1-based', () => {
    const record = buildRunRecord(makeGame());
    expect(record.seats.map((s) => s.seat)).toEqual([1, 2]);
    expect(record.seats.map((s) => s.player_id)).toEqual(['p1', 'p2']);
  });

  it('shapes each seat: provider/model, survived, won', () => {
    const record = buildRunRecord(makeGame());
    expect(record.seats[0]).toEqual({
      seat: 1, player_id: 'p1', provider: 'openai', model: 'openai/gpt-4o-mini',
      role: 'MAFIA', survived: false, won: 0,
    });
    expect(record.seats[1].survived).toBe(true);
  });

  it('derives won from winner x isMafia when the API omits the per-player result', () => {
    const players = makeGame().players.map((p) => ({ ...p, won: undefined }));
    const record = buildRunRecord(makeGame({ players }));
    expect(record.seats.map((s) => s.won)).toEqual([0, 1]);
  });

  it('keeps won null when the game has no decided outcome (no fabrication)', () => {
    const players = makeGame().players.map((p) => ({ ...p, won: undefined }));
    const record = buildRunRecord(makeGame({ players, winner: null }));
    expect(record.winner).toBeNull();
    expect(record.seats.map((s) => s.won)).toEqual([null, null]);
  });

  it('nulls unattributable provider/model instead of fabricating them', () => {
    const players = makeGame().players.map(({ provider, model, ...p }) => p);
    const record = buildRunRecord(makeGame({ players }));
    expect(record.seats[0].provider).toBeNull();
    expect(record.seats[0].model).toBeNull();
  });

  it('actual seat count wins over config intent (num_players = players.length)', () => {
    const record = buildRunRecord(makeGame({ players: [makeGame().players[0]] }));
    expect(record.num_players).toBe(1);
  });
});

// ---------- event ordering ----------

describe('orderEvents (event ordering)', () => {
  it('sorts by ascending timestamp regardless of fetch order', () => {
    const events = [
      makeEvent('e3', '2026-11-21T01:37:00.000Z', 3),
      makeEvent('e1', '2026-11-21T01:36:00.000Z', 1),
      makeEvent('e2', '2026-11-21T01:36:30.000Z', 2),
    ];
    expect(orderEvents(events).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('breaks timestamp ties by metadata.sequence', () => {
    const events = [
      makeEvent('later-seq', '2026-11-21T01:36:00.000Z', 9),
      makeEvent('early-seq', '2026-11-21T01:36:00.000Z', 4),
    ];
    expect(orderEvents(events).map((e) => e.id)).toEqual(['early-seq', 'later-seq']);
  });

  it('falls back to fetch order when timestamp AND sequence tie', () => {
    const events = [
      makeEvent('first', '2026-11-21T01:36:00.000Z', 1),
      makeEvent('second', '2026-11-21T01:36:00.000Z', 1),
    ];
    expect(orderEvents(events).map((e) => e.id)).toEqual(['first', 'second']);
  });
});

// ---------- serialization idempotency ----------

describe('serializeRunFile (JSONL body)', () => {
  const game = makeGame();
  const events = [
    makeEvent('e2', '2026-11-21T01:36:30.000Z', 2),
    makeEvent('e1', '2026-11-21T01:36:00.000Z', 1),
    makeEvent('e1-again', '2026-11-21T01:36:00.000Z', 1),
  ];

  it('line 1 is the run record; every following line is one projected event in game order', () => {
    const body = serializeRunFile(buildRunRecord(game), events);
    const lines = body.split('\n');
    expect(lines[lines.length - 1]).toBe(''); // trailing newline
    const parsed = lines.slice(0, -1).map((l) => JSON.parse(l));
    expect(parsed[0].game_id).toBe('game-1');
    expect(parsed[0].seats).toHaveLength(2);
    expect(parsed.slice(1).map((e: { id: string }) => e.id)).toEqual(['e1', 'e1-again', 'e2']);
  });

  it('is byte-identical for repeated builds of the same payload (idempotency)', () => {
    const a = serializeRunFile(buildRunRecord(game), events);
    const b = serializeRunFile(buildRunRecord(game), events);
    expect(a).toBe(b);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('projects each event to the fixed corpus shape', () => {
    const projected = projectEvent(makeEvent('e1', '2026-11-21T01:36:00.000Z', 1));
    expect(Object.keys(projected)).toEqual(['id', 'type', 'timestamp', 'actor_id', 'visibility', 'data', 'metadata']);
    expect(projected.actor_id).toBe('p1');
  });

  it('index entry mirrors the header plus the run file path', () => {
    const record = buildRunRecord(game);
    const entry = buildIndexEntry(record, 'game-1.jsonl');
    expect(entry).toEqual({
      game_id: 'game-1',
      path: 'game-1.jsonl',
      started_at: record.started_at,
      winner: record.winner,
      provenance: record.provenance,
      seats: record.seats,
    });
    expect(serializeIndexLine(entry).endsWith('\n')).toBe(true);
  });
});

// ---------- exportGame file state (stubbed fetch + temp data dir) ----------

describe('exportGame (file + index state)', () => {
  let runsDir: string;
  let detail: ApiGameDetail;
  let events: ApiEvent[];

  beforeEach(() => {
    runsDir = mkdtempSync(path.join(tmpdir(), 'mafiactl-runs-'));
    detail = makeGame();
    events = [
      makeEvent('e1', '2026-11-21T01:36:00.000Z', 1),
      makeEvent('e2', '2026-11-21T01:36:30.000Z', 2),
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/v1/games/game-1') && url.endsWith('/replay')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: events, count: events.length }) };
      }
      if (url.includes('/api/v1/games/game-1')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: detail }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('writes data dir file + exactly one index line, and is idempotent on re-run', async () => {
    const first = await exportGame('http://test', runsDir, 'game-1');
    expect(first.fileChanged).toBe(true);
    expect(first.indexChanged).toBe(true);
    expect(first.eventCount).toBe(2);
    expect(first.fileName).toBe('game-1.jsonl');

    const runFile = path.join(runsDir, 'game-1.jsonl');
    const indexFile = path.join(runsDir, 'index.jsonl');
    expect(existsSync(runFile)).toBe(true);
    const bodyAfterFirst = readFileSync(runFile, 'utf-8');
    const indexAfterFirst = readFileSync(indexFile, 'utf-8');
    expect(indexAfterFirst.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1);
    expect(JSON.parse(indexAfterFirst.trim()).game_id).toBe('game-1');

    const second = await exportGame('http://test', runsDir, 'game-1');
    expect(second.fileChanged).toBe(false);
    expect(second.indexChanged).toBe(false);
    // Byte-identical file, no duplicate index line.
    expect(readFileSync(runFile, 'utf-8')).toBe(bodyAfterFirst);
    expect(readFileSync(indexFile, 'utf-8')).toBe(indexAfterFirst);
  });

  it('rewrites the run file when the game payload genuinely changed', async () => {
    await exportGame('http://test', runsDir, 'game-1');
    events = [...events, makeEvent('e3', '2026-11-21T01:37:00.000Z', 3)];
    const second = await exportGame('http://test', runsDir, 'game-1');
    expect(second.fileChanged).toBe(true);
    // ... but the index still holds exactly one line for this game.
    const indexFile = path.join(runsDir, 'index.jsonl');
    expect(readFileSync(indexFile, 'utf-8').split('\n').filter((l) => l.trim() !== '')).toHaveLength(1);
  });

  it('refuses to export a non-ENDED game', async () => {
    detail = makeGame({ status: 'IN_PROGRESS' });
    await expect(exportGame('http://test', runsDir, 'game-1')).rejects.toThrow(/IN_PROGRESS, not ENDED/);
    expect(existsSync(path.join(runsDir, 'index.jsonl'))).toBe(false);
  });

  it('surfaces a 404 as a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({ success: false, error: 'Game not found' }),
    })));
    await expect(exportGame('http://test', runsDir, 'missing-game')).rejects.toThrow(/not found on server \(404\)/);
  });

  it('a torn index line never blocks a fresh export', async () => {
    const fsmod = await import('fs');
    fsmod.writeFileSync(path.join(runsDir, 'index.jsonl'), '{torn json line\n', 'utf-8');
    const outcome = await exportGame('http://test', runsDir, 'game-1');
    expect(outcome.indexChanged).toBe(true);
    const lines = readFileSync(path.join(runsDir, 'index.jsonl'), 'utf-8').split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).game_id).toBe('game-1');
  });
});

// ---------- index concurrency (MAF-L1-FM-002) ----------

/**
 * apps/cli root — `pnpm --filter @mafia/cli test:run` always runs this suite
 * with the package dir as cwd. The spawned export children resolve the tsx
 * loader (node_modules) and src/commands/runs.ts from here.
 */
const CLI_ROOT = process.cwd();
const RUNS_TS = path.join(CLI_ROOT, 'src', 'commands', 'runs.ts');

/** Payload set served by the stub server / stubbed fetch, keyed by game id. */
type GamePayloads = Record<string, { detail: ApiGameDetail; events: ApiEvent[] }>;

function makeGamePayloads(...ids: string[]): GamePayloads {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        detail: makeGame({ id }),
        events: [makeEvent(`${id}-e1`, '2026-11-21T01:36:00.000Z', 1)],
      },
    ]),
  );
}

function stubGameFetch(games: GamePayloads): unknown {
  return vi.fn(async (url: string) => {
    const match = /\/api\/v1\/games\/([^/]+)(\/replay)?$/.exec(url);
    const game = match ? games[match[1]] : undefined;
    if (!match || !game) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    if (match[2]) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: game.events, count: game.events.length }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: game.detail }) };
  });
}

/** Real loopback HTTP server serving the game REST payloads (for children). */
function startStubGameServer(games: GamePayloads): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const match = /\/api\/v1\/games\/([^/]+)(\/replay)?$/.exec(req.url ?? '');
    const game = match ? games[match[1]] : undefined;
    if (!match || !game) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (match[2]) {
      res.end(JSON.stringify({ success: true, data: game.events, count: game.events.length }));
    } else {
      res.end(JSON.stringify({ success: true, data: game.detail }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

interface ExportChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn one export "process" exactly the way two concurrent `mafiactl runs
 * export` invocations would run: a separate OS process importing the real
 * exportGame from source (tsx loader), pointed at a real loopback server.
 */
function spawnExportChild(childScript: string, serverUrl: string, runsDir: string, gameId: string): Promise<ExportChildResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', childScript, serverUrl, runsDir, gameId],
      { cwd: CLI_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: `${stderr}${err.message}\n` }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Assert the child completed a real export and return its outcome flags. */
function expectChildOk(result: ExportChildResult): { fileChanged: boolean; indexChanged: boolean } {
  const line = result.stdout.split('\n').find((l) => l.startsWith('EXPORT-OK '));
  expect(line, `child did not complete an export (exit=${result.code}) stderr=${result.stderr} stdout=${result.stdout}`).toBeDefined();
  expect(result.code, `child exited non-zero: ${result.stderr}`).toBe(0);
  return JSON.parse((line as string).slice('EXPORT-OK '.length));
}

/** Read index.jsonl as parsed lines — a torn/interleaved line throws here. */
function readIndexLines(runsDir: string): Array<{ game_id?: string; path?: string }> {
  return readFileSync(path.join(runsDir, 'index.jsonl'), 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { game_id?: string; path?: string });
}

/** Write the per-process export child into its own temp dir (not runsDir). */
function writeExportChildScript(childDir: string): string {
  const script = path.join(childDir, 'export-child.mjs');
  writeFileSync(
    script,
    [
      '// Spawned by runs.test.ts (MAF-L1-FM-002): one `mafiactl runs export`',
      '// process in miniature — imports the real exportGame from source and',
      '// exports one game, exiting 0 (or 1 with EXPORT-FAIL on stderr).',
      'const [serverUrl, runsDir, gameId] = process.argv.slice(2);',
      'try {',
      `  const mod = await import(${JSON.stringify(RUNS_TS)});`,
      '  const outcome = await mod.exportGame(serverUrl, runsDir, gameId);',
      "  console.log('EXPORT-OK ' + JSON.stringify(outcome));",
      '} catch (err) {',
      "  console.error('EXPORT-FAIL ' + ((err && err.message) || String(err)));",
      '  process.exit(1);',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  );
  return script;
}

describe('runs index concurrency (MAF-L1-FM-002)', () => {
  let runsDir: string;
  let childDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(path.join(tmpdir(), 'mafiactl-runs-conc-'));
    childDir = mkdtempSync(path.join(tmpdir(), 'mafiactl-runchild-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(runsDir, { recursive: true, force: true });
    rmSync(childDir, { recursive: true, force: true });
  });

  it('two concurrent in-process exports (same + different games) leave exactly one index line per game', async () => {
    vi.stubGlobal('fetch', stubGameFetch(makeGamePayloads('game-1', 'game-2')));
    const [r1, r2, r3, r4] = await Promise.all([
      exportGame('http://test', runsDir, 'game-1'),
      exportGame('http://test', runsDir, 'game-1'),
      exportGame('http://test', runsDir, 'game-2'),
      exportGame('http://test', runsDir, 'game-2'),
    ]);

    // Exactly one index append per game even when two exports race.
    expect([r1.indexChanged, r2.indexChanged].filter(Boolean)).toHaveLength(1);
    expect([r3.indexChanged, r4.indexChanged].filter(Boolean)).toHaveLength(1);

    const lines = readIndexLines(runsDir);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.game_id))).toEqual(new Set(['game-1', 'game-2']));
    for (const line of lines) {
      expect(line.path, 'index line must carry a path').toBeDefined();
      expect(existsSync(path.join(runsDir, line.path as string))).toBe(true);
    }
    // The lock never outlives its critical section.
    expect(existsSync(path.join(runsDir, 'index.lock'))).toBe(false);
  });

  it('withIndexLock serializes concurrent holders — critical sections never overlap', async () => {
    // The deterministic red arm: gut withIndexLock's body (plain invocation)
    // and both sections overlap -> maxInFlight 2 and the alternating
    // enter/exit timeline breaks. This is the property that makes
    // interleaved/corrupt index appends impossible across processes.
    let inFlight = 0;
    let maxInFlight = 0;
    const timeline: string[] = [];
    const section = async (name: string): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      timeline.push(`enter:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      timeline.push(`exit:${name}`);
      inFlight -= 1;
    };
    await Promise.all([
      withIndexLock(runsDir, () => section('a')),
      withIndexLock(runsDir, () => section('b')),
    ]);
    expect(maxInFlight).toBe(1);
    expect(timeline.map((step) => step.split(':')[0])).toEqual(['enter', 'exit', 'enter', 'exit']);
    expect(existsSync(path.join(runsDir, 'index.lock'))).toBe(false);
  });

  it('withIndexLock fails loudly on a live foreign lock and leaves it untouched', async () => {
    const lockPath = path.join(runsDir, 'index.lock');
    mkdirSync(lockPath);
    writeFileSync(path.join(lockPath, 'holder.token'), 'someone-else', 'utf-8');
    await expect(
      withIndexLock(runsDir, () => 'never-runs', { pollMs: 5, timeoutMs: 60 }),
    ).rejects.toThrow(/Timed out .* waiting for the runs index lock/);
    // A contender that gives up must not break the live holder's lock.
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(path.join(lockPath, 'holder.token'), 'utf-8')).toBe('someone-else');
  });

  it('withIndexLock breaks a stale lock left by a crashed export', async () => {
    const lockPath = path.join(runsDir, 'index.lock');
    mkdirSync(lockPath);
    writeFileSync(path.join(lockPath, 'holder.token'), 'crashed-export', 'utf-8');
    // Backdate the lock past the stale window.
    const old = new Date(Date.now() - 60000);
    utimesSync(lockPath, old, old);
    const result = await withIndexLock(runsDir, () => 'ran-under-broken-lock', {
      pollMs: 5,
      staleMs: 1000,
      timeoutMs: 5000,
    });
    expect(result).toBe('ran-under-broken-lock');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('two spawned export PROCESSES exporting the same game leave exactly one index line', async () => {
    expect(existsSync(RUNS_TS), `runs.ts not found at ${RUNS_TS} — the spawned children assume the vitest cwd is apps/cli`).toBe(true);
    const server = await startStubGameServer(makeGamePayloads('game-a'));
    try {
      const script = writeExportChildScript(childDir);
      const [c1, c2] = await Promise.all([
        spawnExportChild(script, server.url, runsDir, 'game-a'),
        spawnExportChild(script, server.url, runsDir, 'game-a'),
      ]);
      const o1 = expectChildOk(c1);
      const o2 = expectChildOk(c2);
      // The duplicate-line race: both processes must agree on who appends.
      expect([o1.indexChanged, o2.indexChanged].filter(Boolean)).toHaveLength(1);

      const lines = readIndexLines(runsDir);
      expect(lines).toHaveLength(1);
      expect(lines[0].game_id).toBe('game-a');
      expect(existsSync(path.join(runsDir, 'index.lock'))).toBe(false);
    } finally {
      await server.close();
    }
  }, 60000);

  it('two spawned export PROCESSES exporting different games cannot interleave or duplicate index lines', async () => {
    expect(existsSync(RUNS_TS), `runs.ts not found at ${RUNS_TS} — the spawned children assume the vitest cwd is apps/cli`).toBe(true);
    const server = await startStubGameServer(makeGamePayloads('game-b', 'game-c'));
    try {
      const script = writeExportChildScript(childDir);
      const [c1, c2] = await Promise.all([
        spawnExportChild(script, server.url, runsDir, 'game-b'),
        spawnExportChild(script, server.url, runsDir, 'game-c'),
      ]);
      const o1 = expectChildOk(c1);
      const o2 = expectChildOk(c2);
      expect(o1.indexChanged).toBe(true);
      expect(o2.indexChanged).toBe(true);

      // Every line intact (a torn/interleaved line throws in readIndexLines),
      // exactly one line per game, no duplicates.
      const lines = readIndexLines(runsDir);
      expect(lines).toHaveLength(2);
      expect(new Set(lines.map((l) => l.game_id))).toEqual(new Set(['game-b', 'game-c']));
      for (const line of lines) {
        expect(line.path, 'index line must carry a path').toBeDefined();
        expect(existsSync(path.join(runsDir, line.path as string))).toBe(true);
      }
      expect(existsSync(path.join(runsDir, 'index.lock'))).toBe(false);
    } finally {
      await server.close();
    }
  }, 60000);
});

// ---------- command surface ----------

describe('RunsCommand (CLI surface)', () => {
  it('registers export and backfill subcommands with the shared options', () => {
    const cmd = new RunsCommand();
    expect(cmd.name()).toBe('runs');
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(['export', 'backfill']);
    const exportCmd = cmd.commands[0];
    const exportFlags = exportCmd.options.map((o: { flags: string }) => o.flags).join(' ');
    expect(exportFlags).toContain('data-dir');
    expect(exportFlags).toContain('server');
    expect(exportCmd.description()).toMatch(/JSONL/);
    const backfillCmd = cmd.commands[1];
    const backfillFlags = backfillCmd.options.map((o: { flags: string }) => o.flags).join(' ');
    expect(backfillFlags).toContain('data-dir');
    expect(backfillFlags).toContain('server');
  });
});
