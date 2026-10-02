/**
 * MAF-REV-003 — THINK never persists as first-class events.
 *
 * Before this change the legacy engine's agent THINK text survived only as a
 * field inside PRIVATE_MAFIA MESSAGE payloads (mafia chat) — the split-pane
 * THINK pane was half-dropped, and AGENT_THINK_STARTED/COMPLETED (already
 * mapped by the adapter's EventMapper at legacy-game-adapter.ts) were never
 * emitted by the engine at all.
 *
 * Three layers under test:
 *  1. ENGINE (root game-engine.js, loaded directly): a full mock-mode game's
 *     event stream contains AGENT_THINK_STARTED/AGENT_THINK_COMPLETED events
 *     with non-empty think text and ADMIN_ONLY visibility, and NO think text
 *     leaks into PUBLIC-visibility events (the pre-fix PUBLIC VOTE/ABSTAIN
 *     contents carried `think` — a real privacy leak this change removes).
 *  2. ADAPTER (unit): translateAndPublishEvent maps both event types
 *     unchanged, maps ADMIN_ONLY -> ADMIN visibility, persists them through
 *     the repository, and keeps think data out of public SAYS events.
 *  3. BRIDGE→ADAPTER E2E: the REAL legacy-bridge.js child process (mock
 *     mode, no network — dotenv never overrides an already-set empty
 *     OPENAI_API_KEY), its event stream driven through the adapter's
 *     translateAndPublishEvent exactly as production startGame does, into a
 *     real SQLite repository — the same surface GET /api/v1/games/:id/events
 *     reads.
 */

import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import {
  createFakeEventBus,
  createSqliteBackedRepository,
} from './mocks.js';
import type { GameEvent } from '@mafia/shared/events';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.resolve(here, '../../services/legacy-bridge.js');

let gameEngine: any;

