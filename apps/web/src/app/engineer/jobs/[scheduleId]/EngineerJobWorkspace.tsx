"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  MessageCircle,
  PackagePlus,
  RotateCcw,
  Send,
  ShoppingCart,
  UploadCloud,
  Wrench,
  XCircle,
} from "lucide-react";
import type { EngineerScheduleItem } from "@/lib/engineer-data";
import type {
  EngineerJobWorkflow,
  EngineerWorkflowNote,
  EngineerWorkflowOutcome,
} from "@/lib/engineer-workflow-store";

type EngineerWorkflowAction =
  | "complete_requirement"
  | "add_photos"
  | "add_note"
  | "add_report"
  | "request_po"
  | "add_time_entry"
  | "set_outcome";

type EngineerJobWorkspaceProps = {
  job: EngineerScheduleItem;
};

function initialWorkflow(job: EngineerScheduleItem): EngineerJobWorkflow {
  return {
    scheduleId: job.scheduleId,
    requirements: job.requirements,
    photos: job.photos,
    notes: [],
    reports: [],
    poRequests: [],
    timeEntries: [],
    officeReview: [],
  };
}

function checklistTitle(costCentre: string) {
  const normalised = costCentre.toLowerCase();
  if (/service/.test(normalised) && /boiler/.test(normalised)) return "Boiler service stop / go";
  if (/replace|replacement|install|boiler change/.test(normalised)) return "Boiler replacement stop / go";
  if (/heating|controls|commercial/.test(normalised)) return "Heating works stop / go";
  return "Cost centre stop / go";
}

function checklistHelp(costCentre: string) {
  const normalised = costCentre.toLowerCase();
  if (/service/.test(normalised) && /boiler/.test(normalised)) {
    return "Appliance photo, data plate, flue/analyser evidence, service notes and defect confirmation must be captured before completion.";
  }
  if (/replace|replacement|install|boiler change/.test(normalised)) {
    return "Existing boiler evidence, new boiler data plate, flue, controls, commissioning details and completion photos must be captured before handover.";
  }
  return "This checklist is driven by the cost centre type. Missing required items block completion until the engineer supplies the evidence.";
}

function statusCopy(status: EngineerJobWorkflow["requirements"][number]["status"]) {
  if (status === "done") return "Done";
  if (status === "missing") return "Missing";
  return "Optional";
}

