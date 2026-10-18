"use client";

import React, { Component, ReactNode } from "react";

interface PanelErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  fallback?: ReactNode;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Isolated error boundary for dashboard cards, charts, and table panels.
 * Prevents a failure in one panel from blanking the entire page.
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[PanelErrorBoundary caught an error]:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-500 mb-3">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            {this.props.title ? `${this.props.title} failed to load` : "Panel error"}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            An unexpected error occurred while rendering this panel.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-4 inline-flex items-center rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
