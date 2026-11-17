/**
 * OBS-005: /health must be able to fail.
 *
 * Hermetic: no server, no sockets. The probes the real handler passes are
 * plain thunks, so the same evaluation path is driven here; the counter family
 * is process-global, so every assertion is a BEFORE/AFTER delta.
 */
import { describe, it, expect } from 'vitest';

import { evaluateHealth } from '../../observability/health-probe.js';
import { HEALTHCHECK_NAMES, registry } from '../../observability/metrics.js';

/** Read one counter series out of the rendered registry. */
async function healthcheckFailed(check: string): Promise<number> {
  const body = await registry.metrics();
  const prefix = `mafia_healthcheck_failed_total{check="${check}"} `;
  for (const line of body.split('\n')) {
    if (line.startsWith(prefix)) return Number(line.slice(prefix.length).trim());
  }
  return 0;
}

describe('OBS-005 — health evaluation', () => {
  it('reports healthy when every probe passes, and increments nothing', async () => {
    const dbBefore = await healthcheckFailed('db_write');
    const adapterBefore = await healthcheckFailed('legacy_adapter');

    const report = evaluateHealth({
      db_write: () => undefined,
      legacy_adapter: () => undefined,
    });

    expect(report.status).toBe('healthy');
    expect(report.failedChecks).toEqual([]);
    expect(report.checks).toEqual({
      db_write: { ok: true },
      legacy_adapter: { ok: true },
    });
    expect(await healthcheckFailed('db_write')).toBe(dbBefore);
    expect(await healthcheckFailed('legacy_adapter')).toBe(adapterBefore);
  });

  it('reports degraded and counts db_write when the DB probe throws', async () => {
    const before = await healthcheckFailed('db_write');
    const adapterBefore = await healthcheckFailed('legacy_adapter');

    const report = evaluateHealth({
      // The real probe runs a constant SELECT; an unreadable/locked DB file
      // surfaces exactly like this.
      db_write: () => {
        throw new Error('attempt to write a readonly database');
      },
      legacy_adapter: () => undefined,
    });

    expect(report.status).toBe('degraded');
    expect(report.failedChecks).toEqual(['db_write']);
    expect(report.checks.db_write).toEqual({ ok: false, error: 'attempt to write a readonly database' });
    // The failing check is counted; the healthy one is not.
    expect(await healthcheckFailed('db_write')).toBe(before + 1);
    expect(await healthcheckFailed('legacy_adapter')).toBe(adapterBefore);
  });

  it('reports degraded and counts legacy_adapter when the adapter is dead', async () => {
    const dbBefore = await healthcheckFailed('db_write');
    const before = await healthcheckFailed('legacy_adapter');

    const report = evaluateHealth({
      db_write: () => undefined,
      legacy_adapter: () => {
        throw new Error('legacy game adapter is not initialized');
      },
    });

    expect(report.status).toBe('degraded');
    expect(report.failedChecks).toEqual(['legacy_adapter']);
    expect(report.checks.legacy_adapter).toEqual({ ok: false, error: 'legacy game adapter is not initialized' });
    expect(await healthcheckFailed('legacy_adapter')).toBe(before + 1);
    expect(await healthcheckFailed('db_write')).toBe(dbBefore);
  });

  it('counts every failing check when more than one fails', async () => {
    const dbBefore = await healthcheckFailed('db_write');
    const adapterBefore = await healthcheckFailed('legacy_adapter');

    const report = evaluateHealth({
      db_write: () => {
        throw new Error('db down');
      },
      legacy_adapter: () => {
        throw new Error('adapter down');
      },
    });

    expect(report.status).toBe('degraded');
    expect(report.failedChecks).toEqual(['db_write', 'legacy_adapter']);
    expect(await healthcheckFailed('db_write')).toBe(dbBefore + 1);
    expect(await healthcheckFailed('legacy_adapter')).toBe(adapterBefore + 1);
  });

  it('reports only the checks it actually probed', () => {
    const report = evaluateHealth({ db_write: () => undefined });

    expect(Object.keys(report.checks)).toEqual(['db_write']);
    // Every reported name is inside the family's closed set.
    for (const name of Object.keys(report.checks)) {
      expect(HEALTHCHECK_NAMES).toContain(name);
    }
    // A check with no probe is not silently reported as healthy.
    expect(report.checks).not.toHaveProperty('spawn_capacity');
  });

  it('keeps a non-Error throw readable instead of losing the reason', () => {
    const report = evaluateHealth({
      db_write: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'disk on fire';
      },
    });

    expect(report.status).toBe('degraded');
    expect(report.checks.db_write).toEqual({ ok: false, error: 'disk on fire' });
  });
});
