"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, background: "#f7f7f5", color: "#1a1a1a" }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>NeXa hit a problem</h1>
        <p style={{ maxWidth: 520, lineHeight: 1.5 }}>
          Something went wrong in the app shell. Your data on the server is usually fine — try again.
        </p>
        <p style={{ fontSize: 13, color: "#666", marginTop: 12 }}>{error?.message || "Unknown error"}</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 20,
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #ccc",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
