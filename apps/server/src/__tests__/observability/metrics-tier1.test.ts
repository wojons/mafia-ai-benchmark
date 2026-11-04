/**
 * OBS-002 Tier-1 metrics — hermetic unit tests.
 *
 * No real game spawn, no LLM calls, no network: the adapter-level cases drive
 * the same entry points the child-process listeners use
 * (handleChildClose / observeChildLog) and the run-level case drives
 * BenchmarkRunner against an in-memory SQLite database.
 *
 * Counters/gauges are process-global, so every value assertion is a
 * BEFORE/AFTER DELTA against a freshly rendered registry — never an absolute
 * count.
 */
import { describe, it, expect } from 'vitest';

import {
  registry,
  MODEL_ALLOWLIST,
  OTHER_MODEL_LABEL,
  BENCHMARK_RUN_STATUSES,
  LLM_RETRY_REASONS,
  ChildLogObserver,
  benchmarkRunTerminal,
  classifyChildLogLine,
  normalizeModel,
  recordFailedGameRequests,
  recordLlmUsage,
  refreshBenchmarkGauges,
  type MetricsGaugeDatabase,
} from '../../observability/metrics.js';
import { LegacyGameAdapter } from '../../services/legacy-game-adapter.js';
import type { LegacyGameState } from '../../services/legacy-game-adapter.js';
import { BenchmarkRunner, STALE_RUN_MAX_MS } from '../../services/benchmark-runner.js';
import type { GameEngine } from '../../services/game-engine.js';
import {
  createFakeAgentCoordinator,
  createFakeEventBus,
  createFakeStatsCollector,
  createSqliteBackedRepository,
} from '../services/mocks.js';

/** The ten Tier-1 families from docs/observability-spec.md section 3.2. */
const TIER1_FAMILIES = [
  'mafia_benchmark_run_total',
  'mafia_benchmark_run_duration_seconds',
  'mafia_benchmark_run_stranded',
  'mafia_benchmark_games_queued',
  'mafia_llm_request_total',
  'mafia_llm_request_duration_seconds',
  'mafia_llm_tokens_total',
  'mafia_llm_cost_usd_total',
  'mafia_llm_budget_exhausted_total',
  'mafia_llm_retry_total',
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

const RUN_TOTAL = (status: string) => `mafia_benchmark_run_total{status="${status}"}`;
const REQUEST_LINE = (provider: string, model: string, outcome: string) =>
  `mafia_llm_request_total{provider="${provider}",model="${model}",outcome="${outcome}"}`;
const TOKEN_LINE = (provider: string, model: string, direction: string) =>
  `mafia_llm_tokens_total{provider="${provider}",model="${model}",direction="${direction}"}`;

/** Minimal adapter stubs: no bus traffic beyond a no-op publish, no DB. */
function makeAdapter(repo: unknown): LegacyGameAdapter {
  type AdapterArgs = ConstructorParameters<typeof LegacyGameAdapter>;
  const stubBus = { publish: () => undefined } as unknown as AdapterArgs[0];
  return new LegacyGameAdapter(stubBus, repo as AdapterArgs[1]);
}

/** Register a RUNNING game the way startGame does, without spawning a child. */
function primeGame(
  adapter: LegacyGameAdapter,
  gameId: string,
  roleModels: Record<string, string>,
): LegacyGameState {
  const state: LegacyGameState = {
    gameId,
    process: {} as LegacyGameState['process'],
    eventCount: 0,
    status: 'RUNNING',
    startedAt: new Date(Date.now() - 5_000),
  };
  (
    adapter as unknown as { activeGames: Map<string, LegacyGameState> }
  ).activeGames.set(gameId, state);
  (
    adapter as unknown as { gameConfigs: Map<string, unknown> }
  ).gameConfigs.set(gameId, { numPlayers: 5, roleModels });
  return state;
}

describe('OBS-002 Tier-1 metrics catalogue', () => {
  it('renders at least one sample line for every one of the ten families on a fresh registry', async () => {
    const out = await render();
    for (const family of TIER1_FAMILIES) {
      const samples = familyLines(out, family);
      expect(samples.length, `no sample line for ${family}`).toBeGreaterThan(0);
      expect(out).toContain(`# TYPE ${family} `);
    }
  });

  it('pre-registers every closed run status and every closed retry reason at zero', async () => {
    const out = await render();
    const runLines = familyLines(out, 'mafia_benchmark_run_total');
    for (const status of BENCHMARK_RUN_STATUSES) {
      expect(
        runLines.some((line) => line.startsWith(`${RUN_TOTAL(status)} `)),
        `missing pre-registered series for status=${status}`,
      ).toBe(true);
    }
    for (const reason of LLM_RETRY_REASONS) {
      expect(out).toMatch(new RegExp(`^mafia_llm_retry_total\\{[^}]*reason="${reason}"[^}]*\\} `, 'm'));
    }
  });

  it('exposes the spec 3.2 latency buckets, reaching past the observed 65 s max', async () => {
    const out = await render();
    for (const le of ['0.25', '0.5', '1', '2', '5', '10', '30', '60', '120']) {
      expect(out).toMatch(new RegExp(`mafia_llm_request_duration_seconds_bucket\\{[^}]*le="${le.replace('.', '\\.')}"`));
    }
    expect(out).toMatch(/mafia_llm_request_duration_seconds_bucket\{[^}]*le="\+Inf"/);
  });

  it('never renders forbidden high-cardinality label names', async () => {
    recordLlmUsage([
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 10,
        completionTokens: 2,
        cost: 0.0001,
        apiCalls: 1,
        latencyMs: 100,
      },
    ]);
    const out = await render();
    for (const forbidden of ['game_id', 'run_id', 'player_id', 'model_pair', 'seed']) {
      expect(out).not.toContain(forbidden);
    }
  });
});

