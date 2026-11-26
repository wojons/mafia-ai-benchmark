/**
 * OBS-003 Tier-2 metrics — hermetic tests.
 *
 * Design authority: docs/observability-spec.md section 3.3 (the six families)
 * and section 6.3 (the acceptance commands). Every case here is offline: a
 * real Express app listened on an ephemeral port for the HTTP families, a
 * real SQLite file for the storage gauges, and no LLM/network/game spawn.
 *
 * Counters/gauges are process-global, so every value assertion is a
 * BEFORE/AFTER DELTA against a freshly rendered registry — never an absolute
 * count (the Tier-0/Tier-1 suites share the same registry in a full run).
 */
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  HEALTHCHECK_NAMES,
  HTTP_METHODS,
  HTTP_STATUS_CLASSES,
  IN_PROGRESS_GAMES_SQL,
  STORAGE_GAUGE_REFRESH_MS,
  STORAGE_TABLES,
  UNMATCHED_ROUTE_LABEL,
  healthcheckFailed,
  httpMetricsMiddleware,
  normalizeHttpMethod,
  refreshStorageGauges,
  registry,
  routeLabelFor,
  statusClassOf,
  type MetricsStorageDatabase,
} from '../../observability/metrics.js';
import {
  GAME_REGISTRATION_GRACE_MS,
  collectLiveGameIds,
  isBridgeChildAlive,
  legacyBridgeLiveGameSource,
} from '../../services/game-liveness.js';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import type { EventBus } from '../../services/event-bus.js';
import type { GameRepository } from '../../db/repository.js';

/** The six Tier-2 families from docs/observability-spec.md section 3.3. */
const TIER2_FAMILIES = [
  'mafia_storage_bytes',
  'mafia_storage_rows',
  'mafia_http_requests_total',
  'mafia_http_request_duration_seconds',
  'mafia_game_in_progress',
  'mafia_healthcheck_failed_total',
];

function render(): Promise<string> {
  return registry.metrics();
}

