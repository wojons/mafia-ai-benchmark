/**
 * OBS-002 Tier-1 LLM accounting — the CUMULATIVE-at-boot contract.
 *
 * `mafia_llm_cost_usd_total` answers "what have we spent, cumulatively, per
 * model" (spec 3.2) and `token_usage` is the durable record of that number, so
 * the boot seed must make the counter agree with the table — otherwise the
 * spec 6.2 cross-check is unsatisfiable on any stack that has history (the
 * live DB carried $95 of spend while a freshly booted counter read 0.000).
 *
 * Counters are process-global, so every assertion is a BEFORE/AFTER delta
 * against a freshly rendered registry, never an absolute count.
 */
import { describe, it, expect } from 'vitest';

import {
  LLM_USAGE_SEED_SQL,
  METRIC_MODEL_LABELS,
  aggregateLlmUsageGroups,
  llmUsageSeedApplied,
  registry,
  seedLlmUsageFromDatabase,
  type MetricsSeedDatabase,
} from '../../observability/metrics.js';
import { createSqliteBackedRepository } from '../services/mocks.js';

function render(): Promise<string> {
  return registry.metrics();
}

/** Sum of every sample line of a family, optionally narrowed to a label suffix. */
function sumFamily(output: string, family: string, labelFilter?: string): number {
  let sum = 0;
  for (const line of output.split('\n')) {
    if (!line.startsWith(`${family}{`) && !line.startsWith(`${family} `)) continue;
    if (labelFilter && !line.includes(labelFilter)) continue;
    const parsed = Number(line.slice(line.lastIndexOf(' ') + 1));
    if (Number.isFinite(parsed)) sum += parsed;
  }
  return sum;
}

/** Sample lines (not # HELP/# TYPE) belonging to exactly one family name. */
function familyLines(output: string, family: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(`${family}{`) || line.startsWith(`${family} `));
}

describe('OBS-002 boot seed — raw groups fold into the closed label set', () => {
  it('collapses prefixed/bare duplicates and unknown spellings without minting a series per model', () => {
    const aggregate = aggregateLlmUsageGroups([
      // Prefixed and bare spellings of the SAME model must land on one series.
      { provider: 'openai', model: 'openai/gpt-4o-mini', rows: 2, promptTokens: 1000, completionTokens: 200, cost: 0.0015 },
      { provider: 'openai', model: 'gpt-4o-mini', rows: 1, promptTokens: 500, completionTokens: 100, cost: 0.00075 },
      // Case-insensitive provider prefix, allow-listed model.
      { provider: 'CUSTOM', model: 'gpt-4o', rows: 1, promptTokens: 100, completionTokens: 50, cost: 0.02 },
      // A model the allow-list does not name: 'other', never its own series.
      { provider: 'custom', model: 'my-local-model', rows: 1, promptTokens: 2000, completionTokens: 400, cost: 0.01 },
      // The legacy DF-MAFIA-AI-BENCHMARK-22 shape already in the live DB.
      { provider: '[object Object]', model: '[object Object]', rows: 1, promptTokens: 10, completionTokens: 5, cost: 0.5 },
      // Junk that must be dropped, never subtracted.
      { provider: 'openai', model: 'gpt-4o', rows: 1, promptTokens: -5, completionTokens: 0, cost: -3 },
      null,
      'not-a-row',
    ]);

    expect(aggregate.groups).toBe(6);
    // 2+1+1+1+1+1: the junk row still represents one durable row (its negative
    // amounts are dropped, its existence is not).
    expect(aggregate.rows).toBe(7);

    const byKey = new Map(aggregate.series.map((s) => [`${s.provider}/${s.model}`, s]));
    expect(byKey.get('openai/gpt-4o-mini')?.cost).toBeCloseTo(0.00225, 12);
    expect(byKey.get('openai/gpt-4o-mini')?.promptTokens).toBe(1500);
    expect(byKey.get('custom/gpt-4o')?.cost).toBeCloseTo(0.02, 12);
    expect(byKey.get('custom/other')?.cost).toBeCloseTo(0.01, 12);
    expect(byKey.get('unknown/other')?.cost).toBeCloseTo(0.5, 12);
    expect(byKey.has('openai/other')).toBe(false);
    expect(aggregate.series).toHaveLength(4);
    expect(aggregate.costUsd).toBeCloseTo(0.53225, 12);
    expect(aggregate.promptTokens).toBe(3610);
    expect(aggregate.completionTokens).toBe(755);
    // Every emitted model label is one the registry can actually hold.
    for (const series of aggregate.series) {
      expect(METRIC_MODEL_LABELS).toContain(series.model);
    }
  });

  it('never returns more series than the bounded label space, however many raw models the DB holds', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      provider: 'openrouter',
      model: `vendor-${i}/made-up-model-${i}`,
      rows: 1,
      promptTokens: 10,
      completionTokens: 5,
      cost: 0.001,
    }));
    const aggregate = aggregateLlmUsageGroups(rows);
    expect(aggregate.groups).toBe(60);
    // 'openrouter' is a known prefix so the provider label survives; the 60
    // distinct model spellings are all off-list, so they fold into ONE
    // provider/model series — the allow-list is the only thing that bounds it.
    expect(aggregate.series).toHaveLength(1);
    expect(aggregate.series[0].provider).toBe('openrouter');
    expect(aggregate.series[0].model).toBe('other');
    expect(aggregate.costUsd).toBeCloseTo(0.06, 12);
  });

  it('reads an empty/unusable result as zero instead of throwing', () => {
    expect(aggregateLlmUsageGroups(undefined)).toEqual({
      groups: 0,
      rows: 0,
      series: [],
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    });
    expect(aggregateLlmUsageGroups([]).costUsd).toBe(0);
  });
});

