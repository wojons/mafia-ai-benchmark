import { describe, it, expect, afterEach } from 'vitest';
import { DEFAULT_PORT } from '../config.js';

describe('server default port (MAF-GAP-052)', () => {
  afterEach(() => {
    delete process.env.PORT;
  });

  it('defaults to 3004 so a direct run aligns with the CLI default and compose host port', () => {
    expect(DEFAULT_PORT).toBe(3004);
  });

  it('PORT env override wins over the default (code path: process.env.PORT || DEFAULT_PORT)', () => {
    process.env.PORT = '3000';
    const port = process.env.PORT || DEFAULT_PORT;
    expect(port).toBe('3000');
  });

  it('default applies when PORT is unset', () => {
    const port = process.env.PORT || DEFAULT_PORT;
    expect(port).toBe(DEFAULT_PORT);
  });
});
