/**
 * DF-MAFIA-AI-BENCHMARK-50 — boot seed for the CUMULATIVE game counters.
 *
 * The live deployment served `mafia_game_ended_total{outcome=*}` at 0 beside
 * 4,885 durable ENDED games. The adapter's increments were real, but a counter
 * that starts at 0 on every restart answers "what has THIS process finished",
 * not "are games finishing" — and the process had not finished a game since it
 * last booted. The seed replays the durable terminal rows ONCE at boot, through
 * the same closed-label fold the live path uses, so `/metrics` describes the
 * benchmark's history instead of the container's uptime.
 *
 * What this file pins:
 *   - the fold maps durable `games.status` (+ the DF-18 `config.degenerate`
 *     flag) onto the closed outcome set, and raw provider specs onto the closed
 *     prefix set — never a raw spelling;
 *   - the seed reads before it writes, is idempotent (second call = null), and a
 *     wedged DB leaves the pre-registered zeros plus a logged error;
 *   - `mafia_game_active` is seeded from the SAME query the adapter reconciles
 *     with, so gauge and table agree from the first scrape.
 */
import { describe, it, expect } from 'vitest';

import {
  aggregateTerminalGameRows,
  gameCountersSeedApplied,
  registry,
  seedGameCountersFromDatabase,
  type MetricsGameSeedDatabase,
} from '../../observability/metrics.js';
import { createSqliteBackedRepository } from '../services/mocks.js';

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

describe('DF-MAFIA-AI-BENCHMARK-50 game counter boot seed', () => {
  // Order matters: this file owns the process-wide one-shot guard, and the
  // wedged-DB arm must observe it BEFORE the applying arm consumes it.
  it('a wedged DB leaves the counters untouched instead of throwing', () => {
    const wedged = {
      prepare: () => {
        throw new Error('database is locked');
      },
    } as unknown as MetricsGameSeedDatabase;

    expect(seedGameCountersFromDatabase(wedged)).toBeNull();
    expect(gameCountersSeedApplied()).toBe(false);
  });

  it('folds raw terminal rows into the closed outcome/provider sets (pure)', () => {
    const aggregate = aggregateTerminalGameRows([
      { id: 'a', status: 'ENDED', config: '{"numPlayers":5}', providers: 'openai/gpt-4o-mini' },
      { id: 'b', status: 'ENDED', config: null, providers: null },
      { id: 'c', status: 'CANCELLED', config: '{}', providers: 'anthropic/claude-haiku' },
      {
        id: 'd',
        status: 'ENDED',
        config: '{"degenerate":1}',
        providers: 'weird-vendor/mystery,google/gemini-x',
      },
      // Not terminal / not a row: skipped, never counted.
      { id: 'e', status: 'IN_PROGRESS', config: '{}', providers: 'openai/x' },
      null,
    ]);

    expect(aggregate.terminal).toBe(6);
    expect(aggregate.seeded).toBe(4);
    expect(aggregate.skipped).toBe(2);
    expect(aggregate.ended).toBe(3);
    expect(aggregate.cancelled).toBe(1);
    expect(aggregate.degenerate).toBe(1);
    expect(aggregate.active).toBeNull(); // pure fold never touches the gauge
    expect(aggregate.series).toEqual(
      expect.arrayContaining([
        { outcome: 'completed', provider: 'openai', count: 1 },
        { outcome: 'completed', provider: 'unknown', count: 1 },
        { outcome: 'cancelled', provider: 'anthropic', count: 1 },
        // First spec that maps wins; the raw spelling is dropped entirely.
        { outcome: 'degenerate', provider: 'google', count: 1 },
      ]),
    );
    expect(aggregate.series).toHaveLength(4);
  });

  it('seeds mafia_game_ended_total from durable rows once, and mafia_game_active from the same table', async () => {
    const repo = createSqliteBackedRepository();
    const now = Date.now();

    repo.seedGame({
      id: 'seed-ended-openai',
      status: 'ENDED',
      startedAt: now - 60_000,
      endedAt: now,
      players: [
        { id: 'p1', name: 'a', role: 'MAFIA', joinOrder: 1, provider: 'openai', model: 'gpt-4o-mini' },
      ],
    });
    repo.seedGame({ id: 'seed-ended-unattributed', status: 'ENDED', endedAt: now });
    repo.seedGame({
      id: 'seed-cancelled-anthropic',
      status: 'CANCELLED',
      endedAt: now,
      players: [
        { id: 'p2', name: 'b', role: 'TOWN', joinOrder: 1, provider: 'anthropic', model: 'claude-haiku' },
      ],
    });
    // DF-18 degenerate flag: written by the adapter at completion, so seed it
    // exactly the way the adapter does (json_set inside games.config).
    repo.db
      .prepare(
        `INSERT INTO games (id, status, config, created_at, started_at, ended_at)
         VALUES (?, 'ENDED', ?, ?, ?, ?)`,
      )
      .run('seed-ended-degenerate', JSON.stringify({ numPlayers: 5, degenerate: 1 }), now, now, now);
    // Two live rows: the gauge's source of truth.
    repo.seedGame({ id: 'seed-live-1', status: 'IN_PROGRESS', startedAt: now });
    repo.seedGame({ id: 'seed-live-2', status: 'IN_PROGRESS', startedAt: now });

    const before = await render();
    const deltas = {
      openai: valueOf(before, ENDED_LINE('completed', 'openai')),
      unknownCompleted: valueOf(before, ENDED_LINE('completed', 'unknown')),
      anthropicCancelled: valueOf(before, ENDED_LINE('cancelled', 'anthropic')),
      degenerate: valueOf(before, ENDED_LINE('degenerate', 'unknown')),
    };

    const aggregate = seedGameCountersFromDatabase(repo.db as unknown as MetricsGameSeedDatabase);
    expect(aggregate).not.toBeNull();
    expect(aggregate).toMatchObject({
      terminal: 4,
      seeded: 4,
      skipped: 0,
      ended: 3,
      cancelled: 1,
      degenerate: 1,
      active: 2,
    });
    expect(gameCountersSeedApplied()).toBe(true);

    const after = await render();
    expect(valueOf(after, ENDED_LINE('completed', 'openai'))).toBe(deltas.openai + 1);
    expect(valueOf(after, ENDED_LINE('completed', 'unknown'))).toBe(deltas.unknownCompleted + 1);
    expect(valueOf(after, ENDED_LINE('cancelled', 'anthropic'))).toBe(
      deltas.anthropicCancelled + 1,
    );
    expect(valueOf(after, ENDED_LINE('degenerate', 'unknown'))).toBe(deltas.degenerate + 1);
    // Same source of truth as the adapter reconciliation.
    expect(valueOf(after, 'mafia_game_active ')).toBe(2);

    // Idempotent: a second boot-time call must return null and touch nothing.
    expect(seedGameCountersFromDatabase(repo.db as unknown as MetricsGameSeedDatabase)).toBeNull();
    const again = await render();
    expect(valueOf(again, ENDED_LINE('completed', 'openai'))).toBe(deltas.openai + 1);
    expect(valueOf(again, 'mafia_game_active ')).toBe(2);
  });
});
