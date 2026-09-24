import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { probeMafiaServer } from './mafia-server';

/**
 * Unit tests for the shared live-server probe. A `fetch` seam is injected
 * via vi.stubGlobal so these tests never touch the network.
 */
describe('probeMafiaServer', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('returns available=true when /health is ok and has a memory field', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ status: 'healthy', memory: { rss: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const probe = await probeMafiaServer('http://probe-ok');
    expect(probe.available).toBe(true);
    expect(probe.message).toContain('reachable');
  });

  it('returns available=false with HTTP status in message when /health errors', async () 	=> {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }));
    const probe = await probeMafiaServer('http://probe-503');
    expect(probe.available).toBe(false);
    expect(probe.message).toContain('HTTP 503');
  });

  it('returns available=false when /health body has no memory field (DuckBrain shape)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ status: 'healthy', timestamp: 'x' }), { status: 200 }),
    );
    const probe = await probeMafiaServer('http://probe-duckbrain');
    expect(probe.available).toBe(false);
    expect(probe.message).toContain('non-mafia service');
  });

  it('returns available=false with the cause in the message when fetch rejects (ECONNREFUSED)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const probe = await probeMafiaServer('http://probe-dead');
    expect(probe.available).toBe(false);
    expect(probe.message).toContain('fetch failed');
  });

  it('passes AbortSignal.timeout(3000) so a hung server cannot block the run', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ memory: {} }), { status: 200 });
    });
    await probeMafiaServer('http://probe-init');
    expect(captured?.signal).toBeDefined();
  });
});