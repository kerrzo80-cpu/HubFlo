"use client";

import { useCallback, useState } from "react";
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
    photoUrl?: string;
    photoId?: string;
  };
};

type FieldVisitPhoto = {
  id: string;
  name: string;
  type?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  url?: string;
  mimeType?: string;
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
  photos?: FieldVisitPhoto[];
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
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [stopGo, setStopGo] = useState<{
    runs?: Array<{
      run: { id: string; status: string; costCentreCode: string; currentGateKey: string; highPriorityFollowUp?: { open?: boolean } };
      record?: { recordNumber?: string; pdfDocumentId?: string } | null;
    }>;
  } | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    setLoadedOnce(true);
    try {
      const [response, stopGoResponse] = await Promise.all([
        fetch(`/api/field/jobs/by-job/${encodeURIComponent(jobId)}`),
        fetch(`/api/workflow-runs?jobId=${encodeURIComponent(jobId)}`),
      ]);
      const body = (await response.json().catch(() => ({}))) as FieldByJobResponse;
      if (!response.ok) {
        throw new Error(body.error || `Could not load Field data (${response.status}).`);
      }
      setData(body);
      if (stopGoResponse.ok) {
        setStopGo((await stopGoResponse.json().catch(() => null)) as typeof stopGo);
      }
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load Field data.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Do NOT auto-fetch on mount — that OOMed live when opening a job before Mark complete.
  // Office loads Field evidence on demand.

  const visits = data?.visits ?? [];
  const doneItems = visits.reduce(
    (sum, visit) => sum + visit.checklist.items.filter((item) => item.status === "done").length,
    0,
  );
  const timeCount = visits.reduce((sum, visit) => sum + visit.timeEntries.length, 0);

  return (
    <section className="job-field-live-panel" aria-label="Blake Field live evidence">
      <header className="job-field-live-head">
        <div>
          <span className="permission-heading">Blake Field</span>
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
            <RefreshCw size={15} />{" "}
            {loading ? "Refreshing…" : loadedOnce ? "Refresh" : "Load Field evidence"}
          </button>
        </div>
      </header>

      {!loadedOnce && !loading ? (
        <p className="muted" style={{ margin: "0.75rem 0 0" }}>
          Field checklist and hours load on demand so Mark complete / pass around stays stable on live.
        </p>
      ) : null}

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

      {stopGo?.runs?.length ? (
        <div className="job-field-visit">
          <header>
            <div>
              <strong>Domestic stop/go records</strong>
              <small>Mandatory gates. Completed PDFs store in Forms & Certificates.</small>
            </div>
          </header>
          <ul>
            {stopGo.runs.map((item) => (
              <li key={item.run.id}>
                <strong>{item.run.costCentreCode}</strong> · {item.run.status.replace(/_/g, " ")}
                {item.run.highPriorityFollowUp?.open ? " · HIGH PRIORITY FOLLOW-UP" : ""}
                {item.record?.recordNumber ? ` · ${item.record.recordNumber}` : ""}
                {item.record?.pdfDocumentId ? (
                  <>
                    {" "}
                    <a href={`/api/record-documents/${encodeURIComponent(item.record.pdfDocumentId)}/file`} target="_blank" rel="noreferrer">
                      Open PDF
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                        {item.value?.photoUrl ? (
                          <a className="job-field-photo-link" href={item.value.photoUrl} target="_blank" rel="noreferrer">
                            Open evidence photo
                          </a>
                        ) : null}
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

          {(visit.photos ?? []).length ? (
            <div className="job-field-visit-photos">
              <h3>Synced photos</h3>
              <div className="job-field-photo-grid">
                {(visit.photos ?? []).map((photo) => {
                  const isImage =
                    Boolean(photo.url) &&
                    (photo.type === "Photo" || Boolean(photo.mimeType?.startsWith("image/")) || !photo.mimeType);
                  return (
                    <div className="job-field-photo-card" key={photo.id}>
                      {isImage && photo.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.url} alt={photo.name} />
                      ) : (
                        <span>{photo.type || "File"}</span>
                      )}
                      <div>
                        <strong>{photo.name}</strong>
                        <small>
                          {[photo.uploadedBy, photo.uploadedAt].filter(Boolean).join(" · ")}
                          {photo.url ? " · synced" : ""}
                        </small>
                      </div>
                      {photo.url ? (
                        <a href={photo.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <p className="job-field-visit-link">
            <a href={`/field/jobs/${encodeURIComponent(visit.scheduleId)}`}>Open this visit in Field</a>
          </p>
        </article>
      ))}
    </section>
  );
}
