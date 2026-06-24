import { describe, it, expect } from 'vitest';

describe('Web UI smoke', () => {
  it('vite config has correct port', async () => {
    const config = await import('../../vite.config');
    expect(config.default.server?.port).toBe(5174);
  });

  it('proxy targets server', async () => {
    const config = await import('../../vite.config');
    const proxy = config.default.server?.proxy?.['/api'];
    const target = typeof proxy === 'string' ? proxy : (proxy as { target?: string })?.target;
    expect(target).toBe('http://localhost:3000');
  });
});
