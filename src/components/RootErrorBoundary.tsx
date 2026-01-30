/**
 * ============================================================================
 * RootErrorBoundary - Application-Level Crash Guard
 * ============================================================================
 * Wraps the entire app to catch unhandled rendering errors.
 * Displays a recovery screen instead of a blank white page.
 * ============================================================================
 */

import { Component, ReactNode } from 'react';

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[RootErrorBoundary] Unhandled error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-black flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="text-red-500 text-4xl font-display mb-4">
              SYSTEM FAULT
            </div>
            <div className="text-holo-silver/70 text-sm font-mono mb-6">
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
            <button
              onClick={this.handleReload}
              className="px-6 py-2 border border-neon-cyan/50 text-neon-cyan text-sm font-display uppercase tracking-wider hover:bg-neon-cyan/10 transition-colors"
            >
              Reboot System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
