import { describe, it, expect } from 'vitest';
import { BASE_URL, probeMafiaServer } from './helpers/mafia-server';

// Host port 3000 is owned by DuckBrain's HTTP server on fleet hosts; the mafia
// compose stack exposes the server on :3004 (docker "3004:3000") and direct
// runs should use PORT=3004. CI starts its own source server on :3004 and pins
// TEST_BASE_URL (see .github/workflows/ci.yml).
//
// Like api.test.ts, these tests need a LIVE mafia server. Without the probe
// below, a clean machine with nothing on the pinned port fails both tests with
// ECONNREFUSED (QA-MAFIA-AI-BENCHMARK-6), while a non-mafia service squatting
// on the port (e.g. DuckBrain's :3000 daemon) fails them on shape.
const SERVER_PROBE = await probeMafiaServer(BASE_URL);

if (!SERVER_PROBE.available) {
  console.warn(`\n⚠️  Skipping health endpoint integration tests: ${SERVER_PROBE.message}\n`);
}

describe.skipIf(!SERVER_PROBE.available)('Health endpoint', () => {
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