/**
 * ============================================================================
 * ErrorBoundary - Root Error Boundary
 * ============================================================================
 * Catches unhandled React render errors and displays a fallback UI
 * instead of a blank white screen.
 * ============================================================================
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-black flex items-center justify-center text-white font-mono">
          <div className="text-center max-w-md px-6">
            <div className="text-red-500 text-4xl mb-4">SYSTEM FAULT</div>
            <div className="text-holo-silver/70 text-sm mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </div>
            <button
              onClick={this.handleReload}
              className="px-6 py-2 border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-colors uppercase tracking-wider text-xs"
            >
              Reboot
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
