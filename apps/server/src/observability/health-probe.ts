/**
 * OBS-005: real health evaluation.
 *
 * GET /health used to answer `{status: 'healthy'}` unconditionally, and the
 * Docker healthcheck treats that as authoritative — so a container whose DB
 * file had become unreadable, or whose legacy engine bridge was dead, still
 * reported healthy. A health endpoint that cannot fail is not a health check.
 *
 * Two rules shape the contract kept here:
 *
 *  1. HTTP status stays 200 for a degraded report. Docker restarts a container
 *     whose healthcheck fails; a transient SQLITE_BUSY must not flap the stack.
 *     The TRUTH travels in the body (`status` + `checks`), and the alarm
 *     travels through the counter, not through the status line.
 *  2. Failures increment the EXISTING mafia_healthcheck_failed_total{check}
 *     family declared by OBS-003 (spec 3.3) — never a new family, so the
 *     dashboards and the closed {check} set stay as documented.
 *
 * The probe set is not "every check name": only checks with a probe here are
 * reported.
 */

import {
  HEALTHCHECK_NAMES,
  healthcheckFailed,
  type HealthcheckName,
} from './metrics.js';

/** One check's outcome in the health body. */
export interface HealthCheckOutcome {
  ok: boolean;
  error?: string;
}

export interface HealthReport {
  status: 'healthy' | 'degraded';
  failedChecks: HealthcheckName[];
  checks: Partial<Record<HealthcheckName, HealthCheckOutcome>>;
}

/** A probe throws to report failure; its message is kept as the reason. */
export type HealthProbe = () => void;

/** Probe order is the declared closed-set order, so the body is stable. */
export function evaluateHealth(
  probes: Partial<Record<HealthcheckName, HealthProbe>>,
): HealthReport {
  const checks: Partial<Record<HealthcheckName, HealthCheckOutcome>> = {};
  const failedChecks: HealthcheckName[] = [];

  for (const name of HEALTHCHECK_NAMES) {
    const probe = probes[name];
    if (!probe) continue;
    try {
      probe();
      checks[name] = { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      checks[name] = { ok: false, error: message };
      failedChecks.push(name);
      // OBS-003 family: one increment per failed probe per request. A scrape
      // rate over this counter is the "is anything actually wrong" signal.
      healthcheckFailed(name);
    }
  }

  return {
    status: failedChecks.length === 0 ? 'healthy' : 'degraded',
    failedChecks,
    checks,
  };
}
