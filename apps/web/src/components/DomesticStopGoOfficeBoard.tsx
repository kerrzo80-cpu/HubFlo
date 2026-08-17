"use client";

import { useEffect, useState } from "react";

type Board = {
  counts?: Record<string, number>;
  competency?: Array<{ employeeId: string; scheme: string; expiresAt: string; expired?: boolean }>;
  blockedUnsafe?: Array<{ id: string; jobId: string; status: string }>;
  costCentres?: Array<{ stableCode: string; displayName: string; active: boolean }>;
  templates?: Array<{ code: string; templateId: string | null }>;
};

const LABELS: Array<[string, string]> = [
  ["in_progress", "In progress"],
  ["blocked_missing_required", "Blocked missing information"],
  ["blocked_unsafe", "Unsafe / high-priority follow-up"],
  ["awaiting_engineer_signature", "Awaiting engineer signature"],
  ["awaiting_customer_acknowledgement", "Awaiting customer acknowledgement"],
  ["ready_to_complete_when_connected", "Ready to complete when connected"],
  ["complete", "Completed records"],
  ["notification_pending", "External notification pending"],
];

export function DomesticStopGoOfficeBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/workflow-runs");
        const body = (await response.json()) as Board & { error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load board.");
        setBoard(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load board.");
      }
    })();
  }, []);

  if (error) return <p className="muted">{error}</p>;
  if (!board) return <p className="muted">Loading domestic stop/go…</p>;

  return (
    <section className="job-field-live-panel" aria-label="Domestic stop/go board">
      <header className="job-field-live-head">
        <div>
          <span className="permission-heading">Domestic gas & oil</span>
          <h2>Stop/go workflow board</h2>
          <small>Mandatory records for the seven domestic cost centres. Live is not the test path — use pilot.</small>
        </div>
      </header>
      <div className="job-field-live-stats">
        {LABELS.map(([key, label]) => (
          <article key={key}>
            <span>{label}</span>
            <strong>{board.counts?.[key] ?? 0}</strong>
          </article>
        ))}
      </div>
      {board.competency?.length ? (
        <p>
          Competency alerts: {board.competency.map((item) => `${item.employeeId} ${item.scheme} ${item.expired ? "expired" : "expiring"} ${item.expiresAt}`).join("; ")}
        </p>
      ) : null}
      {board.costCentres?.length ? (
        <p className="muted">
          Cost centres: {board.costCentres.map((item) => `${item.displayName} (${item.stableCode}${item.active ? "" : ", inactive"})`).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