/** Value of the first sample line whose text starts with `prefix` (0 when absent). */
function valueOf(output: string, prefix: string): number {
  const line = output.split('\n').find((l) => l.startsWith(prefix) && !l.startsWith('#'));
  if (!line) return 0;
  const parsed = Number(line.slice(line.lastIndexOf(' ') + 1));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sum of every sample line of a family (counters: one line per label set). */
function sumFamily(output: string, family: string): number {
  let sum = 0;
  for (const line of output.split('\n')) {
    if (!line.startsWith(`${family}{`) && !line.startsWith(`${family} `)) continue;
    const parsed = Number(line.slice(line.lastIndexOf(' ') + 1));
    if (Number.isFinite(parsed)) sum += parsed;
  }
  return sum;
}

/** Sample lines (not # HELP/# TYPE) belonging to one family, including _bucket/_sum/_count. */
function familyLines(output: string, family: string): string[] {
  return output.split('\n').filter((line) => {
    if (!line.startsWith(family)) return false;
    const next = line.charAt(family.length);
    return next === '{' || next === ' ' || line.startsWith(`${family}_`);
  });
}

/**
 * One line per Tier-2 SERIES, i.e. one per distinct label combination: the
 * _bucket/_sum/_count components of a histogram are samples of a single
 * instrument series, so they are not counted again.
 */
function tier2SeriesLines(output: string): string[] {
  return output.split('\n').filter((line) => {
    if (!line || line.startsWith('#')) return false;
    const brace = line.indexOf('{');
    const space = line.indexOf(' ');
    const cut = Math.min(brace === -1 ? Infinity : brace, space === -1 ? Infinity : space);
    const name = cut === Infinity ? line : line.slice(0, cut);
    return TIER2_FAMILIES.includes(name);
  });
}

const GAME_ROUTE = '/api/v1/games/:gameId';

/** Boot a real Express app on an ephemeral port (same shape as the auth suite). */
async function startApp(
  configure: (app: express.Express) => void,
  installMiddleware = true,
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  if (installMiddleware) app.use(httpMetricsMiddleware());
  configure(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Temp dirs created by a test, removed afterwards. */
const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const SCHEMA_PATH = new URL('../../db/schema.sql', import.meta.url);

/** A real on-disk SQLite database with the production schema. */
function makeFileDb(): { file: string; db: Database.Database } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-obs003-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'mafia.db');
  const db = new Database(file);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  return { file, db };
}

/** Insert an IN_PROGRESS game row with explicit activity evidence. */
function insertGame(
  db: Database.Database,
  id: string,
  evidence: { createdAt: number; startedAt: number | null },
): void {
  db.prepare(
    `INSERT INTO games (id, status, config, created_at, started_at)
     VALUES (?, 'IN_PROGRESS', '{}', ?, ?)`,
  ).run(id, evidence.createdAt, evidence.startedAt);
}

const storageDb = (db: Database.Database): MetricsStorageDatabase =>
  db as unknown as MetricsStorageDatabase;

describe('OBS-003 Tier-2 metrics catalogue', () => {
  it('renders at least one sample line for every one of the six families on a fresh registry', async () => {
    const out = await render();
    for (const family of TIER2_FAMILIES) {
      expect(familyLines(out, family).length, `no sample line for ${family}`).toBeGreaterThan(0);
      expect(out, `no TYPE line for ${family}`).toContain(`# TYPE ${family} `);
    }
  });

  it('pre-registers the closed label sets at zero (unmatched route, methods, status classes, checks, tables)', async () => {
    const out = await render();
    for (const table of STORAGE_TABLES) {
      expect(out).toMatch(new RegExp(`^mafia_storage_rows\\{table="${table}"\\} `, 'm'));
    }
    for (const check of HEALTHCHECK_NAMES) {
      expect(out).toMatch(new RegExp(`^mafia_healthcheck_failed_total\\{check="${check}"\\} `, 'm'));
    }
    for (const method of HTTP_METHODS) {
      for (const statusClass of HTTP_STATUS_CLASSES) {
        expect(
          out,
          `missing pre-registered ${method}/${statusClass} on the unmatched route`,
        ).toMatch(
          new RegExp(
            `^mafia_http_requests_total\\{route="${UNMATCHED_ROUTE_LABEL}",method="${method}",status_class="${statusClass}"\\} `,
            'm',
          ),
        );
      }
    }
    expect(out).toMatch(/^mafia_storage_bytes /m);
    expect(out).toMatch(/^mafia_game_in_progress /m);
  });

  it('exposes the spec 3.3 latency buckets on the HTTP histogram', async () => {
    const out = await render();
    for (const le of ['0.005', '0.01', '0.05', '0.1', '0.5', '1', '5', '30']) {
      expect(out).toMatch(
        new RegExp(`mafia_http_request_duration_seconds_bucket\\{[^}]*le="${le.replace('.', '\\.')}"`),
      );
    }
    expect(out).toMatch(/mafia_http_request_duration_seconds_bucket\{[^}]*le="\+Inf"/);
  });
});

describe('OBS-003 HTTP route label is the matched pattern, never the path', () => {
  it('records two different game ids onto exactly ONE route="/api/v1/games/:gameId" series', async () => {
    const app = await startApp((a) => {
      a.get(GAME_ROUTE, (req, res) => {
        res.json({ id: req.params.gameId });
      });
    });
    try {
      const seriesPrefix = `mafia_http_requests_total{route="${GAME_ROUTE}",method="GET",status_class="2xx"}`;
      const durationCountPrefix = `mafia_http_request_duration_seconds_count{route="${GAME_ROUTE}",method="GET"}`;
      const before = await render();
      const counterBefore = valueOf(before, seriesPrefix);
      const durationCountBefore = valueOf(before, durationCountPrefix);

      expect((await fetch(`${app.url}/api/v1/games/game-aaaa1111`)).status).toBe(200);
      expect((await fetch(`${app.url}/api/v1/games/game-bbbb2222`)).status).toBe(200);

      const out = await render();
      const lines = out
        .split('\n')
        .filter((line) => line.startsWith(seriesPrefix) && !line.startsWith('#'));

      // exactly one series for the pattern, incremented twice
      expect(lines).toHaveLength(1);
      expect(valueOf(out, seriesPrefix)).toBe(counterBefore + 2);
      // ...and the latency histogram observed both requests on that same pair
      expect(valueOf(out, durationCountPrefix)).toBe(durationCountBefore + 2);

      // ...and the concrete ids never became labels or series values
      for (const id of ['game-aaaa1111', 'game-bbbb2222']) {
        expect(out, `concrete id ${id} leaked into /metrics`).not.toContain(id);
        expect(out).not.toContain(`/api/v1/games/${id}`);
      }
    } finally {
      await app.close();
    }
  });

  it('collapses an unmatched request onto the single route="unmatched" series', async () => {
    const app = await startApp(() => {
      /* no routes: every request is a 404 from the express default handler */
    });
    try {
      const before = valueOf(
        await render(),
        `mafia_http_requests_total{route="${UNMATCHED_ROUTE_LABEL}",method="GET",status_class="4xx"}`,
      );
      expect((await fetch(`${app.url}/api/v1/definitely-not-a-route`)).status).toBe(404);
      const after = await render();
      expect(
        valueOf(
          after,
          `mafia_http_requests_total{route="${UNMATCHED_ROUTE_LABEL}",method="GET",status_class="4xx"}`,
        ),
      ).toBe(before + 1);
      const unmatchedLines = after
        .split('\n')
        .filter((line) => line.startsWith(`mafia_http_requests_total{route="${UNMATCHED_ROUTE_LABEL}"`));
      // closed set only: methods x status classes, never the requested path
      expect(unmatchedLines.length).toBeLessThanOrEqual(8 * HTTP_STATUS_CLASSES.length);
      expect(after).not.toContain('definitely-not-a-route');
    } finally {
      await app.close();
    }
  });

  it('never instruments the scrape endpoint itself', async () => {
    const app = await startApp((a) => {
      a.get('/metrics', async (_req, res) => {
        res.set('Content-Type', registry.contentType);
        res.end(await registry.metrics());
      });
      a.get(GAME_ROUTE, (req, res) => res.json({ id: req.params.gameId }));
    });
    try {
      const before = sumFamily(await render(), 'mafia_http_requests_total');
      expect((await fetch(`${app.url}/metrics`)).status).toBe(200);
      expect((await fetch(`${app.url}/metrics`)).status).toBe(200);
      const after = sumFamily(await render(), 'mafia_http_requests_total');
      expect(after).toBe(before);

      // control: an instrumented route still moves the total, so the assertion
      // above is not vacuously true on a dead middleware
      expect((await fetch(`${app.url}/api/v1/games/control-1`)).status).toBe(200);
      expect(sumFamily(await render(), 'mafia_http_requests_total')).toBe(before + 1);
    } finally {
      await app.close();
    }
  });
});

describe('OBS-003 status_class reflects the real response status', () => {
  it('counts a 404 and a 500, and never a hard-coded 200', async () => {
    const app = await startApp((a) => {
      a.get(GAME_ROUTE, (req, res) => {
        if (req.params.gameId === 'missing') res.status(404).json({ error: 'not found' });
        else res.json({ id: req.params.gameId });
      });
      a.get('/api/v1/boom', () => {
        throw new Error('boom');
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message });
      });
    });
    try {
      const notFound = `mafia_http_requests_total{route="${GAME_ROUTE}",method="GET",status_class="4xx"}`;
      const ok = `mafia_http_requests_total{route="${GAME_ROUTE}",method="GET",status_class="2xx"}`;
      const serverError = 'mafia_http_requests_total{route="/api/v1/boom",method="GET",status_class="5xx"}';
      const before = await render();
      const [notFoundBefore, okBefore, serverErrorBefore] = [
        valueOf(before, notFound),
        valueOf(before, ok),
        valueOf(before, serverError),
      ];

      expect((await fetch(`${app.url}/api/v1/games/missing`)).status).toBe(404);
      expect((await fetch(`${app.url}/api/v1/boom`)).status).toBe(500);

      const after = await render();
      expect(valueOf(after, notFound)).toBe(notFoundBefore + 1);
      expect(valueOf(after, serverError)).toBe(serverErrorBefore + 1);
      // a 404 must not also land in 2xx
      expect(valueOf(after, ok)).toBe(okBefore);
    } finally {
      await app.close();
    }
  });

  it('maps status codes and methods into their closed sets', () => {
    expect(statusClassOf(200)).toBe('2xx');
    expect(statusClassOf(201)).toBe('2xx');
    expect(statusClassOf(302)).toBe('3xx');
    expect(statusClassOf(404)).toBe('4xx');
    expect(statusClassOf(500)).toBe('5xx');
    expect(statusClassOf(503)).toBe('5xx');
    expect(statusClassOf(undefined)).toBe('5xx');
    expect(normalizeHttpMethod('get')).toBe('GET');
    expect(normalizeHttpMethod('POST')).toBe('POST');
    expect(normalizeHttpMethod('propfind')).toBe('OTHER');
    expect(normalizeHttpMethod(undefined)).toBe('OTHER');
  });

  it('resolves the route label from the matched pattern, including the mount prefix', () => {
    expect(routeLabelFor({ route: { path: GAME_ROUTE }, baseUrl: '' })).toBe(GAME_ROUTE);
    expect(routeLabelFor({ route: { path: '/games/:gameId' }, baseUrl: '/api/v1' })).toBe(
      '/api/v1/games/:gameId',
    );
    expect(routeLabelFor({ route: { path: ['/first', '/second'] } })).toBe('/first');
    expect(routeLabelFor({})).toBe(UNMATCHED_ROUTE_LABEL);
    expect(routeLabelFor({ route: {} })).toBe(UNMATCHED_ROUTE_LABEL);
    expect(routeLabelFor({ route: { path: /^\/regex$/ } as unknown as { path: string } })).toBe(
      UNMATCHED_ROUTE_LABEL,
    );
  });
});

