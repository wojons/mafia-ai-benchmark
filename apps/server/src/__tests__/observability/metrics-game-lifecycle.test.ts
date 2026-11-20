/**
 * DF-MAFIA-AI-BENCHMARK-50 — the LEGACY ADAPTER is the path this deployment
 * actually runs, so it is the path the mafia_game_* families have to be
 * emitted from.
 *
 * Live symptom this file pins: `/metrics` served every `mafia_game_*` series at
 * 0 beside 4,885 durable ENDED games. Two independent gaps produced that:
 *
 *   1. `mafia_game_ended_total` is process-lifetime by construction, so a
 *      restart reset it — the adapter's increments were real but described only
 *      the games that ended since boot (the boot seed in
 *      `metrics-game-seed.test.ts` closes that half).
 *   2. `mafia_game_active` was a blind ±1 delta. Any lifecycle edge the process
 *      missed (crash, restart, a `done` that never arrived) left it describing a
 *      different world than the `games` table, forever.
 *
 * What this file proves, through the REAL adapter + a REAL SQLite repository
 * (only the child-process launcher and the event bus are fakes — the adapter's
 * `spawn` option is the documented OBS-006 seam):
 *
 *   - AC2: a game that reaches a terminal status through the adapter increments
 *     `mafia_game_ended_total{outcome,provider}` once, with the game's own
 *     outcome and a provider label folded into the closed prefix set.
 *   - AC2: an unmappable provider spec ('weird-vendor/x') becomes `unknown`
 *     instead of minting a new label — the closed-cardinality rule.
 *   - AC3: `mafia_game_active` equals `COUNT(*) FROM games WHERE
 *     status='IN_PROGRESS'` at spawn, at `done`, and at child close — the same
 *     source of truth the gauge's own docstring names.
 *
 * Counters are process-global, so every counter assertion is a BEFORE/AFTER
 * delta read from a freshly rendered registry (prom-client asserts are not
 * used anywhere else in this suite either).
 */
import { describe, it, expect } from 'vitest';

import { registry } from '../../observability/metrics.js';
import {
  LegacyGameAdapter,
  type BridgeSpawn,
  type LegacyGameState,
} from '../../services/legacy-game-adapter.js';
import { createFakeEventBus, createSqliteBackedRepository } from '../services/mocks.js';

type DataListener = (chunk: Buffer) => void;
type CloseListener = (code: number | null, signal: string | null) => void;

interface FakeBridgeChild {
  pid: number;
  stdout: { on: (event: string, listener: DataListener) => void };
  stderr: { on: (event: string, listener: DataListener) => void };
  on: (event: string, listener: CloseListener) => void;
  kill: () => boolean;
  /** Push one line of bridge stdout (the adapter is line-buffered). */
  say: (text: string) => void;
  /** Fire the child 'close' event exactly as Node does. */
  exit: (code: number | null, signal?: string | null) => void;
}

/**
 * The OBS-006 spawn seam, faked: records every launched child so a test can
 * speak for it. Nothing here touches a real process, so the lifecycle edges
 * are deterministic.
 */
function createBridgeHarness(): {
  spawn: BridgeSpawn;
  children: FakeBridgeChild[];
  last: () => FakeBridgeChild;
} {
  const children: FakeBridgeChild[] = [];
  const spawn = (() => {
    const dataListeners: DataListener[] = [];
    const closeListeners: CloseListener[] = [];
    const child: FakeBridgeChild = {
      pid: 40_000 + children.length,
      stdout: {
        on: (event, listener) => {
          if (event === 'data') dataListeners.push(listener);
        },
      },
      stderr: { on: () => undefined },
      on: (event, listener) => {
        if (event === 'close') closeListeners.push(listener);
      },
      kill: () => true,
      say: (text) => {
        for (const listener of dataListeners) listener(Buffer.from(text));
      },
      exit: (code, signal = null) => {
        for (const listener of closeListeners) listener(code, signal);
      },
    };
    children.push(child);
    return child;
  }) as unknown as BridgeSpawn;

  return {
    spawn,
    children,
    last: () => {
      const child = children[children.length - 1];
      if (!child) throw new Error('no bridge child was spawned');
      return child;
    },
  };
}

async function render(): Promise<string> {
  return registry.metrics();
}

/** Value of one series line in the rendered registry, 0 when it was never created. */
function valueOf(text: string, prefix: string): number {
  for (const line of text.split('\n')) {
    if (!line.startsWith(prefix)) continue;
    const value = Number.parseFloat(line.slice(prefix.length).trim());
    return Number.isNaN(value) ? 0 : value;
  }
  return 0;
}

const ENDED_LINE = (outcome: string, provider: string): string =>
  `mafia_game_ended_total{outcome="${outcome}",provider="${provider}"}`;
const FAILED_LINE = (reason: string): string => `mafia_game_failed_total{reason="${reason}"}`;
const ACTIVE_LINE = 'mafia_game_active ';

