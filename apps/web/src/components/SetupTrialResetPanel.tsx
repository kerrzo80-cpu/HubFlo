"use client";

import { useEffect, useState } from "react";

function trialDaysLabel(days: number | null | undefined) {
  if (days == null) return "";
  if (days <= 0) return "This trial has ended.";
  if (days === 1) return "1 day remaining on this trial.";
  return `${days} days remaining on this trial.`;
}

export function SetupTrialResetPanel() {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resetResponse, licenceResponse] = await Promise.all([
          fetch("/api/trial-reset", { cache: "no-store" }),
          fetch("/api/trial-licence", { cache: "no-store" }),
        ]);
        if (!resetResponse.ok) return;
        const body = (await resetResponse.json()) as { available?: boolean; note?: string };
        if (cancelled || !body.available) return;
        setAvailable(true);
        setNote(body.note || "");
        if (licenceResponse.ok) {
          const licence = (await licenceResponse.json()) as {
            trial?: boolean;
            daysRemaining?: number | null;
          };
          if (licence.trial && licence.daysRemaining != null) {
            setDaysRemaining(licence.daysRemaining);
          }
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
          <p>
            {daysRemaining != null ? `${trialDaysLabel(daysRemaining)} ` : ""}
            {note || "Remove sample and leaked office data from this trial. Live office data is not touched."}
          </p>
        </div>
        <button className="danger-button" disabled={busy} type="button" onClick={() => void resetTrial()}>
          {busy ? "Clearing…" : "Reset company data"}
        </button>
      </div>
      {error ? <p className="ops-module-error">{error}</p> : null}
    </section>
  );
}
