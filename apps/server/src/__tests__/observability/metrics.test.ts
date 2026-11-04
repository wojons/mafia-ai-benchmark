/**
 * OBS-001 Tier-0 metrics — hermetic unit tests.
 *
 * No real game spawn, no LLM calls, no database: the adapter-level test
 * drives handleBridgeMessage with stubbed EventBus/repository (persistUsage
 * and the done-path DB block both no-op without a `db`), and the child
 * 'close' classifier is exercised as the exported pure function it is.
 *
 * Counters/gauges are process-global, so every value assertion is a
 * BEFORE/AFTER DELTA against a freshly rendered registry — never an
 * absolute count.
 */
import { describe, it, expect } from 'vitest';

import {
  registry,
  gameActive,
  gameEnded,
  gameFailed,
  gameDuration,
  recordGameTerminal,
  providerFromUsageRows,
  SERVER_VERSION,
  KNOWN_PROVIDER_PREFIXES,
  type MetricsGameRecord,
} from '../../observability/metrics.js';
import { LegacyGameAdapter, classifyTerminalClose } from '../../services/legacy-game-adapter.js';
import type { LegacyGameState } from '../../services/legacy-game-adapter.js';

const FAMILIES = [
  'mafia_server_up',
  'mafia_game_active',
  'mafia_game_ended_total',
  'mafia_game_failed_total',
  'mafia_game_duration_seconds',
];

/** prom-client label order is deterministic: labelNames order, then le. */
const ENDED_LINE = (outcome: string, provider: string) =>
  `mafia_game_ended_total{outcome="${outcome}",provider="${provider}"}`;
const FAILED_LINE = (reason: string) => `mafia_game_failed_total{reason="${reason}"}`;
const BUCKET_LINE = (provider: string, le: string) =>
  `mafia_game_duration_seconds_bucket{le="${le}",provider="${provider}"}`;

function render(): Promise<string> {
  return registry.metrics();
}

/** Value of the first sample line whose text starts with `prefix` (0 when absent). */
function valueOf(output: string, prefix: string): number {
  const line = output.split('\n').find((l) => l.startsWith(prefix));
  if (!line) return 0;
  const parsed = Number(line.slice(line.lastIndexOf(' ') + 1));
  return Number.isFinite(parsed) ? parsed : 0;
}