describe('OBS-002 model cardinality policy', () => {
  it('bounds the model label to the allow-list plus "other"', async () => {
    const before = await render();
    const otherBefore = valueOf(before, REQUEST_LINE('openai', OTHER_MODEL_LABEL, 'completed'));

    for (let i = 0; i < 300; i += 1) {
      recordLlmUsage([
        {
          provider: 'openai',
          model: `mystery-vendor/model-${i}`,
          promptTokens: 1,
          completionTokens: 1,
          cost: 0,
          apiCalls: 1,
          latencyMs: 0,
        },
      ]);
    }

    const out = await render();
    const lines = familyLines(out, 'mafia_llm_request_total');
    const modelValues = new Set(
      lines
        .map((line) => /model="([^"]*)"/.exec(line)?.[1])
        .filter((value): value is string => typeof value === 'string'),
    );

    expect(modelsBoundViolation(modelValues)).toBeUndefined();
    expect(modelValues.size).toBeLessThanOrEqual(MODEL_ALLOWLIST.length + 1);
    expect(lines.length).toBeLessThan(200);
    // every one of the 300 unknown names landed on the single 'other' series
    expect(valueOf(out, REQUEST_LINE('openai', OTHER_MODEL_LABEL, 'completed'))).toBe(
      otherBefore + 300,
    );
  });

  it('normalizes prefixed spellings onto one canonical model and coerces junk', () => {
    expect(normalizeModel('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(normalizeModel('OPENAI/GPT-4O')).toBe('gpt-4o');
    expect(normalizeModel(`  ${MODEL_ALLOWLIST[0]}  `)).toBe(MODEL_ALLOWLIST[0]);
    expect(normalizeModel(undefined)).toBe(OTHER_MODEL_LABEL);
    expect(normalizeModel({ model: 'gpt-4o' })).toBe(OTHER_MODEL_LABEL);
    expect(normalizeModel('openrouter/anthropic/claude-3-haiku')).toBe(OTHER_MODEL_LABEL);
  });
});

/** Returns the first out-of-policy model label, or undefined when all are legal. */
function modelsBoundViolation(models: Set<string>): string | undefined {
  const allowed = new Set<string>([...MODEL_ALLOWLIST, OTHER_MODEL_LABEL]);
  for (const model of models) {
    if (!allowed.has(model)) return model;
  }
  return undefined;
}

describe('OBS-002 LLM accounting', () => {
  it('sums cost exactly from the recorded usage rows (spec 6.2 cross-check)', async () => {
    const rows = [
      { provider: 'openai', model: 'gpt-4o-mini', cost: 0.0123, promptTokens: 100, completionTokens: 40, apiCalls: 3, latencyMs: 848 },
      { provider: 'openai', model: 'openai/gpt-4o', cost: 0.45, promptTokens: 900, completionTokens: 220, apiCalls: 2, latencyMs: 1500 },
      { provider: 'openrouter', model: 'mystery-vendor/model-9', cost: 0.0009, promptTokens: 7, completionTokens: 1, apiCalls: 1, latencyMs: 65_000 },
      // an invalid row must not shift the counter at all
      { provider: '', model: 'gpt-4o', cost: 9.99, promptTokens: 1, completionTokens: 1, apiCalls: 1 },
    ];
    const before = sumFamily(await render(), 'mafia_llm_cost_usd_total');
    recordLlmUsage(rows);
    const after = sumFamily(await render(), 'mafia_llm_cost_usd_total');
    expect(after - before).toBeCloseTo(0.0123 + 0.45 + 0.0009, 6);
  });

  it('records prompt and completion tokens separately, and observes latency once per model row', async () => {
    const before = await render();
    const promptBefore = valueOf(before, TOKEN_LINE('anthropic', 'claude-3-haiku', 'prompt'));
    const completionBefore = valueOf(before, TOKEN_LINE('anthropic', 'claude-3-haiku', 'completion'));
    const durationSumPrefix = 'mafia_llm_request_duration_seconds_sum{provider="anthropic",model="claude-3-haiku"}';
    const durationCountPrefix = 'mafia_llm_request_duration_seconds_count{provider="anthropic",model="claude-3-haiku"}';
    const durationSumBefore = valueOf(before, durationSumPrefix);
    const durationCountBefore = valueOf(before, durationCountPrefix);

    recordLlmUsage(
      [
        {
          provider: 'Anthropic',
          model: 'claude-3-haiku',
          promptTokens: 120,
          completionTokens: 30,
          cost: 0.002,
          apiCalls: 2,
          latencyMs: 1500,
        },
      ],
      // per-player rows repeat the SAME tokens/cost — they must not add
      // requests or latency on top of the per-model row
      [
        {
          playerId: 'p1',
          provider: 'Anthropic',
          model: 'claude-3-haiku',
          promptTokens: 60,
          completionTokens: 15,
          cost: 0.001,
          apiCalls: 1,
          latencyMs: 1500,
        },
      ],
    );

    const after = await render();
    expect(valueOf(after, TOKEN_LINE('anthropic', 'claude-3-haiku', 'prompt'))).toBe(promptBefore + 180);
    expect(valueOf(after, TOKEN_LINE('anthropic', 'claude-3-haiku', 'completion'))).toBe(completionBefore + 45);
    // one observation for the per-model row only
    expect(valueOf(after, durationCountPrefix)).toBe(durationCountBefore + 1);
    expect(valueOf(after, durationSumPrefix)).toBeCloseTo(durationSumBefore + 1.5, 6);
  });

  it('records failed requests from child-exit evidence even though api_calls.status_code says 200', async () => {
    const repo = createSqliteBackedRepository();
    const gameId = 'obs002-failed-child';
    repo.seedGame({ id: gameId, status: 'IN_PROGRESS' });
    repo.insertApiCall({
      gameId,
      playerId: 'ALL',
      provider: 'openai',
      model: 'gpt-4o-mini',
      endpoint: 'legacy-engine',
      latency: 900,
      statusCode: 200,
    });

    const adapter = makeAdapter(repo);
    primeGame(adapter, gameId, { MAFIA: 'openai/gpt-4o-mini', TOWN: 'openai/gpt-4o-mini' });

    const before = await render();
    const failedBefore = valueOf(before, REQUEST_LINE('openai', 'gpt-4o-mini', 'failed'));
    const completedBefore = valueOf(before, REQUEST_LINE('openai', 'gpt-4o-mini', 'completed'));

    // The bridge child dies before any 'done' message: the adapter's terminal
    // evidence is the non-zero exit.
    (
      adapter as unknown as { handleChildClose: (id: string, code: number | null) => void }
    ).handleChildClose(gameId, 1);

    const after = await render();
    expect(valueOf(after, REQUEST_LINE('openai', 'gpt-4o-mini', 'failed'))).toBe(failedBefore + 1);
    // a failure never fabricates a completed request
    expect(valueOf(after, REQUEST_LINE('openai', 'gpt-4o-mini', 'completed'))).toBe(completedBefore);

    // ...and the row it would have been tempting to read still claims 200.
    const persisted = repo.db
      .prepare('SELECT status_code FROM api_calls WHERE game_id = ? AND player_id = ?')
      .get(gameId, 'ALL') as { status_code: number };
    expect(persisted.status_code).toBe(200);
  });

  it('collapses prefixed and bare spellings onto one series and never invents a model', async () => {
    const before = await render();
    const failedBefore = valueOf(before, REQUEST_LINE('openai', 'gpt-4o-mini', 'failed'));
    const fallbackBefore = valueOf(before, REQUEST_LINE('unknown', OTHER_MODEL_LABEL, 'failed'));

    recordFailedGameRequests([{ provider: 'openai', model: 'gpt-4o-mini' }]);
    recordFailedGameRequests([{ provider: 'openai', model: 'openai/gpt-4o-mini' }]);
    // a game with no resolvable model lands on the closed unknown/other series
    recordFailedGameRequests([]);

    const after = await render();
    expect(valueOf(after, REQUEST_LINE('openai', 'gpt-4o-mini', 'failed'))).toBe(failedBefore + 2);
    expect(valueOf(after, REQUEST_LINE('unknown', OTHER_MODEL_LABEL, 'failed'))).toBe(fallbackBefore + 1);
  });
});

describe('OBS-002 budget/retry evidence from the child log stream', () => {
  it('classifies the engine budget stop and both retry causes into the closed sets', () => {
    expect(
      classifyChildLogLine(
        '[COST] Budget limit reached for Alice! Remaining: $0.00. Stopping further API calls for this player.',
      ),
    ).toEqual({ kind: 'budget' });
    expect(
      classifyChildLogLine(
        '[WARN] API 400 for Alice (openai/gpt-4o-mini) rejected response_format — retrying WITHOUT structured output (1/3)...',
      ),
    ).toEqual({ kind: 'retry', reason: 'response_format' });
    expect(
      classifyChildLogLine('[WARN] Network error for Bob, retrying (1/3)...'),
    ).toEqual({ kind: 'retry', reason: 'network_error' });
    expect(
      classifyChildLogLine('[WARN] JSON parse failed for Carol, retrying (1/2)...'),
    ).toEqual({ kind: 'retry', reason: 'parse_error' });
    expect(classifyChildLogLine('ordinary engine chatter')).toBeNull();
    expect(classifyChildLogLine(undefined)).toBeNull();
  });

  it('buffers partial stderr lines so a signature split across chunks still counts', () => {
    const observer = new ChildLogObserver();
    expect(observer.push('g1', '[WARN] Network error for Bob, retr')).toEqual([]);
    expect(observer.push('g1', 'ying (1/3)...\n')).toEqual([{ kind: 'retry', reason: 'network_error' }]);
    // unrelated lines never produce a signal
    expect(observer.push('g1', 'loading engine\nstarting game\n')).toEqual([]);
    observer.forget('g1');
    // after forget a continuation is no longer joined to the old buffer
    expect(observer.push('g1', 'ying (2/3)...\n')).toEqual([]);
  });

  it('counts budget stops and retries through the adapter with the configured provider hint', async () => {
    const adapter = makeAdapter({ db: undefined });
    const gameId = 'obs002-child-log';
    primeGame(adapter, gameId, { MAFIA: 'anthropic/claude-3-haiku', TOWN: 'anthropic/claude-3-haiku' });

    const before = await render();
    const budgetBefore = valueOf(before, 'mafia_llm_budget_exhausted_total{provider="anthropic"}');
    const retryBefore = valueOf(before, 'mafia_llm_retry_total{provider="anthropic",reason="response_format"}');

    const observe = (adapter as unknown as { observeChildLog: (id: string, text: string) => void })
      .observeChildLog.bind(adapter);
    observe(
      gameId,
      '[COST] Budget limit reached for Alice! Remaining: $0.00. Stopping further API calls for this player.\n',
    );
    observe(
      gameId,
      '[WARN] API 400 for Alice (anthropic/claude-3-haiku) rejected response_format — retrying WITHOUT structured output (1/3)...\n',
    );

    const after = await render();
    expect(valueOf(after, 'mafia_llm_budget_exhausted_total{provider="anthropic"}')).toBe(budgetBefore + 1);
    expect(valueOf(after, 'mafia_llm_retry_total{provider="anthropic",reason="response_format"}')).toBe(retryBefore + 1);
  });
});

describe('OBS-002 benchmark run gauges and single-count guard', () => {
  const gaugeDb = (repo: ReturnType<typeof createSqliteBackedRepository>) =>
    repo.db as unknown as MetricsGaugeDatabase;

  it('reflects non-terminal runs past the 7-day window and reads 0 when there are none', async () => {
    const repo = createSqliteBackedRepository();
    const now = Date.now();
    repo.insertBenchmarkRun({
      id: 'obs002-old-running',
      status: 'RUNNING',
      created_at: now - STALE_RUN_MAX_MS - 1_000,
      config: { models: ['openai/gpt-4o-mini', 'openai/gpt-4o'] },
    });
    repo.insertBenchmarkRun({
      id: 'obs002-fresh-running',
      status: 'RUNNING',
      created_at: now - 60_000,
      config: { models: ['openai/gpt-4o-mini', 'openai/gpt-4o'] },
    });
    repo.insertBenchmarkRun({
      id: 'obs002-old-completed',
      status: 'COMPLETED',
      created_at: now - STALE_RUN_MAX_MS - 1_000,
      completed_at: now - 1_000,
      config: { models: ['openai/gpt-4o-mini', 'openai/gpt-4o'] },
    });
    // benchmark_games.game_id is FK-bound to games(id)
    repo.seedGame({ id: 'obs002-pending-game', status: 'IN_PROGRESS' });
    repo.insertBenchmarkGame({
      game_id: 'obs002-pending-game',
      run_id: 'obs002-fresh-running',
      pairing_id: 'pair-1',
      model_a: 'openai/gpt-4o-mini',
      model_b: 'openai/gpt-4o',
      seed: 0,
      model_a_role: 'VILLAGER',
      model_b_role: 'VILLAGER',
    });

    const snapshot = refreshBenchmarkGauges(gaugeDb(repo), STALE_RUN_MAX_MS, now);
    expect(snapshot).toEqual({ stranded: 1, queued: 1 });
    const out = await render();
    expect(valueOf(out, 'mafia_benchmark_run_stranded ')).toBe(1);
    expect(valueOf(out, 'mafia_benchmark_games_queued ')).toBe(1);

    // Terminalising the stranded run drives the gauge back to zero.
    repo.db.prepare("UPDATE benchmark_runs SET status = 'FAILED' WHERE id = 'obs002-old-running'").run();
    const cleared = refreshBenchmarkGauges(gaugeDb(repo), STALE_RUN_MAX_MS, now);
    expect(cleared).toEqual({ stranded: 0, queued: 1 });
    expect(valueOf(await render(), 'mafia_benchmark_run_stranded ')).toBe(0);
  });

  it('reads 0 stranded on a clean database', async () => {
    const repo = createSqliteBackedRepository();
    expect(refreshBenchmarkGauges(gaugeDb(repo), STALE_RUN_MAX_MS)).toEqual({ stranded: 0, queued: 0 });
    expect(valueOf(await render(), 'mafia_benchmark_run_stranded ')).toBe(0);
  });

  it('never throws when the database is unavailable (a wedged DB must not 500 the scrape)', () => {
    const broken: MetricsGaugeDatabase = {
      prepare() {
        throw new Error('database is locked');
      },
    };
    expect(refreshBenchmarkGauges(broken, STALE_RUN_MAX_MS)).toBeNull();
  });

  it('counts one terminal transition once even when several writers terminalise the same run', async () => {
    const repo = createSqliteBackedRepository();
    repo.insertBenchmarkRun({
      id: 'obs002-cancel-once',
      status: 'RUNNING',
      created_at: Date.now() - 90_000,
      config: { models: ['openai/gpt-4o-mini', 'openai/gpt-4o'] },
    });
    const runner = new BenchmarkRunner({
      gameEngine: {} as GameEngine,
      agentCoordinator: createFakeAgentCoordinator(),
      eventBus: createFakeEventBus(),
      statsCollector: createFakeStatsCollector(),
      gameRepository: repo as unknown as ConstructorParameters<typeof BenchmarkRunner>[0]['gameRepository'],
    });

    const before = await render();
    const cancelledBefore = valueOf(before, RUN_TOTAL('CANCELLED'));
    const failedBefore = valueOf(before, RUN_TOTAL('FAILED'));
    const durationCountBefore = valueOf(before, 'mafia_benchmark_run_duration_seconds_count ');

    expect(runner.cancel('obs002-cancel-once')).toBe(true);
    expect(runner.cancel('obs002-cancel-once')).toBe(false);
    // a second terminal writer for the same run must also be a no-op
    (
      runner as unknown as {
        recordRunTerminal: (id: string, status: string, completedAt: number) => void;
      }
    ).recordRunTerminal('obs002-cancel-once', 'FAILED', Date.now());

    const after = await render();
    expect(valueOf(after, RUN_TOTAL('CANCELLED'))).toBe(cancelledBefore + 1);
    expect(valueOf(after, RUN_TOTAL('FAILED'))).toBe(failedBefore);
    expect(valueOf(after, 'mafia_benchmark_run_duration_seconds_count ')).toBe(durationCountBefore + 1);
    // the duration is measured from the persisted created_at (90 s ago)
    expect(valueOf(after, 'mafia_benchmark_run_duration_seconds_sum ')).toBeGreaterThanOrEqual(90);
  });

  it('ignores non-terminal run statuses instead of counting them', () => {
    expect(benchmarkRunTerminal('RUNNING')).toBe(false);
    expect(benchmarkRunTerminal('not-a-status')).toBe(false);
    expect(benchmarkRunTerminal(undefined)).toBe(false);
  });
});
