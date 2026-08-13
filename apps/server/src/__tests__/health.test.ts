import { describe, it, expect } from 'vitest';

// Host port 3000 is owned by DuckBrain's HTTP server on fleet hosts; the mafia
// compose stack exposes the server on :3004. CI starts its own source server on
// :3000 and pins TEST_BASE_URL (see .github/workflows/ci.yml).
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3004';

describe('Health endpoint', () => {
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
