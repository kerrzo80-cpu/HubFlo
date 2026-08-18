"use client";

import { useEffect, useState } from "react";

export function SetupTrialResetPanel() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/trial-reset", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { available?: boolean; note?: string };
        if (!cancelled && body.available) {
          setAvailable(true);
          setNote(body.note || "");
        }
      } catch {
        // Hidden on live / unauthenticated.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  async function resetTrial() {
    if (!window.confirm("Clear all trial jobs, tenders, employees, catalogue and logos? Your login stays. This cannot be undone.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/trial-reset", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        setError(body.error || `Reset failed (${response.status})`);
        return;
      }
      window.setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Could not reach the trial reset service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setup-panel" style={{ marginTop: 16 }}>
      <div className="documents-toolbar">
        <div>
          <span className="permission-heading">Trial workspace</span>
          <h2>Reset company data</h2>
          <p>{note || "Remove sample and leaked office data from this trial. Live office data is not touched."}</p>
        </div>
        <button className="danger-button" disabled={busy} type="button" onClick={() => void resetTrial()}>
          {busy ? "Clearing…" : "Reset company data"}
        </button>
      </div>
      {error ? <p className="ops-module-error">{error}</p> : null}
    </section>
  );
}
