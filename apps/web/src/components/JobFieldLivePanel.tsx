"use client";

import { useCallback, useEffect, useState } from "react";
import { HardHat, RefreshCw } from "lucide-react";

type FieldChecklistItem = {
  id: string;
  label: string;
  status: "done" | "missing" | "optional" | string;
  stage?: string;
  evidence?: string;
  value?: {
    text?: string;
    numberValue?: string;
    photoName?: string;
  };
};

type FieldTimeEntry = {
  id: string;
  start: string;
  end: string;
  breakMinutes?: number;
  note?: string;
  createdBy?: string;
  createdAt?: string;
  status?: string;
};

type FieldVisit = {
  scheduleId: string;
  jobRef: string;
  date: string;
  start: string;
  end: string;
  engineerName: string;
  costCentre: string;
  checklist: {
    total: number;
    done: number;
    items: FieldChecklistItem[];
  };
  timeEntries: FieldTimeEntry[];
  officeReview: Array<{ id: string; type: string; title: string; detail: string; createdAt: string }>;
};

type FieldByJobResponse = {
  jobId: string;
  visitCount: number;
  hubEvidenceCount: number;
  visits: FieldVisit[];
  fieldAppPath: string;
  error?: string;
};

function valueLabel(item: FieldChecklistItem) {
  const parts = [item.value?.text, item.value?.numberValue, item.value?.photoName]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

export function JobFieldLivePanel({
  jobId,
  jobRef,
}: {
  jobId: string;
  jobRef?: string;
}) {
  const [data, setData] = useState<FieldByJobResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/field/jobs/by-job/${encodeURIComponent(jobId)}`);
      const body = (await response.json().catch(() => ({}))) as FieldByJobResponse;
      if (!response.ok) {
        throw new Error(body.error || `Could not load Field data (${response.status}).`);
      }
      setData(body);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load Field data.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visits = data?.visits ?? [];
  const doneItems = visits.reduce(
    (sum, visit) => sum + visit.checklist.items.filter((item) => item.status === "done").length,
    0,
  );
  const timeCount = visits.reduce((sum, visit) => sum + visit.timeEntries.length, 0);

  return (
    <section className="job-field-live-panel" aria-label="NeXa Field live evidence">
      <header className="job-field-live-head">
        <div>
          <span className="permission-heading">NeXa Field</span>
          <h2>Live from the engineer app</h2>
          <small>
            {jobRef ? `${jobRef} · ` : ""}
            Checklist saves and Blake hours from Field land here for office review.
          </small>
        </div>
        <div className="job-field-live-actions">
          <a className="secondary-button" href={data?.fieldAppPath || "/field"}>
            <HardHat size={15} /> Open Field
          </a>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="job-field-live-stats">
        <article>
          <span>Visits</span>
          <strong>{data?.visitCount ?? 0}</strong>
        </article>
        <article>
          <span>Checklist done</span>
          <strong>{doneItems}</strong>
        </article>
        <article>
          <span>Blake hours lines</span>
          <strong>{timeCount}</strong>
        </article>
        <article>
          <span>Core form fields</span>
          <strong>{data?.hubEvidenceCount ?? 0}</strong>
        </article>
      </div>

      {error ? <div className="feedback error">{error}</div> : null}

      {!loading && !error && visits.length === 0 ? (
        <p className="muted">No Field visits linked to this job yet.</p>
      ) : null}

      {visits.map((visit) => (
        <article className="job-field-visit" key={visit.scheduleId}>
          <header>
            <div>
              <strong>
                {visit.date} · {visit.start}–{visit.end}
              </strong>
              <small>
                {visit.engineerName} · {visit.costCentre} · {visit.jobRef}
              </small>
            </div>
            <span>
              {visit.checklist.done}/{visit.checklist.total} checks
            </span>
          </header>

          <div className="job-field-visit-grid">
            <div>
              <h3>Checklist evidence</h3>
              {visit.checklist.items.length ? (
                <ul>
                  {visit.checklist.items.map((item) => (
                    <li key={item.id} className={item.status === "done" ? "is-done" : undefined}>
                      <div>
                        <strong>{item.label}</strong>
                        <small>
                          {[item.stage, item.evidence, item.status === "done" ? "Done" : "To do"]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        {item.status === "done" && valueLabel(item) ? <em>{valueLabel(item)}</em> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No checklist items on this visit.</p>
              )}
            </div>

            <div>
              <h3>Blake hours</h3>
              {visit.timeEntries.length ? (
                <ul>
                  {visit.timeEntries.map((entry) => (
                    <li key={entry.id} className="is-done">
                      <div>
                        <strong>
                          {entry.start}–{entry.end}
                          {entry.breakMinutes ? ` · ${entry.breakMinutes}m break` : ""}
                        </strong>
                        <small>
                          {[entry.status, entry.createdBy, entry.createdAt].filter(Boolean).join(" · ")}
                        </small>
                        {entry.note ? <em>{entry.note}</em> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No Blake hours submitted for this visit yet.</p>
              )}
            </div>
          </div>

          <p className="job-field-visit-link">
            <a href={`/field/jobs/${encodeURIComponent(visit.scheduleId)}`}>Open this visit in Field</a>
            {" · "}
            <a href={`/engineer/jobs/${encodeURIComponent(visit.scheduleId)}`}>Engineer workspace</a>
          </p>
        </article>
      ))}
    </section>
  );
}