/** The gauge's documented source of truth: the games table. */
function inProgressCount(db: { prepare: (sql: string) => { get: () => unknown } }): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM games WHERE status = 'IN_PROGRESS'`).get() as
    | { count?: number }
    | undefined;
  return row?.count ?? 0;
}

function readGame(db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } }, gameId: string): {
  status?: string;
} | undefined {
  return db.prepare('SELECT status FROM games WHERE id = ?').get(gameId) as
    | { status?: string }
    | undefined;
}

/** The bridge's real 'done' payload shape (usage rows carry real token counts). */
function doneMessage(provider: string): Record<string, unknown> {
  return {
    type: 'done',
    winner: 'TOWN',
    totalEvents: 6,
    usage: [
      {
        provider,
        model: `${provider.split('/')[1] ?? 'model'}-x`,
        promptTokens: 900,
        completionTokens: 300,
        totalTokens: 1_200,
        cost: 0.002,
        apiCalls: 6,
        latencyMs: 700,
      },
    ],
  };
}

describe('DF-MAFIA-AI-BENCHMARK-50 legacy adapter game metrics', () => {
  it('AC2: increments mafia_game_ended_total for the game\'s terminal status with a closed-set provider label', async () => {
    const repo = createSqliteBackedRepository();
    const harness = createBridgeHarness();
    const adapter = new LegacyGameAdapter(createFakeEventBus(), repo, { spawn: harness.spawn });

    const endedBefore = valueOf(await render(), ENDED_LINE('completed', 'openai'));

    const state: LegacyGameState = adapter.startGame({
      numPlayers: 5,
      roleModels: { MAFIA: 'openai/gpt-4o-mini', TOWN: 'openai/gpt-4o-mini' },
    });

    // The row the adapter inserted is the source of truth the metrics read.
    expect(readGame(repo.db, state.gameId)?.status).toBe('IN_PROGRESS');

    harness.last().say(`${JSON.stringify(doneMessage('openai/gpt-4o-mini'))}\n`);

    const after = await render();
    expect(valueOf(after, ENDED_LINE('completed', 'openai'))).toBe(endedBefore + 1);
    // Only the prefix is exposed — the model spec never becomes a label.
    expect(after).not.toContain('provider="openai/gpt-4o-mini"');
    expect(readGame(repo.db, state.gameId)?.status).toBe('ENDED');
    expect(state.metricsRecorded).toBe(true);
    expect(state.provider).toBe('openai');

    // The child exits right after 'done': the single-count guard must drop it.
    harness.last().exit(0);
    const settled = await render();
    expect(valueOf(settled, ENDED_LINE('completed', 'openai'))).toBe(endedBefore + 1);
  });

  it('AC2: a crash through the same path increments outcome="failed" + reason="bridge_crash"', async () => {
    const repo = createSqliteBackedRepository();
    const harness = createBridgeHarness();
    const adapter = new LegacyGameAdapter(createFakeEventBus(), repo, { spawn: harness.spawn });

    const before = await render();
    const endedBefore = valueOf(before, ENDED_LINE('failed', 'unknown'));
    const failedBefore = valueOf(before, FAILED_LINE('bridge_crash'));

    const state: LegacyGameState = adapter.startGame({ numPlayers: 5 });
    harness.last().exit(1);

    const after = await render();
    expect(valueOf(after, ENDED_LINE('failed', 'unknown'))).toBe(endedBefore + 1);
    expect(valueOf(after, FAILED_LINE('bridge_crash'))).toBe(failedBefore + 1);
    expect(readGame(repo.db, state.gameId)?.status).toBe('CANCELLED');
  });

  it('AC2: an unmappable provider spec folds into provider="unknown" instead of minting a label', async () => {
    const repo = createSqliteBackedRepository();
    const harness = createBridgeHarness();
    const adapter = new LegacyGameAdapter(createFakeEventBus(), repo, { spawn: harness.spawn });

    const endedBefore = valueOf(await render(), ENDED_LINE('completed', 'unknown'));

    adapter.startGame({ numPlayers: 5 });
    harness.last().say(`${JSON.stringify(doneMessage('weird-vendor/mystery-1'))}\n`);

    const after = await render();
    expect(valueOf(after, ENDED_LINE('completed', 'unknown'))).toBe(endedBefore + 1);
    expect(after).not.toContain('weird-vendor');
  });

  it('AC3: mafia_game_active equals the IN_PROGRESS row count at every lifecycle edge', async () => {
    const repo = createSqliteBackedRepository();
    const harness = createBridgeHarness();
    const adapter = new LegacyGameAdapter(createFakeEventBus(), repo, { spawn: harness.spawn });

    // Edge 1: spawn accepted -> the row exists and the gauge reads the table.
    const first = adapter.startGame({ numPlayers: 5 });
    expect(inProgressCount(repo.db)).toBe(1);
    expect(valueOf(await render(), ACTIVE_LINE)).toBe(1);

    const second = adapter.startGame({ numPlayers: 5 });
    expect(inProgressCount(repo.db)).toBe(2);
    expect(valueOf(await render(), ACTIVE_LINE)).toBe(2);

    // Edge 2: 'done' for the first game -> its row is ENDED, one still running.
    harness.children[0].say(`${JSON.stringify(doneMessage('anthropic/claude-haiku'))}\n`);
    expect(readGame(repo.db, first.gameId)?.status).toBe('ENDED');
    expect(inProgressCount(repo.db)).toBe(1);
    expect(valueOf(await render(), ACTIVE_LINE)).toBe(1);

    // Edge 3: the second child exits without 'done' -> its row stays
    // IN_PROGRESS on purpose (OBS-006's orphan evidence), and the gauge keeps
    // agreeing with the table rather than guessing from its own deltas.
    harness.children[1].exit(0);
    expect(readGame(repo.db, second.gameId)?.status).toBe('IN_PROGRESS');
    expect(inProgressCount(repo.db)).toBe(1);
    expect(valueOf(await render(), ACTIVE_LINE)).toBe(1);

    // A row that leaves the table's IN_PROGRESS set is removed from the gauge
    // by the NEXT reconciliation — the gauge never drifts from the table.
    repo.db.prepare(`UPDATE games SET status = 'ENDED', ended_at = ? WHERE id = ?`)
      .run(Date.now(), second.gameId);
    const final = adapter.startGame({ numPlayers: 5 });
    expect(readGame(repo.db, final.gameId)?.status).toBe('IN_PROGRESS');
    expect(valueOf(await render(), ACTIVE_LINE)).toBe(1);
  });
});
