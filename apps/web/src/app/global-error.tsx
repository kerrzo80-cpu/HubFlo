"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    // #region agent log
    const payload = {
      hypothesisId: "C,E,render",
      location: "global-error.tsx",
      message: "Global error boundary caught",
      data: {
        errorMessage: error?.message || "unknown",
        digest: error?.digest || null,
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 2500) : null,
      },
      timestamp: Date.now(),
      runId: "passaround-crash-again",
    };
    try {
      console.error("[PASSAROUND_DEBUG] global-error.tsx", payload);
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
    // #endregion
  }, [error]);
  return (
    <html lang="en-GB">
      <body><NextError statusCode={0} /></body>
    </html>
  );
}
