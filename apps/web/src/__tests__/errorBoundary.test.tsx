/**
 * ErrorBoundary tests (DF-MAFIA-AI-BENCHMARK-31).
 *
 * The blank watch view failure was a thrown render error unmounting the whole
 * tree with nothing on screen and nothing logged. These tests pin the
 * contract: a render throw inside the boundary produces a VISIBLE fallback
 * (fallback text + the failing error message + Try again / Reload buttons),
 * clicking "Try again" re-renders the children in place, and a recovered
 * child renders again without remounting the page.
 */
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import ErrorBoundary from '../components/ErrorBoundary';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function Boom({ failOnRender }: { failOnRender: boolean }) {
  if (failOnRender) {
    throw new Error('mid-game render explosion');
  }
  return <div data-testid="healthy-child">watch content</div>;
}

function mount(children: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root!.render(<ErrorBoundary context="in the test">{children}</ErrorBoundary>);
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  const r = root;
  root = null;
  if (r) {
    await act(async () => {
      r.unmount();
    });
  }
  vi.restoreAllMocks();
});

describe('ErrorBoundary (DF-MAFIA-AI-BENCHMARK-31)', () => {
  it('renders healthy children untouched when nothing throws', async () => {
    await mount(<Boom failOnRender={false} />);
    expect(document.body.textContent).toContain('watch content');
  });

  it('catches a render throw and renders the visible fallback, not a blank tree', async () => {
    await mount(<Boom failOnRender={true} />);

    const fallback = document.querySelector('.error-boundary');
    expect(fallback).not.toBeNull();
    const body = document.body.textContent ?? '';
    expect(body).toContain('Something went wrong');
    expect(body).toContain('Reload');
    expect(body).toContain('Try again');
    // The real error is surfaced (debuggable), not swallowed silently.
    expect(body).toContain('mid-game render explosion');
    // The throwing child's content never rendered.
    expect(body).not.toContain('watch content');
  });

  it('logs the caught error to console.error (nothing was logged in the blank-tree bug)', async () => {
    await mount(<Boom failOnRender={true} />);
    expect(console.error).toHaveBeenCalled();
  });

  it('"Try again" resets the boundary and renders a recovered child in place', async () => {
    await mount(<Boom failOnRender={true} />);
    expect(document.body.textContent).toContain('Something went wrong');

    // Flip the child to healthy and retry without a page reload.
    const tryAgain = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Try again',
    );
    expect(tryAgain).toBeDefined();

    const rootRef = root!;
    await act(async () => {
      rootRef.render(
        <ErrorBoundary context="in the test">
          <Boom failOnRender={false} />
        </ErrorBoundary>,
      );
      tryAgain!.click();
    });

    const body = document.body.textContent ?? '';
    expect(body).toContain('watch content');
    expect(body).not.toContain('Something went wrong');
  });

  it('a Reload button exists and navigates the page (recovery escape hatch)', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });

    try {
      await mount(<Boom failOnRender={true} />);
      const reload = document.querySelector(
        '[data-testid="error-boundary-reload"]',
      ) as HTMLButtonElement | null;
      expect(reload).not.toBeNull();
      reload!.click();
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('fallback keeps the boundary subtree alive for a different context string', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ErrorBoundary>
          <Boom failOnRender={true} />
        </ErrorBoundary>,
      );
    });
    expect(document.body.textContent).toContain('Something went wrong');
  });
});