describe('OBS-002 boot seed — a wedged database must not stop boot', () => {
  // Declared BEFORE the applying case on purpose: vitest runs cases in order,
  // and the seed's once-per-process guard would otherwise short-circuit this
  // call before it ever reached the broken prepared statement.
  it('returns null and never throws when the database is unavailable', () => {
    expect(llmUsageSeedApplied()).toBe(false);
    const broken: MetricsSeedDatabase = {
      prepare() {
        throw new Error('database is locked');
      },
    };
    expect(() => seedLlmUsageFromDatabase(broken)).not.toThrow();
    expect(seedLlmUsageFromDatabase(broken)).toBeNull();
    // A failed read must not claim the seed was applied: a later boot-time
    // retry is still allowed to try again.
    expect(llmUsageSeedApplied()).toBe(false);
  });
});

describe('OBS-002 boot seed — cumulative cost/tokens agree with token_usage', () => {
  it('seeds exactly the durable sums, once, so sum(metric) == SELECT sum(cost)', async () => {
    const repo = createSqliteBackedRepository();
    repo.seedGame({ id: 'obs002-seed-game', status: 'IN_PROGRESS' });
    const insert = (provider: string, model: string, promptTokens: number, completionTokens: number, cost: number) =>
      repo.insertTokenUsage({
        gameId: 'obs002-seed-game',
        playerId: 'ALL',
        turnNumber: 0,
        provider,
        model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost,
      });
    insert('openai', 'openai/gpt-4o-mini', 1000, 200, 0.0015);
    insert('openai', 'gpt-4o-mini', 500, 100, 0.00075);
    insert('CUSTOM', 'gpt-4o', 100, 50, 0.02);
    insert('custom', 'my-local-model', 2000, 400, 0.01);
    insert('[object Object]', '[object Object]', 10, 5, 0.5);

    const sqlCost = (
      repo.db.prepare('SELECT round(sum(cost), 6) AS total FROM token_usage').get() as { total: number }
    ).total;
    const sqlPrompt = (
      repo.db.prepare('SELECT sum(prompt_tokens) AS total FROM token_usage').get() as { total: number }
    ).total;
    const sqlCompletion = (
      repo.db.prepare('SELECT sum(completion_tokens) AS total FROM token_usage').get() as { total: number }
    ).total;
    expect(sqlCost).toBeCloseTo(0.53225, 12);

    const before = await render();
    const costBefore = sumFamily(before, 'mafia_llm_cost_usd_total');
    const promptBefore = sumFamily(before, 'mafia_llm_tokens_total', 'direction="prompt"');
    const completionBefore = sumFamily(before, 'mafia_llm_tokens_total', 'direction="completion"');

    const seed = seedLlmUsageFromDatabase(repo.db as unknown as MetricsSeedDatabase);
    expect(seed).not.toBeNull();
    expect(seed?.rows).toBe(5);
    expect(seed?.costUsd).toBeCloseTo(sqlCost, 6);
    expect(seed?.promptTokens).toBe(sqlPrompt);
    expect(seed?.completionTokens).toBe(sqlCompletion);

    const after = await render();
    expect(sumFamily(after, 'mafia_llm_cost_usd_total') - costBefore).toBeCloseTo(sqlCost, 6);
    expect(sumFamily(after, 'mafia_llm_tokens_total', 'direction="prompt"') - promptBefore).toBe(sqlPrompt);
    expect(sumFamily(after, 'mafia_llm_tokens_total', 'direction="completion"') - completionBefore).toBe(
      sqlCompletion,
    );

    // Idempotent: a second call is a no-op, so a restart cannot double the
    // spend figure (nor can a hot-reload path re-run it).
    expect(seedLlmUsageFromDatabase(repo.db as unknown as MetricsSeedDatabase)).toBeNull();
    expect(llmUsageSeedApplied()).toBe(true);
    const afterTwice = await render();
    expect(sumFamily(afterTwice, 'mafia_llm_cost_usd_total')).toBe(
      sumFamily(after, 'mafia_llm_cost_usd_total'),
    );

    // The seeded labels stay inside the bounded space: one series per
    // (provider, model) the registry can hold, never one per raw DB row.
    expect(seed?.series).toHaveLength(4);
    const costLines = familyLines(afterTwice, 'mafia_llm_cost_usd_total');
    expect(costLines.length).toBeLessThanOrEqual(METRIC_MODEL_LABELS.length * 6);
    for (const line of costLines) {
      const model = /model="([^"]*)"/.exec(line)?.[1];
      expect(model).toBeDefined();
      expect(METRIC_MODEL_LABELS).toContain(model as string);
    }
  });

  it('keeps the seed query a single grouped pass over token_usage (no per-model N+1)', () => {
    expect(LLM_USAGE_SEED_SQL).toMatch(/FROM token_usage/);
    expect(LLM_USAGE_SEED_SQL).toMatch(/GROUP BY provider, model/);
    expect(LLM_USAGE_SEED_SQL).not.toMatch(/;\s*SELECT/i);
  });
});
