import { describe, it, expect } from 'vitest';

describe('Health endpoint', () => {
  it('returns healthy status', async () => {
    const response = await fetch('http://localhost:3000/health');
    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeGreaterThan(0);
  });
});