describe('OBS-003 storage gauges', () => {
  it('reports mafia_storage_bytes within 5% of the DB file size', async () => {
    const { file, db } = makeFileDb();
    db.prepare("INSERT INTO games (id, status, config, created_at) VALUES ('size-1', 'SETUP', '{}', 1)")
      .run();
    const statSize = fs.statSync(file).size;
    expect(statSize).toBeGreaterThan(0);

    const snapshot = refreshStorageGauges({ db: storageDb(db), dbPath: file });
    expect(snapshot).not.toBeNull();
    const measured = snapshot?.bytes ?? 0;
    expect(Math.abs(measured - statSize) / statSize).toBeLessThanOrEqual(0.05);
    // the stat path is the one that is byte-identical to `stat -c %s`
    expect(measured).toBe(statSize);
    expect(valueOf(await render(), 'mafia_storage_bytes ')).toBe(statSize);
    db.close();
  });

  it('falls back to page_count * page_size when no DB path is available (in-memory DB)', async () => {
    const db = new Database(':memory:');
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    const snapshot = refreshStorageGauges({ db: storageDb(db), dbPath: ':memory:' });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.bytes).toBeGreaterThan(0);
    db.close();
  });

  it('emits exactly the six allow-listed tables and their real row counts', async () => {
    const { file, db } = makeFileDb();
    const insert = db.prepare(
      "INSERT INTO games (id, status, config, created_at) VALUES (?, 'SETUP', '{}', 1)",
    );
    insert.run('row-1');
    insert.run('row-2');
    insert.run('row-3');

    const snapshot = refreshStorageGauges({ db: storageDb(db), dbPath: file });
    expect(snapshot).not.toBeNull();
    expect(Object.keys(snapshot?.rows ?? {}).sort()).toEqual([...STORAGE_TABLES].sort());
    expect(snapshot?.rows.games).toBe(3);
    expect(snapshot?.rows.events).toBe(0);

    const out = await render();
    const labelValues = familyLines(out, 'mafia_storage_rows')
      .map((line) => /table="([^"]*)"/.exec(line)?.[1])
      .filter((value): value is string => typeof value === 'string');
    expect(new Set(labelValues)).toEqual(new Set(STORAGE_TABLES));
    expect(valueOf(out, 'mafia_storage_rows{table="games"} ')).toBe(3);
    db.close();
  });

  it('retains the last-good values and never throws when the DB handle is broken', async () => {
    const { file, db } = makeFileDb();
    db.prepare("INSERT INTO games (id, status, config, created_at) VALUES ('keep-1', 'SETUP', '{}', 1)")
      .run();
    const good = refreshStorageGauges({ db: storageDb(db), dbPath: file });
    expect(good?.rows.games).toBe(1);
    db.close();

    const broken: MetricsStorageDatabase = {
      prepare() {
        throw new Error('database is locked');
      },
    };
    // No path => the bytes fallback also fails, so all three legs hit the error.
    let snapshot: ReturnType<typeof refreshStorageGauges> = null;
    expect(() => {
      snapshot = refreshStorageGauges({ db: broken });
    }).not.toThrow();
    expect(snapshot).not.toBeNull();
    expect(snapshot).toEqual(good);

    const out = await render();
    expect(valueOf(out, 'mafia_storage_rows{table="games"} ')).toBe(1);
    expect(valueOf(out, 'mafia_storage_bytes ')).toBe(fs.statSync(file).size);
  });
});

