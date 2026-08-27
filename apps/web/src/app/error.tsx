"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // #region agent log
  useEffect(() => {
    const payload = {
      hypothesisId: "C,E,render",
      location: "error.tsx:AppError",
      message: "React error boundary caught",
      data: {
        errorMessage: error?.message || "unknown",
        digest: error?.digest || null,
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 2500) : null,
      },
      timestamp: Date.now(),
      runId: "passaround-crash-again",
    };
    try {
      console.error("[PASSAROUND_DEBUG] error.tsx boundary", payload);
    } catch {
      /* ignore */
    }
    try {
      void fetch("/api/passaround-trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, [error]);
  // #endregion

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>This screen crashed</h1>
      <p style={{ lineHeight: 1.5, color: "#333" }}>
        NeXa caught an error so the rest of the app can keep running. Retry this view, or go back to the dashboard.
      </p>
      <p style={{ fontSize: 13, color: "#666", marginTop: 10 }}>{error?.message || "Unknown error"}</p>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button type="button" onClick={() => reset()}>
          Retry
        </button>
        <a href="/">Back to dashboard</a>
      </div>
    </main>
  );
}