export default function EngineerJobWorkspace({ job }: EngineerJobWorkspaceProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [workflow, setWorkflow] = useState<EngineerJobWorkflow>(() => initialWorkflow(job));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<EngineerWorkflowNote["visibility"]>("Office review");
  const [reportTitle, setReportTitle] = useState("");
  const [reportBody, setReportBody] = useState("");
  const [poSupplier, setPoSupplier] = useState("");
  const [poNote, setPoNote] = useState("");
  const [timeStart, setTimeStart] = useState(job.start);
  const [timeEnd, setTimeEnd] = useState(job.end);
  const [timeBreak, setTimeBreak] = useState("0");
  const [timeNote, setTimeNote] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");

  const missingRequirements = useMemo(
    () => workflow.requirements.filter((requirement) => requirement.status === "missing"),
    [workflow.requirements],
  );
  const canComplete = missingRequirements.length === 0;
  const latestOfficeReview = workflow.officeReview.slice(0, 5);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkflow() {
      try {
        const response = await fetch(`/api/engineer/jobs/${encodeURIComponent(job.scheduleId)}/workflow`);
        if (!response.ok) return;
        const nextWorkflow = (await response.json()) as EngineerJobWorkflow;
        if (!cancelled) setWorkflow(nextWorkflow);
      } catch {
        // Keep the static schedule state if the pilot store is unavailable.
      }
    }
    void loadWorkflow();
    return () => {
      cancelled = true;
    };
  }, [job.scheduleId]);

  async function runWorkflowAction(action: EngineerWorkflowAction, payload: Record<string, unknown>, successMessage: string) {
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/engineer/jobs/${encodeURIComponent(job.scheduleId)}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          payload: {
            ...payload,
            createdBy: job.engineerName,
          },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to update engineer job");
      }
      const nextWorkflow = (await response.json()) as EngineerJobWorkflow;
      setWorkflow(nextWorkflow);
      setNotice(successMessage);
      return nextWorkflow;
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : "Unable to update engineer job");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function markRequirementDone(requirementId: string) {
    await runWorkflowAction(
      "complete_requirement",
      { requirementId },
      "Checklist evidence sent to office review.",
    );
  }

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const fileNames = Array.from(event.target.files ?? []).map((file) => file.name);
    event.target.value = "";
    if (!fileNames.length) return;
    await runWorkflowAction(
      "add_photos",
      { fileNames },
      `${fileNames.length} photo${fileNames.length === 1 ? "" : "s"} sent to office review.`,
    );
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteText.trim()) return;
    const saved = await runWorkflowAction(
      "add_note",
      { text: noteText, visibility: noteVisibility },
      "Engineer note sent to office review.",
    );
    if (saved) setNoteText("");
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportBody.trim()) return;
    const saved = await runWorkflowAction(
      "add_report",
      { title: reportTitle, body: reportBody },
      "Engineer report sent to office review.",
    );
    if (saved) {
      setReportTitle("");
      setReportBody("");
    }
  }

  async function submitPoRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!poSupplier.trim() && !poNote.trim()) return;
    const saved = await runWorkflowAction(
      "request_po",
      { supplier: poSupplier, note: poNote },
      "PO request sent to the office.",
    );
    if (saved) {
      setPoSupplier("");
      setPoNote("");
    }
  }

  async function submitTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runWorkflowAction(
      "add_time_entry",
      {
        start: timeStart,
        end: timeEnd,
        breakMinutes: Number(timeBreak) || 0,
        note: timeNote,
      },
      "Time entry sent for office review.",
    );
  }

  async function setOutcome(status: EngineerWorkflowOutcome["status"]) {
    if (status === "Complete" && !canComplete) {
      setError(`Cannot mark complete yet. Missing: ${missingRequirements.map((item) => item.label).join(", ")}.`);
      return;
    }
    await runWorkflowAction(
      "set_outcome",
      { status, note: outcomeNote },
      `${status} sent to office review.`,
    );
  }

  return (
    <>
      {notice || error ? (
        <section className={`engineer-feedback ${error ? "error" : ""}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
        </section>
      ) : null}

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Job information</p>
            <h2>What the engineer needs on site</h2>
          </div>
          <FileText size={21} />
        </div>
        <div className="engineer-site-info-grid">
          <div className="engineer-note-block"><strong>Works</strong><p>{job.description}</p></div>
          <div className="engineer-note-block"><strong>Access</strong><p>{job.accessNotes}</p></div>
          {job.officeNotes.map((note) => <div className="engineer-note-block" key={note}><strong>Office note</strong><p>{note}</p></div>)}
        </div>
        <div className="engineer-file-grid">
          {job.attachments.map((attachment) => (
            <button className="engineer-file-tile" type="button" key={attachment.id}>
              <span>{attachment.type}</span>
              <strong>{attachment.name}</strong>
              <small>{attachment.uploadedBy} · {attachment.uploadedAt}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Stop / go</p>
            <h2>{checklistTitle(job.costCentre)}</h2>
          </div>
          <ClipboardCheck size={21} />
        </div>
        <p className="engineer-muted-copy">{checklistHelp(job.costCentre)}</p>
        <div className="engineer-requirement-list">
          {workflow.requirements.map((requirement) => (
            <div className={`engineer-requirement ${requirement.status}`} key={requirement.id}>
              <div>
                <span>{requirement.label}</span>
                <small>{requirement.status === "missing" ? "Required before completion" : requirement.status === "done" ? "Evidence supplied" : "Optional support evidence"}</small>
              </div>
              <div className="engineer-requirement-actions">
                <strong>{statusCopy(requirement.status)}</strong>
                {requirement.status === "missing" ? (
                  <button type="button" onClick={() => void markRequirementDone(requirement.id)} disabled={isSaving}>
                    Mark supplied
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {missingRequirements.length ? (
          <div className="engineer-stop-message">Cannot mark complete yet. Missing: {missingRequirements.map((item) => item.label).join(", ")}.</div>
        ) : (
          <div className="engineer-ready-message"><CheckCircle2 size={17} /> All required stop / go items are supplied.</div>
        )}
      </section>

      <section className="engineer-panel engineer-capture-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Site evidence</p>
            <h2>Photos, notes and reports</h2>
          </div>
          <Camera size={21} />
        </div>

        <div className="engineer-upload-row">
          <button className="engineer-primary-action" type="button" onClick={() => photoInputRef.current?.click()} disabled={isSaving}>
            <UploadCloud size={17} />
            Upload photos
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={(event) => void uploadPhotos(event)} hidden />
          <span>{workflow.photos.length} photo{workflow.photos.length === 1 ? "" : "s"} held against this job</span>
        </div>

        <div className="engineer-file-grid">
          {workflow.photos.map((photo) => (
            <button className="engineer-file-tile" type="button" key={photo.id}>
              <span>{photo.type}</span>
              <strong>{photo.name}</strong>
              <small>{photo.uploadedBy} · {photo.uploadedAt}</small>
            </button>
          ))}
        </div>

        <div className="engineer-form-grid">
          <form className="engineer-po-form" onSubmit={(event) => void submitNote(event)}>
            <label>
              Note visibility
              <select value={noteVisibility} onChange={(event) => setNoteVisibility(event.target.value as EngineerWorkflowNote["visibility"])}>
                <option>Office review</option>
                <option>Internal team</option>
                <option>Engineer private</option>
              </select>
            </label>
            <label>
              Engineer note
              <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="What should the office know?" rows={4} />
            </label>
            <button type="submit" disabled={isSaving || !noteText.trim()}><MessageCircle size={17} /> Send note</button>
          </form>

          <form className="engineer-po-form" onSubmit={(event) => void submitReport(event)}>
            <label>
              Report title
              <input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} placeholder="Service report, completion report..." />
            </label>
            <label>
              Report detail
              <textarea value={reportBody} onChange={(event) => setReportBody(event.target.value)} placeholder="Write the report or handover notes here." rows={4} />
            </label>
            <button type="submit" disabled={isSaving || !reportBody.trim()}><Send size={17} /> Send report</button>
          </form>
        </div>
      </section>

      <section className="engineer-panel" id="po-request">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Purchase order</p>
            <h2>Request parts / supplier support</h2>
          </div>
          <ShoppingCart size={21} />
        </div>
        <form className="engineer-po-form" onSubmit={(event) => void submitPoRequest(event)}>
          <label>
            Supplier
            <input value={poSupplier} onChange={(event) => setPoSupplier(event.target.value)} placeholder="Supplier name" name="supplier" />
          </label>
          <label>
            Note optional
            <textarea value={poNote} onChange={(event) => setPoNote(event.target.value)} placeholder="Short note for office, for example: pump valves needed" name="note" rows={3} />
          </label>
          <button type="submit" disabled={isSaving || (!poSupplier.trim() && !poNote.trim())}><PackagePlus size={17} /> Send PO request to office</button>
        </form>

        {workflow.poRequests.length ? (
          <div className="engineer-mini-list">
            {workflow.poRequests.map((request) => (
              <article key={request.id}>
                <span>{request.status}</span>
                <strong>{request.supplier}</strong>
                <p>{request.note || "Supplier / PO support requested."}</p>
                <small>{request.createdBy} · {request.createdAt}</small>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Timesheet</p>
            <h2>Quick time entry for this job</h2>
          </div>
          <Clock3 size={21} />
        </div>
        <form className="engineer-time-form" onSubmit={(event) => void submitTime(event)}>
          <label>
            Start
            <input type="time" value={timeStart} onChange={(event) => setTimeStart(event.target.value)} />
          </label>
          <label>
            Finish
            <input type="time" value={timeEnd} onChange={(event) => setTimeEnd(event.target.value)} />
          </label>
          <label>
            Break mins
            <input inputMode="numeric" value={timeBreak} onChange={(event) => setTimeBreak(event.target.value)} />
          </label>
          <label className="full">
            Time note
            <textarea value={timeNote} onChange={(event) => setTimeNote(event.target.value)} placeholder="Only add a note if the time differs from schedule." rows={3} />
          </label>
          <button className="full" type="submit" disabled={isSaving}><Clock3 size={17} /> Send time to office</button>
        </form>

        {workflow.timeEntries.length ? (
          <div className="engineer-mini-list">
            {workflow.timeEntries.map((entry) => (
              <article key={entry.id}>
                <span>{entry.status}</span>
                <strong>{entry.start}-{entry.end}</strong>
                <p>{entry.note || "No exception note added."}</p>
                <small>{entry.createdBy} · {entry.createdAt}</small>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Office review</p>
            <h2>Sent from site</h2>
          </div>
          <Wrench size={21} />
        </div>
        {latestOfficeReview.length ? (
          <div className="engineer-review-feed">
            {latestOfficeReview.map((item) => (
              <article key={item.id}>
                <span>{item.type} · {item.status}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <small>{item.createdBy} · {item.createdAt}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="engineer-muted-copy">Nothing has been sent to office review yet. Notes, photos, reports, PO requests, time entries and outcomes will appear here.</p>
        )}
      </section>

      <section className="engineer-panel">
        <div className="engineer-section-heading compact">
          <div>
            <p className="eyebrow">Outcome</p>
            <h2>Tell the office where this job stands</h2>
          </div>
          <CheckCircle2 size={21} />
        </div>
        <label className="engineer-outcome-note">
          Note for office
          <textarea value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="Reason if parts/rebook/access issue, or completion note." rows={3} />
        </label>
        {workflow.outcome ? (
          <div className="engineer-ready-message">
            <CheckCircle2 size={17} />
            Latest outcome: {workflow.outcome.status} · {workflow.outcome.createdAt}
          </div>
        ) : null}
      </section>

      <section className="engineer-outcome-bar" aria-label="Job outcome actions">
        <button type="button" onClick={() => void setOutcome("Complete")} disabled={isSaving || !canComplete}><CheckCircle2 size={17} /> Complete</button>
        <button type="button" onClick={() => void setOutcome("Needs parts")} disabled={isSaving}><Wrench size={17} /> Needs parts</button>
        <button type="button" onClick={() => void setOutcome("Needs rebooked")} disabled={isSaving}><RotateCcw size={17} /> Rebook</button>
        <button type="button" onClick={() => void setOutcome("Could not access")} disabled={isSaving}><XCircle size={17} /> No access</button>
      </section>
    </>
  );
}
