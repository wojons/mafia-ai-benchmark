import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Extra context string shown in the fallback (e.g. where it is mounted). */
  context?: string;
  /** Called on catch; GameWatcher uses it to surface a re-fetch. */
  onError?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * DF-MAFIA-AI-BENCHMARK-31: top-level ErrorBoundary.
 *
 * During a live watch the whole tree went blank for minutes with ZERO captured
 * errors — a thrown render error unmounts everything React renders inside a
 * boundary-less tree, which looks exactly like a hung tab (document complete,
 * #root empty, no console output). This boundary converts any render/lifecycle
 * throw into a VISIBLE fallback with a Reload button. It deliberately does not
 * swallow the error: console.error keeps it on the wire for debugging.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the real error visible — the blank-tree bug was invisible precisely
    // because nothing was ever logged.
    console.error('[ErrorBoundary] caught render error:', error, info.componentStack);
    this.props.onError?.();
  }

  handleReload = (): void => {
    // Full remount: safest recovery from a corrupt mid-render state tree.
    window.location.reload();
  };

  handleReset = (): void => {
    // Retry rendering in place first — cheaper than a full page reload.
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="error-boundary" role="alert">
          <h2>Something went wrong</h2>
          <p>
            The UI hit an unexpected error and would otherwise be blank.
            {' '}
            {this.props.context ? `${this.props.context}.` : ''}
            {' '}
            Try again — your game data is not lost.
          </p>
          <p className="error-boundary-detail" data-testid="error-boundary-detail">
            {this.state.error.message}
          </p>
          <div className="error-boundary-actions">
            <button className="btn" onClick={this.handleReset}>
              Try again
            </button>
            <button className="btn btn-primary" data-testid="error-boundary-reload" onClick={this.handleReload}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;