describe('OBS-001 Tier-0 metrics', () => {
  it('renders the registry in Prometheus text format', async () => {
    const out = await render();
    expect(out).toContain('# HELP');
    expect(out).toContain('# TYPE');
    expect(registry.contentType).toContain('text/plain');
  });

  it('exposes all five mafia_ families with TYPE declarations', async () => {
    const out = await render();
    for (const family of FAMILIES) {
      expect(out).toContain(`# TYPE ${family} `);
    }
  });

  it('reports mafia_server_up = 1 with a version label from the single constant', async () => {
    const out = await render();
    expect(SERVER_VERSION.length).toBeGreaterThan(0);
    expect(out).toMatch(new RegExp(`^mafia_server_up\\{version="${SERVER_VERSION}"\\} 1$`, 'm'));
  });

  it('exposes the eight configured duration histogram bounds', async () => {
    gameDuration(90, 'openai'); // land in a bucket so lines exist
    const out = await render();
    for (const le of ['60', '120', '300', '600', '900', '1800', '3600', '7200']) {
      expect(out).toMatch(new RegExp(`mafia_game_duration_seconds_bucket\\{le="${le}",`));
    }
    expect(out).toMatch(/mafia_game_duration_seconds_bucket\{le="\+Inf",/);
  });

  it('never renders forbidden high-cardinality label names', async () => {
    gameEnded('completed', 'openai');
    gameFailed('bridge_crash');
    gameDuration(65, 'openai');
    const out = await render();
    for (const forbidden of ['game_id', 'run_id', 'player_id', 'model_pair', 'seed']) {
      expect(out).not.toContain(forbidden);
    }
  });

  it('moves rendered values when the helpers are called', async () => {
    const before = await render();
    const activeBefore = valueOf(before, 'mafia_game_active ');
    const endedBefore = valueOf(before, ENDED_LINE('completed', 'openai'));
    const failedBefore = valueOf(before, FAILED_LINE('bridge_crash'));
    const bucketBefore = valueOf(before, BUCKET_LINE('openai', '120'));
    const sumBefore = valueOf(before, 'mafia_game_duration_seconds_sum{provider="openai"}');

    gameActive(1);
    gameEnded('completed', 'openai');
    gameFailed('bridge_crash');
    gameDuration(90, 'openai');

    const after = await render();
    expect(valueOf(after, 'mafia_game_active ')).toBe(activeBefore + 1);
    expect(valueOf(after, ENDED_LINE('completed', 'openai'))).toBe(endedBefore + 1);
    expect(valueOf(after, FAILED_LINE('bridge_crash'))).toBe(failedBefore + 1);
    expect(valueOf(after, BUCKET_LINE('openai', '120'))).toBe(bucketBefore + 1);
    expect(valueOf(after, 'mafia_game_duration_seconds_sum{provider="openai"}')).toBeGreaterThanOrEqual(sumBefore + 90);

    gameActive(-1); // restore the gauge for the remaining assertions
  });

  it('coerces labels into the closed sets instead of leaking them', async () => {
    gameEnded('not-a-real-outcome' as 'completed', 'CUSTOM/some-vendor-model');
    gameFailed('unheard-of-reason' as 'bridge_spawn');
    const out = await render();
    // bogus outcome coerces to 'failed'; 'CUSTOM/some-vendor-model' prefix normalizes to 'custom'
    expect(valueOf(out, ENDED_LINE('failed', 'custom'))).toBeGreaterThanOrEqual(1);
    expect(valueOf(out, FAILED_LINE('unknown'))).toBeGreaterThanOrEqual(1);
    // only closed provider prefixes are ever emitted
    expect([...KNOWN_PROVIDER_PREFIXES].sort()).toEqual([
      'anthropic',
      'custom',
      'google',
      'openai',
      'openrouter',
    ]);
    expect(providerFromUsageRows(undefined)).toBe('unknown');
    expect(providerFromUsageRows([{ provider: 'openai/gpt-x' }])).toBe('openai');
    expect(providerFromUsageRows([{ provider: 'CUSTOM/openai/gpt-x' }])).toBe('custom');
    expect(providerFromUsageRows([{ provider: 'weird-vendor/mystery' }])).toBe('unknown');
    expect(providerFromUsageRows([{ provider: '' }, { totalTokens: 5 }])).toBe('unknown');
  });

  it('records one simulated game lifecycle EXACTLY once despite the full terminal-signal storm', async () => {
    const state: MetricsGameRecord = {
      startedAt: new Date(Date.now() - 70_000),
      endedAt: new Date(),
    };

    // spawn accepted
    gameActive(1);
    const spawnActive = valueOf(await render(), 'mafia_game_active ');

    // One real game fires 'done', then 'close' (and a failed spawn also
    // fires 'error'): every signal routed through recordGameTerminal must
    // count exactly once.
    const endedBefore = valueOf(await render(), ENDED_LINE('completed', 'openai'));
    const failedBefore = valueOf(await render(), FAILED_LINE('bridge_crash'));
    const bucketBefore = valueOf(await render(), BUCKET_LINE('openai', '120'));

    expect(recordGameTerminal(state, { outcome: 'completed', provider: 'openai', durationSeconds: 70 })).toBe(true);
    expect(recordGameTerminal(state, { outcome: 'failed', reason: 'bridge_crash', provider: 'unknown' })).toBe(false);
    expect(recordGameTerminal(state, { outcome: 'cancelled', reason: 'unknown', provider: 'unknown' })).toBe(false);
    expect(recordGameTerminal(state, { outcome: 'failed', reason: 'bridge_spawn' })).toBe(false);

    const after = await render();
    expect(valueOf(after, ENDED_LINE('completed', 'openai'))).toBe(endedBefore + 1);
    expect(valueOf(after, FAILED_LINE('bridge_crash'))).toBe(failedBefore);
    expect(valueOf(after, BUCKET_LINE('openai', '120'))).toBe(bucketBefore + 1);
    // one spawn increment, one terminal decrement
    expect(valueOf(after, 'mafia_game_active ')).toBe(spawnActive - 1);
    // duration observed once
    expect(valueOf(after, 'mafia_game_duration_seconds_sum{provider="openai"}')).toBeGreaterThan(0);
  });

  it('keeps mafia_game_active clamped at zero (never below)', async () => {
    const current = valueOf(await render(), 'mafia_game_active ');
    for (let i = 0; i < current; i++) gameActive(-1);
    expect(valueOf(await render(), 'mafia_game_active ')).toBe(0);
    gameActive(-1); // extra decrement must not push the gauge negative
    expect(valueOf(await render(), 'mafia_game_active ')).toBe(0);
  });

  it('classifies terminal child exits into the closed outcome/reason sets', () => {
    const base: LegacyGameState = {
      gameId: 'obs001-classify',
      process: {} as LegacyGameState['process'],
      eventCount: 0,
      status: 'RUNNING',
      startedAt: new Date(),
    };

    expect(classifyTerminalClose(base, 1)).toEqual({
      outcome: 'failed',
      reason: 'bridge_crash',
      provider: undefined,
    });
    expect(classifyTerminalClose({ ...base, status: 'ERROR', error: 'engine exploded' }, 0)).toEqual({
      outcome: 'failed',
      reason: 'upstream_error',
      provider: undefined,
    });
    expect(classifyTerminalClose(base, null)).toEqual({
      outcome: 'cancelled',
      reason: 'unknown',
      provider: undefined,
    });
  });
});

describe('OBS-001 adapter-level single-count (stubbed bus + repository, no spawn)', () => {
  it('records the done path once and drops the simulated close that follows', async () => {
    type AdapterArgs = ConstructorParameters<typeof LegacyGameAdapter>;
    const stubBus = { publish: () => undefined } as AdapterArgs[0];
    const stubRepo = {
      db: undefined,
      setPlayersWon: () => undefined,
      backfillPlayerModel: () => undefined,
    } as AdapterArgs[1];
    const adapter = new LegacyGameAdapter(stubBus, stubRepo);

    const state: LegacyGameState = {
      gameId: 'obs001-adapter-g1',
      process: {} as LegacyGameState['process'],
      eventCount: 0,
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 70_000),
    };
    (adapter as unknown as { activeGames: Map<string, LegacyGameState> }).activeGames.set(
      state.gameId,
      state,
    );

    // Pad above the clamp floor so the terminal decrement is observable
    // as exactly -1 (the previous test parks the gauge at zero).
    gameActive(1);
    const activeBefore = valueOf(await render(), 'mafia_game_active ');
    const endedBefore = valueOf(await render(), ENDED_LINE('completed', 'anthropic'));
    const bucketBefore = valueOf(await render(), BUCKET_LINE('anthropic', '120'));

    // The bridge's 'done' message — the DB-touching block and persistUsage
    // both no-op on the stub (no `db`); publishEvent hits the stub bus.
    (
      adapter as unknown as {
        handleBridgeMessage: (gameId: string, message: Record<string, unknown>) => void;
      }
    ).handleBridgeMessage('obs001-adapter-g1', {
      type: 'done',
      winner: 'MAFIA',
      totalEvents: 10,
      usage: [{ provider: 'anthropic', model: 'claude-x', totalTokens: 5 }],
    });

    expect(state.metricsRecorded).toBe(true);
    expect(state.provider).toBe('anthropic');
    expect(state.endedAt).toBeInstanceOf(Date);

    // The child 'close' event ALWAYS fires after 'done' — replay exactly
    // what the close handler does: classify + guarded record. Must be a no-op.
    const closeRecord = classifyTerminalClose(state, 0);
    expect(closeRecord.outcome).toBe('cancelled'); // classifier describes the exit...
    expect(recordGameTerminal(state, closeRecord)).toBe(false); // ...guard drops it

    const after = await render();
    expect(valueOf(after, ENDED_LINE('completed', 'anthropic'))).toBe(endedBefore + 1);
    expect(valueOf(after, BUCKET_LINE('anthropic', '120'))).toBe(bucketBefore + 1);
    // exactly one active decrement for the whole lifecycle
    expect(valueOf(after, 'mafia_game_active ')).toBe(activeBefore - 1);
  });
});