describe('OBS-006 orphan detector (mafia_game_in_progress)', () => {
  it('flips > 0 within one refresh interval of the bridge child being killed, even when the last event is fresh', async () => {
    // THE acceptance case from the OBS-003 verdict: a game whose bridge child
    // has just died but whose last event is seconds old. Under OBS-003's 5 min
    // ORPHAN_GAME_STALE_MS window this row read as "owned" for five minutes and
    // the alarm stayed silent. Under OBS-006 ownership outranks recency: the
    // only thing that changes between the two refreshes below is the child's
    // exit, and the gauge must flip on the very next refresh.
    //
    // The child is REAL: an actual OS process spawned through the adapter's own
    // startGame() registration path, registered in its activeGames map, and
    // observed by the adapter's production 'close' handler. Nothing in this arm
    // mutates a hand-built object.
    const { file, db } = makeFileDb();
    const now = Date.now();

    // The stand-in bridge: alive until signalled, then exits 0. Exit code 0 is
    // load-bearing — a signal-killed child (code null) makes the adapter's
    // close handler write games.status='CANCELLED', removing the row before the
    // gauge can classify it. A graceful 0 exit leaves the row IN_PROGRESS while
    // the adapter stops owning the game: exactly the orphan this gauge exists
    // to report. The readiness marker exists because a SIGTERM that arrives
    // before the script has installed its handler kills node by default
    // disposition (code null) — the test must wait for the real child to be up.
    const bridgeScript = path.join(path.dirname(file), 'bridge.js');
    const readyMarker = path.join(path.dirname(file), 'bridge-ready');
    fs.writeFileSync(
      bridgeScript,
      [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => process.exit(0));',
        'process.on("SIGINT", () => process.exit(0));',
        'fs.writeFileSync(process.env.OBS006_BRIDGE_READY_FILE, String(process.pid));',
        'setInterval(() => {}, 1000);',
        '',
      ].join('\n'),
    );

    const adapter = new LegacyGameAdapter(
      { publish: () => undefined } as unknown as EventBus,
      { db } as unknown as GameRepository,
      {
        // Same node binary, same argv shape production builds, same stdio
        // wiring; only the launched script differs, so the process under test
        // is real and killable.
        spawn: (command, args, options) => {
          void command;
          return spawn(process.execPath, [bridgeScript, ...args], {
            ...options,
            env: { ...options.env, OBS006_BRIDGE_READY_FILE: readyMarker },
          });
        },
      },
    );

    const state = adapter.startGame({ numPlayers: 5 });
    const child = state.process;
    try {
      // Bounded poll (10 ms steps, 15 s ceiling) — never a blind sleep: the
      // child announces that it is running and has installed its handlers.
      // Windows sized for a contended event loop (MAF-L1-FM-006): under
      // full-suite parallel-file load this worker is CPU-starved, so ceilings
      // must be in seconds, not for an idle machine.
      const readyDeadline = Date.now() + 15_000;
      while (!fs.existsSync(readyMarker)) {
        if (Date.now() > readyDeadline) {
          throw new Error('the bridge child never signalled readiness within 15000 ms');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // The pid in the marker is the pid Node reports: the process this test
      // watches IS the script that installed the SIGTERM handler.
      expect(Number(fs.readFileSync(readyMarker, 'utf-8'))).toBe(child.pid);

      // A real child: a real OS pid, and Node reports it alive.
      expect(child.pid).toBeGreaterThan(0);
      expect(isBridgeChildAlive(child)).toBe(true);

      // Production's own games row (startGame inserted it): age it past the
      // registration grace and give it a 1 s old event, so recency cannot be
      // what decides the verdict.
      db.prepare('UPDATE games SET created_at = ?, started_at = ? WHERE id = ?')
        .run(now - 60_000, now - 60_000, state.gameId);
      db.prepare(
        `INSERT INTO events (id, game_id, type, timestamp, visibility, data, turn_number, day_number, phase, sequence)
         VALUES ('evt-fresh', ?, 'STATE_CHANGE', ?, 'PUBLIC', '{}', 1, 1, 'DAY', 1)`,
      ).run(state.gameId, now - 1_000); // one second old: maximally fresh evidence

      const liveGameIds = () => collectLiveGameIds([legacyBridgeLiveGameSource(adapter)]);

      const alive = refreshStorageGauges({ db: storageDb(db), dbPath: file, now, liveGameIds });
      expect(alive?.inProgressOrphans).toBe(0);
      expect(valueOf(await render(), 'mafia_game_in_progress ')).toBe(0);

      // Attach the adapter's own exit observation BEFORE signalling, so the
      // kill cannot race the listener. Observed condition (the gameEnded
      // event), not a fixed sleep, with a deadline generous enough for a
      // contended event loop (MAF-L1-FM-006, mirroring 957a8ab).
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const observed = new Promise<void>((resolve, reject) => {
        const onEnded = (gameId: string): void => {
          if (gameId !== state.gameId) return;
          adapter.off('gameEnded', onEnded);
          if (deadline) clearTimeout(deadline);
          resolve();
        };
        adapter.on('gameEnded', onEnded);
        deadline = setTimeout(() => {
          adapter.off('gameEnded', onEnded);
          reject(new Error('the adapter never observed the bridge child exit within 15000 ms'));
        }, 15_000);
      });

      // Kill the real child exactly as stopGame() would. There is NO
      // fixed-timer SIGKILL escalation racing the graceful exit: under load a
      // slow child can need seconds to process SIGTERM, and a fixed window
      // (previously 1.5 s) would SIGKILL it (exitCode null, signalCode
      // SIGKILL) and false-fail the exit assertions below — the observed
      // load-window flake. The child's handlers are already installed (the
      // readiness marker above proves it), so SIGTERM alone is the
      // deterministic path; if it somehow never exits, `observed` rejects
      // with a named error and the finally below SIGKILLs the survivor as
      // the leak guard.
      expect(child.kill('SIGTERM')).toBe(true);
      await observed;

      // OS-confirmed death...
      expect(child.exitCode).toBe(0);
      expect(child.signalCode).toBeNull();
      expect(isBridgeChildAlive(child)).toBe(false);
      // ...yet the adapter's map still LISTS the game and still says RUNNING.
      // That over-report is precisely why getActiveGames() alone is not
      // liveness and why the child's exit has to be part of the rule.
      expect(adapter.getActiveGames()).toContain(state.gameId);
      expect(adapter.getGameState(state.gameId)?.status).toBe('RUNNING');

      // The row itself was never touched: same row, still IN_PROGRESS, still
      // holding the one-second-old event. Only the child's exit changed.
      const row = db.prepare('SELECT status FROM games WHERE id = ?').get(state.gameId) as
        | { status?: string }
        | undefined;
      expect(row?.status).toBe('IN_PROGRESS');

      // Same clock (`now`), no staleness window waited out: the gauge flips on
      // the very next refresh, and on the rendered /metrics text.
      const dead = refreshStorageGauges({ db: storageDb(db), dbPath: file, now, liveGameIds });
      expect(dead?.inProgressOrphans).toBe(1);
      expect(valueOf(await render(), 'mafia_game_in_progress ')).toBe(1);
    } finally {
      // A child that somehow survived must not outlive this test.
      if (isBridgeChildAlive(child)) child.kill('SIGKILL');
      adapter.removeAllListeners();
      db.close();
    }
    // Per-test timeout above the sum of this arm's internal windows (15 s
    // readiness + 15 s exit observation): the vitest default 5 s would cap
    // the generous windows under full-suite load before they could resolve
    // (MAF-L1-FM-006, mirroring 957a8ab's per-test timeouts).
  }, 45_000);

  it('never counts a game this process still owns, however old its row is', async () => {
    const { file, db } = makeFileDb();
    const now = Date.now();
    // two days of silence, still owned: the reconciler's 24 h retirement window
    // is not the gauge's business.
    insertGame(db, 'orphan-owned', { createdAt: now - 172_800_000, startedAt: now - 172_800_000 });

    const owned = refreshStorageGauges({
      db: storageDb(db),
      dbPath: file,
      now,
      liveGameIds: () => new Set(['orphan-owned']),
    });
    expect(owned?.inProgressOrphans).toBe(0);
    expect(valueOf(await render(), 'mafia_game_in_progress ')).toBe(0);

    // Owner gone => orphan, immediately (no staleness window to wait out).
    const unowned = refreshStorageGauges({
      db: storageDb(db),
      dbPath: file,
      now,
      liveGameIds: () => new Set<string>(),
    });
    expect(unowned?.inProgressOrphans).toBe(1);
    expect(valueOf(await render(), 'mafia_game_in_progress ')).toBe(1);
    db.close();
  });

  it('does not count a row created a moment ago: it may still be mid-registration', async () => {
    const { file, db } = makeFileDb();
    const now = Date.now();
    insertGame(db, 'registering', { createdAt: now - 500, startedAt: now - 500 });

    const snapshot = refreshStorageGauges({ db: storageDb(db), dbPath: file, now });
    expect(snapshot?.inProgressOrphans).toBe(0);

    // One grace period later the same unowned row IS an orphan.
    const later = refreshStorageGauges({ db: storageDb(db), dbPath: file, now: now + GAME_REGISTRATION_GRACE_MS });
    expect(later?.inProgressOrphans).toBe(1);
    db.close();
  });

  it('counts a never-started ghost immediately (no engine can ever own it)', async () => {
    const { file, db } = makeFileDb();
    const now = Date.now();
    insertGame(db, 'ghost-never-started', { createdAt: now, startedAt: null });

    const snapshot = refreshStorageGauges({ db: storageDb(db), dbPath: file, now });
    expect(snapshot?.inProgressOrphans).toBe(1);
    db.close();
  });

  it('counts nothing on a clean database', async () => {
    const { file, db } = makeFileDb();
    const snapshot = refreshStorageGauges({ db: storageDb(db), dbPath: file, now: Date.now() });
    expect(snapshot?.inProgressOrphans).toBe(0);
    expect(valueOf(await render(), 'mafia_game_in_progress ')).toBe(0);
    db.close();
  });

  it('does not scan `events` on the refresh path (query plan pinned)', async () => {
    // OBS-006 (b): the 30 s refresh must not pay for the events table. The plan
    // is asserted, not just the SQL text, so a future edit that reintroduces a
    // join/aggregate over events fails here even if it looks cheap.
    const { db } = makeFileDb();
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${IN_PROGRESS_GAMES_SQL}`)
      .all() as Array<{ detail?: string }>;
    const details = plan.map((row) => String(row.detail ?? '')).join('\n');

    expect(details).not.toMatch(/\bevents\b/);
    expect(details).toMatch(/idx_games_status/);
    expect(details).toMatch(/idx_players_game/);
    // The whole statement must not mention the events table at all.
    expect(IN_PROGRESS_GAMES_SQL).not.toMatch(/\bevents\b/);
    db.close();
  });
});

describe('OBS-003 healthcheck failure counter', () => {
  it('increments only the closed check set and creates no series for anything else', async () => {
    const prefix = (check: string) => `mafia_healthcheck_failed_total{check="${check}"}`;
    const before = await render();
    const dbWriteBefore = valueOf(before, prefix('db_write'));
    const spawnBefore = valueOf(before, prefix('spawn_capacity'));

    healthcheckFailed('db_write');
    healthcheckFailed('spawn_capacity');
    // not in the closed set: dropped, never a new series, never a throw
    healthcheckFailed('not_a_real_check' as unknown as 'db_write');

    const after = await render();
    expect(valueOf(after, prefix('db_write'))).toBe(dbWriteBefore + 1);
    expect(valueOf(after, prefix('spawn_capacity'))).toBe(spawnBefore + 1);
    expect(after).not.toContain('not_a_real_check');
    expect(familyLines(after, 'mafia_healthcheck_failed_total')).toHaveLength(
      HEALTHCHECK_NAMES.length,
    );
  });
});

describe('OBS-003 cardinality bound', () => {
  it('keeps the six Tier-2 families under 300 series in total', async () => {
    // exercise the families a bit first so the count includes real series
    const app = await startApp((a) => {
      a.get(GAME_ROUTE, (req, res) => res.json({ id: req.params.gameId }));
      a.post('/api/v1/games', (_req, res) => res.status(201).json({ ok: true }));
    });
    try {
      await fetch(`${app.url}/api/v1/games/one`);
      await fetch(`${app.url}/api/v1/games/two`);
      await fetch(`${app.url}/api/v1/games`, { method: 'POST' });
    } finally {
      await app.close();
    }
    healthcheckFailed('db_write');

    const series = tier2SeriesLines(await render());
    expect(series.length).toBeGreaterThan(0);
    expect(series.length).toBeLessThan(300);

    // no series may carry an identifier-shaped route or a stray method spelling
    for (const line of series) {
      const route = /route="([^"]*)"/.exec(line)?.[1];
      if (route) expect(route).toMatch(/^\/[A-Za-z0-9/_:.-]*$|^unmatched$|^other$/);
      const method = /method="([^"]*)"/.exec(line)?.[1];
      if (method) expect([...HTTP_METHODS, 'OTHER']).toContain(method);
    }
  });

  it('documents the refresh cadence used by the server (never per scrape)', () => {
    // The server refreshes on this interval only; a scrape must not trigger it.
    expect(STORAGE_GAUGE_REFRESH_MS).toBeGreaterThanOrEqual(15_000);
  });
});
