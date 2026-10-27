import { describe, it, expect } from 'vitest';
import { BASE_URL, LIVE_INTEGRATION_ENABLED, probeMafiaServer } from './helpers/mafia-server';

// Host port 3000 is owned by DuckBrain's HTTP server on fleet hosts; the mafia
// compose stack exposes the server on :3004 (docker "3004:3000") and direct
// runs should use PORT=3004. CI starts its own source server on :3004 and pins
// TEST_BASE_URL (see .github/workflows/ci.yml).
//
// These tests are READ-ONLY against the pinned server, but per README-7 they
// still only run when TEST_BASE_URL is set explicitly: without that gate the
// suite silently pointed itself at whatever mafia stack was up on the :3004
// fallback. A clean machine with nothing on the pinned port skips cleanly
// (QA-MAFIA-AI-BENCHMARK-6), while a non-mafia service squatting on the port
// (e.g. DuckBrain's :3000 daemon) is skipped on shape by the probe.
const SERVER_PROBE = await probeMafiaServer(BASE_URL);

const LIVE_HEALTH_ENABLED = LIVE_INTEGRATION_ENABLED && SERVER_PROBE.available;

if (LIVE_INTEGRATION_ENABLED && !SERVER_PROBE.available) {
  console.warn(`\n⚠️  Skipping health endpoint integration tests: ${SERVER_PROBE.message}\n`);
} else if (!LIVE_INTEGRATION_ENABLED) {
  console.warn('\n⚠️  Skipping health endpoint integration tests: TEST_BASE_URL is not set — live integration tests only run against an explicitly pinned server (see README.md "Running Tests").\n');
}

describe.skipIf(!LIVE_HEALTH_ENABLED)('Health endpoint', () => {
  it('returns healthy status', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeGreaterThan(0);
  });

  it('exposes /api/v1/health alias with the same payload (MAF-GAP-037)', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeGreaterThan(0);
    expect(data.memory).toBeDefined();
  });
});