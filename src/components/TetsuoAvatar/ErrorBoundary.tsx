/**
 * ============================================================================
 * ErrorBoundary - React Error Boundary for Avatar System
 * ============================================================================
 * Catches rendering errors in child components and provides fallback UI.
 * Used to gracefully handle 3D model loading failures.
 * ============================================================================
 */

import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <>
          {this.props.fallback}
          <div className="absolute top-20 left-2 right-2 z-[100] bg-red-900/90 text-white text-[10px] font-mono p-2 rounded max-h-32 overflow-auto">
            <div className="font-bold text-red-300 mb-1">3D Model Error:</div>
            <div className="break-all">{this.state.error?.message || 'Unknown error'}</div>
          </div>
        </>
      );
    }

    return this.props.children;
  }
}
