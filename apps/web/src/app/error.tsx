"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
