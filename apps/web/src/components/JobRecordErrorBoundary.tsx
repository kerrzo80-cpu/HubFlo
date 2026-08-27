"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  jobRef?: string;
};

type State = {
  error: Error | null;
};

/**
 * Catches render crashes inside the job record panel so Complete / Ready-to-invoice
 * white-screens become a readable error.message instead of a blank page.
 */
export class JobRecordErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      console.error("[PASSAROUND_DEBUG]", "JobRecordErrorBoundary", {
        hypothesisId: "H2,H3",
        location: "JobRecordErrorBoundary.tsx:componentDidCatch",
        message: error.message,
        data: {
          jobRef: this.props.jobRef ?? null,
          stack: error.stack?.slice(0, 2500) ?? null,
          componentStack: info.componentStack?.slice(0, 2500) ?? null,
        },
        timestamp: Date.now(),
      });
    } catch {
      /* ignore */
    }
    try {
      void fetch("/api/passaround-trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          hypothesisId: "H2,H3",
          location: "JobRecordErrorBoundary.tsx:componentDidCatch",
          message: error.message,
          data: {
            jobRef: this.props.jobRef ?? null,
            stack: error.stack?.slice(0, 2500) ?? null,
            componentStack: info.componentStack?.slice(0, 2500) ?? null,
          },
          timestamp: Date.now(),
          runId: "passaround-live-fail",
        }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section
          className="quote-record-shell"
          style={{ padding: 24, maxWidth: 640 }}
          role="alert"
          data-passaround-error="1"
        >
          <span className="employee-record-eyebrow">Job record crashed</span>
          <h2 style={{ marginTop: 8 }}>This job panel hit an error</h2>
          <p style={{ lineHeight: 1.5, color: "#333" }}>
            NeXa caught the crash so the rest of the app can keep running. The error message below
            is the root cause we need for Complete / Ready-to-invoice.
          </p>
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: "#f6f8fa",
              border: "1px solid #d0d7de",
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
            }}
          >
            {this.state.error.message || "Unknown error"}
          </pre>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" className="primary-button" onClick={() => this.setState({ error: null })}>
              Retry panel
            </button>
            <a href="/jobs" className="secondary-button" style={{ display: "inline-flex", alignItems: "center" }}>
              Back to jobs
            </a>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