beforeAll(async () => {
  // Empty string (not unset): the engine captures API_KEY at module load;
  // an empty key routes getAIResponse to the deterministic mock responses —
  // no network, no flakes. (legacy-engine-parser.test.ts pins a fake key in
  // ITS worker; vitest isolates module graphs per file.)
  process.env.OPENAI_API_KEY = '';
  process.env.DEFAULT_MODEL = 'openai/gpt-4o-mini';
  process.env.LOG_STRUCTURED = 'false';
  // game-engine.js installs console.setGameContext only when pino loads
  // (its structured-logging IIFE); under vitest pino may be absent. The
  // bridge does the same shim before requiring the engine.
  if (typeof (console as any).setGameContext !== 'function') {
    (console as any).setGameContext = function () {};
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - legacy CJS module without bundled types
  gameEngine = await import('../../../../../game-engine.js');
});

afterEach(() => {
  delete process.env.ENABLE_DATABASE;
});

/** Run a complete mock-mode game and return its in-memory event stream. */
async function runMockGame(): Promise<Array<Record<string, any>>> {
  const engine = new gameEngine.MafiaGame({ enableDatabase: false });
  await engine.startGame(5);
  return engine.gameEvents;
}

describe('MAF-REV-003 engine: first-class THINK events per agent turn', () => {
  it(
    'a game event stream contains AGENT_THINK_COMPLETED events with non-empty think text and ADMIN_ONLY visibility',
    async () => {
      const events = await runMockGame();

      const completed = events.filter(
        (e: Record<string, any>) => e.eventType === 'AGENT_THINK_COMPLETED',
      );
      expect(completed.length).toBeGreaterThan(0);

      for (const e of completed) {
        expect(e.visibility).toBe('ADMIN_ONLY');
        expect(typeof e.content.think).toBe('string');
        expect((e.content.think as string).trim().length).toBeGreaterThan(0);
        // agent identification, per the brief's required fields
        expect(e.content.agentId).toBeTruthy();
        expect(e.content.playerId).toBe(e.playerId);
        expect(e.content.role).toBeTruthy();
        expect(typeof e.content.dayNumber).toBe('number');
      }

      const started = events.filter(
        (e: Record<string, any>) => e.eventType === 'AGENT_THINK_STARTED',
      );
      // every completed think had a STARTED first for the same agentId
      expect(started.length).toBeGreaterThanOrEqual(completed.length);
      for (const c of completed) {
        const idx = events.indexOf(c);
        expect(
          events
            .slice(0, idx)
            .some(
              (s: Record<string, any>) =>
                s.eventType === 'AGENT_THINK_STARTED' &&
                s.content.agentId === c.content.agentId,
            ),
        ).toBe(true);
      }
    },
    120_000,
  );

  it(
    'no THINK text leaks into PUBLIC-visibility events (public SAYS stays public)',
    async () => {
      const events = await runMockGame();

      const completed = events.filter(
        (e: Record<string, any>) => e.eventType === 'AGENT_THINK_COMPLETED',
      );
      const thinkTexts = completed
        .map((e: Record<string, any>) => e.content.think)
        .filter((t: unknown) => typeof t === 'string' && (t as string).trim());
      expect(thinkTexts.length).toBeGreaterThan(0);

      const publicEvents = events.filter(
        (e: Record<string, any>) => e.visibility === 'PUBLIC',
      );
      expect(publicEvents.length).toBeGreaterThan(0);
      // Cycle-safe serializer: a public payload embedding a live player
      // object could otherwise crash the assertion instead of reporting it
      // (cycle-safe keeps the test's own failure mode a clean failure).
      const safeStringify = (v: unknown, seen = new Set()): string => {
        if (v === null || typeof v !== 'object') {
          return v === undefined ? '' : String(v);
        }
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
        return Array.isArray(v)
          ? '[' + v.map((x) => safeStringify(x, seen)).join(',') + ']'
          : '{' +
              Object.entries(v as Record<string, unknown>)
                .filter(([, val]) => val !== undefined)
                .map(([k, val]) => `${k}:${safeStringify(val, seen)}`)
                .join(',') +
              '}';
      };
      for (const ev of publicEvents) {
        const serialized = safeStringify(ev.content ?? {});
        for (const t of thinkTexts) {
          expect(serialized).not.toContain(t);
        }
        // The engine's mock THINK marker must never ride a public event.
        expect(serialized).not.toContain('[Private]');
      }
    },
    120_000,
  );
});

// ===========================================================================
// Adapter unit surface — translateAndPublishEvent mapping + storage
// ===========================================================================

describe('MAF-REV-003 adapter: THINK event mapping and persistence', () => {
  let eventBus: ReturnType<typeof createFakeEventBus>;
  let repo: ReturnType<typeof createSqliteBackedRepository>;
  let adapter: LegacyGameAdapter;

  const legacyThinkEvent = (
    eventType: 'AGENT_THINK_STARTED' | 'AGENT_THINK_COMPLETED',
    content: Record<string, unknown>,
  ) => ({
    eventType,
    playerId: 'p1',
    playerName: 'Alice',
    visibility: 'ADMIN_ONLY',
    phase: 'MAFIA_CHAT',
    content,
    round: 1,
    timestamp: new Date().toISOString(),
  });

  beforeEach(() => {
    eventBus = createFakeEventBus();
    repo = createSqliteBackedRepository();
    adapter = new LegacyGameAdapter(eventBus, repo as any);
    // The real adapter inserts the games row (raw SQL) before the bridge
    // streams events; mirror it so the events FK is satisfiable.
    repo.db
      .prepare(
        `INSERT INTO games (id, status, config, created_at) VALUES (?, 'IN_PROGRESS', ?, ?)`,
      )
      .run('g-think-1', JSON.stringify({ engineType: 'legacy' }), Date.now());
    repo.db
      .prepare(
        `INSERT INTO games (id, status, config, created_at) VALUES (?, 'IN_PROGRESS', ?, ?)`,
      )
      .run('g-think-2', JSON.stringify({ engineType: 'legacy' }), Date.now());
  });

  it('maps AGENT_THINK_COMPLETED unchanged, ADMIN_ONLY->ADMIN, and persists it via the repository', () => {
    (adapter as any).translateAndPublishEvent(
      'g-think-1',
      legacyThinkEvent('AGENT_THINK_COMPLETED', {
        agentId: 'p1',
        playerId: 'p1',
        think: 'Alice is lying about her vote.',
        role: 'SHERIFF',
        dayNumber: 1,
      }),
      4,
    );

    const published = eventBus.published.find(
      (e: GameEvent) => e.type === 'AGENT_THINK_COMPLETED',
    );
    expect(published).toBeDefined();
    expect(published!.visibility).toBe('ADMIN');
    expect((published!.data as any).think).toBe('Alice is lying about her vote.');

    // persisted — the REST GET /events surface
    const stored = repo.getEvents('g-think-1');
    expect(stored.some((e) => e.type === 'AGENT_THINK_COMPLETED')).toBe(true);
  });

  it('maps AGENT_THINK_STARTED unchanged with agent/player identification', () => {
    (adapter as any).translateAndPublishEvent(
      'g-think-1',
      legacyThinkEvent('AGENT_THINK_STARTED', {
        agentId: 'p1',
        playerId: 'p1',
        role: 'SHERIFF',
        dayNumber: 1,
      }),
      3,
    );

    const published = eventBus.published.find(
      (e: GameEvent) => e.type === 'AGENT_THINK_STARTED',
    );
    expect(published).toBeDefined();
    expect(published!.visibility).toBe('ADMIN');
    expect((published!.data as any).agentId).toBe('p1');
    expect(published!.actorId).toBe('p1');
  });

  it('keeps think out of PUBLIC SAYS events: a PUBLIC MESSAGE maps to AGENT_SAYS_BROADCASTED (PUBLIC) with no think key', () => {
    // Pre-fix convention the adapter must continue to uphold: the public
    // DAY_DISCUSSION broadcast carries only the statement — never think.
    (adapter as any).translateAndPublishEvent(
      'g-think-2',
      {
        eventType: 'MESSAGE',
        playerId: 'p1',
        playerName: 'Alice',
        visibility: 'PUBLIC',
        phase: 'DAY_DISCUSSION',
        content: { message: 'I think Alice is mafia.', messageNumber: 1 },
        round: 1,
        timestamp: new Date().toISOString(),
      },
      7,
    );

    const published = eventBus.published.find(
      (e: GameEvent) => e.type === 'AGENT_SAYS_BROADCASTED',
    );
    expect(published).toBeDefined();
    expect(published!.visibility).toBe('PUBLIC');
    expect((published!.data as any).think).toBeUndefined();
    expect(JSON.stringify(published!.data)).not.toContain('[Private]');
  });

  it('MAFIA_CHAT MESSAGE stays PRIVATE: think survives only under non-public visibility', () => {
    (adapter as any).translateAndPublishEvent(
      'g-think-2',
      {
        eventType: 'MESSAGE',
        playerId: 'p2',
        playerName: 'Bob',
        visibility: 'PRIVATE_MAFIA',
        phase: 'MAFIA_CHAT',
        content: { think: '[Private] plan', says: 'Vote Bob.', messageNumber: 1 },
        round: 1,
        timestamp: new Date().toISOString(),
      },
      8,
    );

    const published = eventBus.published.find(
      (e: GameEvent) => e.type === 'AGENT_SAYS_BROADCASTED',
    );
    expect(published).toBeDefined();
    expect(published!.visibility).toBe('PRIVATE');
    expect(published!.visibility).not.toBe('PUBLIC');
  });
});

// ===========================================================================
// Bridge -> adapter E2E: the REAL bridge child process, production path
// ===========================================================================

describe('MAF-REV-003 E2E: real legacy-bridge event stream persists THINK events', () => {
  it(
    'translating the bridge stream persists AGENT_THINK_COMPLETED (non-empty think, ADMIN) and no PUBLIC event carries think text',
    async () => {
      const gameId = 'g-think-e2e-' + Date.now().toString(36);
      const repo = createSqliteBackedRepository();
      const eventBus = createFakeEventBus();
      const adapter = new LegacyGameAdapter(eventBus, repo as any);

      // Mirror the real adapter's raw games insert (startGame) so the
      // events FK is satisfied before any translateAndPublishEvent call.
      repo.db
        .prepare(
          `INSERT INTO games (id, status, config, created_at) VALUES (?, 'IN_PROGRESS', ?, ?)`,
        )
        .run(gameId, JSON.stringify({ engineType: 'legacy', numPlayers: 5 }), Date.now());

      // Mock mode: an EMPTY (already-set) OPENAI_API_KEY is never overridden
      // by the bridge's dotenv .env load, so getAIResponse serves canned
      // mock responses — deterministic, no network.
      const child = spawn('node', [bridgePath, '--players', '5'], {
        env: {
          ...process.env,
          OPENAI_API_KEY: '',
          ENABLE_DATABASE: 'false',
          LOG_STRUCTURED: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

      let buffer = '';
      let sequence = 0;
      const stdoutDone = new Promise<void>((resolve, reject) => {
        const failTimer = setTimeout(
          () => reject(new Error('bridge did not finish within 90s')),
          90_000,
        );
        child.stdout.on('data', (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let parsed: any;
            try {
              parsed = JSON.parse(line);
            } catch {
              continue; // engine chatter never reaches stdout; defensive
            }
            if (parsed.type === 'event') {
              sequence += 1;
              // EXACTLY the production call shape (handleBridgeMessage -> case 'event')
              (adapter as any).translateAndPublishEvent(
                gameId,
                parsed,
                sequence,
              );
            }
          }
        });
        child.on('close', (code: number | null) => {
          clearTimeout(failTimer);
          if (code !== 0) {
            reject(
              new Error(
                `bridge exited ${code}: ` +
                  Buffer.concat(stderrChunks).toString().slice(-2000),
              ),
            );
          } else {
            resolve();
          }
        });
        child.on('error', reject);
      });

      try {
        await stdoutDone;
      } finally {
        try {
          child.kill('SIGTERM');
        } catch {
          // already gone
        }
      }

      const events: GameEvent[] = repo.getEvents(gameId);
      expect(events.length).toBeGreaterThan(0);

      const completed = events.filter(
        (e) => e.type === 'AGENT_THINK_COMPLETED',
      );
      expect(completed.length).toBeGreaterThan(0);
      const thinkTexts = completed.map(
        (e) => (e.data as any).think as string,
      );
      for (const t of thinkTexts) {
        expect(typeof t).toBe('string');
        expect(t.trim().length).toBeGreaterThan(0);
      }
      for (const e of completed) {
        expect(e.visibility).toBe('ADMIN');
        expect((e.data as any).agentId).toBeTruthy();
        expect((e.data as any).playerId).toBeTruthy();
      }

      const started = events.filter((e) => e.type === 'AGENT_THINK_STARTED');
      expect(started.length).toBeGreaterThanOrEqual(completed.length);

      // No think text in ANY public event; explicitly for public SAYS.
      const publicEvents = events.filter((e) => e.visibility === 'PUBLIC');
      expect(publicEvents.length).toBeGreaterThan(0);
      for (const e of publicEvents) {
        const serialized = JSON.stringify(e.data);
        for (const t of thinkTexts) {
          expect(serialized).not.toContain(t);
        }
        expect(serialized).not.toContain('[Private]');
      }
      const publicSays = events.filter(
        (e) => e.type === 'AGENT_SAYS_BROADCASTED' && e.visibility === 'PUBLIC',
      );
      expect(publicSays.length).toBeGreaterThan(0);
      for (const e of publicSays) {
        expect((e.data as any).think).toBeUndefined();
      }

      // EventBus also received every translated event (WS/SSE surface).
      expect(
        eventBus.published.some(
          (e: GameEvent) => e.type === 'AGENT_THINK_COMPLETED' && e.gameId === gameId,
        ),
      ).toBe(true);
    },
    120_000,
  );
});