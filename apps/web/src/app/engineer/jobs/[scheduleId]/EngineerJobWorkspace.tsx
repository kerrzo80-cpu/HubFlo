"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Info,
  MessageCircle,
  PackagePlus,
  Send,
  ShoppingCart,
  Wrench,
  XCircle,
} from "lucide-react";
import type { EngineerCostCentreOption, EngineerScheduleItem } from "@/lib/engineer-data";
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
  jobs: EngineerScheduleItem[];
};

type EngineerTab = "checklist" | "timesheets" | "information" | "po";

function initialWorkflow(job: EngineerScheduleItem): EngineerJobWorkflow {
  return {
    scheduleId: job.scheduleId,
    requirements: job.requirements,
    photos: job.photos,
    notes: [],
    reports: [],
    poRequests: [],
    timeEntries: [],
    equipmentEntries: [],
    paperSheetScans: [],
    officeReview: [],
  };
}

function costCentreOptionsFor(job: EngineerScheduleItem): EngineerCostCentreOption[] {
  if (job.costCentres?.length) return job.costCentres;
  return [{
    id: `${job.scheduleId}-cost-centre`,
    name: job.costCentre,
    templateName: job.costCentre,
  }];
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
    return "This is the simple stop / go list for a boiler service cost centre. The engineer supplies each required item before completion can be confirmed.";
  }
  if (/replace|replacement|install|boiler change/.test(normalised)) {
    return "This is the boiler replacement stop / go list. Existing boiler evidence, new boiler details, flue route, commissioning and completion evidence are captured before handover.";
  }
  return "This checklist is driven by the cost centre type. Required items block completion until the engineer supplies the evidence.";
}

function statusCopy(status: EngineerJobWorkflow["requirements"][number]["status"]) {
  if (status === "done") return "Done";
  if (status === "missing") return "Missing";
  return "Optional";
}

function hashToTab(hash: string): EngineerTab | null {
  if (hash === "#time-entry" || hash === "#timesheets") return "timesheets";
  if (hash === "#site-evidence" || hash === "#information" || hash === "#photos") return "information";
  if (hash === "#po-request") return "po";
  if (hash === "#checklist" || hash === "#stop-go") return "checklist";
  return null;
}

export default function EngineerJobWorkspace({ job, jobs }: EngineerJobWorkspaceProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<EngineerTab>("checklist");
  const [workflow, setWorkflow] = useState<EngineerJobWorkflow>(() => initialWorkflow(job));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<EngineerWorkflowNote["visibility"]>("Office review");
  const [reportTitle, setReportTitle] = useState("");
  const [reportBody, setReportBody] = useState("");
  const [poScheduleId, setPoScheduleId] = useState(job.scheduleId);
  const [poCostCentreId, setPoCostCentreId] = useState(costCentreOptionsFor(job)[0]?.id ?? "");
  const [poSupplier, setPoSupplier] = useState("");
  const [poNote, setPoNote] = useState("");
  const [timeStart, setTimeStart] = useState(job.start);
  const [timeEnd, setTimeEnd] = useState(job.end);
  const [timeBreak, setTimeBreak] = useState("0");
  const [timeNote, setTimeNote] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");

  const engineerJobs = jobs.length ? jobs : [job];
  const selectedPoJob = useMemo(
    () => engineerJobs.find((item) => item.scheduleId === poScheduleId) ?? job,
    [engineerJobs, job, poScheduleId],
  );
  const selectedPoCostCentres = useMemo(() => costCentreOptionsFor(selectedPoJob), [selectedPoJob]);
  const selectedPoCostCentre = selectedPoCostCentres.find((centre) => centre.id === poCostCentreId) ?? selectedPoCostCentres[0];
  const missingRequirements = useMemo(
    () => workflow.requirements.filter((requirement) => requirement.status === "missing"),
    [workflow.requirements],
  );
  const canComplete = missingRequirements.length === 0;
  const latestOfficeReview = workflow.officeReview.slice(0, 5);
  const tabs: Array<{ id: EngineerTab; label: string; detail: string; icon: ReactNode }> = [
    { id: "checklist", label: "Stop / go", detail: `${missingRequirements.length} missing`, icon: <ClipboardCheck size={16} /> },
    { id: "timesheets", label: "Timesheets", detail: workflow.timeEntries.length ? `${workflow.timeEntries.length} sent` : "Confirm time", icon: <Clock3 size={16} /> },
    { id: "information", label: "Photos / info", detail: `${workflow.photos.length} photos`, icon: <Camera size={16} /> },
    { id: "po", label: "PO request", detail: selectedPoCostCentre?.name ?? "Cost centre", icon: <ShoppingCart size={16} /> },
  ];

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

  useEffect(() => {
    function syncTabFromHash() {
      const nextTab = hashToTab(window.location.hash);
      if (nextTab) setActiveTab(nextTab);
    }
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);

  useEffect(() => {
    const options = costCentreOptionsFor(selectedPoJob);
    if (!options.some((centre) => centre.id === poCostCentreId)) {
      setPoCostCentreId(options[0]?.id ?? "");
    }
  }, [poCostCentreId, selectedPoJob]);

  function selectTab(tab: EngineerTab) {
    setActiveTab(tab);
    window.history.replaceState(null, "", `#${tab === "timesheets" ? "time-entry" : tab === "information" ? "site-evidence" : tab === "po" ? "po-request" : "stop-go"}`);
  }

  async function runWorkflowAction(
    action: EngineerWorkflowAction,
    payload: Record<string, unknown>,
    successMessage: string,
    targetScheduleId = job.scheduleId,
  ) {
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/engineer/jobs/${encodeURIComponent(targetScheduleId)}/workflow`, {
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
      if (targetScheduleId === job.scheduleId) setWorkflow(nextWorkflow);
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
    const targetJob = selectedPoJob;
    const targetCostCentre = selectedPoCostCentre;
    const saved = await runWorkflowAction(
      "request_po",
      {
        supplier: poSupplier,
        note: poNote,
        jobRef: targetJob.jobRef,
        costCentreId: targetCostCentre?.id,
        costCentreName: targetCostCentre?.name,
      },
      `PO request sent for ${targetJob.jobRef} · ${targetCostCentre?.name ?? "cost centre"}.`,
      targetJob.scheduleId,
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
      "Timesheet sent for office review.",
    );
  }

  async function confirmScheduledTime() {
    setTimeStart(job.start);
    setTimeEnd(job.end);
    setTimeBreak("0");
    setTimeNote("Confirmed scheduled time.");
    await runWorkflowAction(
      "add_time_entry",
      {
        start: job.start,
        end: job.end,
        breakMinutes: 0,
        note: "Confirmed scheduled time.",
      },
      "Scheduled time confirmed and sent to office.",
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

      <section className="engineer-panel engineer-workspace-panel">
        <div className="engineer-work-tabs" role="tablist" aria-label="Engineer job workflow">
          {tabs.map((tab) => (
            <button
              className={activeTab === tab.id ? "engineer-work-tab active" : "engineer-work-tab"}
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => selectTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </button>
          ))}
        </div>

        {activeTab === "checklist" ? (
          <div className="engineer-tab-panel" id="stop-go">
            <div className="engineer-section-heading compact">
              <div>
                <p className="eyebrow">Cost centre checklist</p>
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

            <div className="engineer-outcome-card">
              <label className="engineer-outcome-note">
                Completion / issue note
                <textarea value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="Reason if parts, rebook, access issue, or completion note." rows={3} />
              </label>
              {workflow.outcome ? (
                <div className="engineer-ready-message">
                  <CheckCircle2 size={17} />
                  Latest outcome: {workflow.outcome.status} · {workflow.outcome.createdAt}
                </div>
              ) : null}
              <div className="engineer-inline-actions" aria-label="Job outcome actions">
                <button type="button" onClick={() => void setOutcome("Complete")} disabled={isSaving || !canComplete}><CheckCircle2 size={17} /> Complete</button>
                <button type="button" onClick={() => void setOutcome("Needs parts")} disabled={isSaving}><Wrench size={17} /> Needs parts</button>
                <button type="button" onClick={() => void setOutcome("Needs rebooked")} disabled={isSaving}><Clock3 size={17} /> Rebook</button>
                <button type="button" onClick={() => void setOutcome("Could not access")} disabled={isSaving}><XCircle size={17} /> No access</button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "timesheets" ? (
          <div className="engineer-tab-panel" id="time-entry">
            <div className="engineer-section-heading compact">
              <div>
                <p className="eyebrow">Timesheets</p>
                <h2>Confirm or amend today&apos;s time</h2>
              </div>
              <Clock3 size={21} />
            </div>
            <div className="engineer-timesheet-prompt">
              <div>
                <span>Scheduled</span>
                <strong>{job.start}-{job.end}</strong>
                <small>{job.durationHours.toFixed(1)} booked hours · {job.jobRef}</small>
              </div>
              <button type="button" onClick={() => void confirmScheduledTime()} disabled={isSaving}>
                <CheckCircle2 size={17} /> Confirm scheduled time
              </button>
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
                Reason / note
                <textarea value={timeNote} onChange={(event) => setTimeNote(event.target.value)} placeholder="Only add a note if the time differs from schedule." rows={3} />
              </label>
              <button className="full" type="submit" disabled={isSaving}><Clock3 size={17} /> Send amended time</button>
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
          </div>
        ) : null}

        {activeTab === "information" ? (
          <div className="engineer-tab-panel" id="site-evidence">
            <div className="engineer-section-heading compact">
              <div>
                <p className="eyebrow">Photos / information</p>
                <h2>Job pack, photos, notes and reports</h2>
              </div>
              <Info size={21} />
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
            <div className="engineer-upload-row">
              <button className="engineer-primary-action" type="button" onClick={() => photoInputRef.current?.click()} disabled={isSaving}>
                <Camera size={17} />
                Upload photos
              </button>
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple onChange={(event) => void uploadPhotos(event)} hidden />
              <span>{workflow.photos.length} photo{workflow.photos.length === 1 ? "" : "s"} held against this job</span>
            </div>
            {workflow.photos.length ? (
              <div className="engineer-file-grid">
                {workflow.photos.map((photo) => (
                  <button className="engineer-file-tile" type="button" key={photo.id}>
                    <span>{photo.type}</span>
                    <strong>{photo.name}</strong>
                    <small>{photo.uploadedBy} · {photo.uploadedAt}</small>
                  </button>
                ))}
              </div>
            ) : null}
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
          </div>
        ) : null}

        {activeTab === "po" ? (
          <div className="engineer-tab-panel" id="po-request">
            <div className="engineer-section-heading compact">
              <div>
                <p className="eyebrow">Purchase order</p>
                <h2>Request PO against the right job and cost centre</h2>
              </div>
              <ShoppingCart size={21} />
            </div>
            <div className="engineer-po-job-feed" aria-label="Engineer jobs available for PO request">
              {engineerJobs.map((item) => {
                const options = costCentreOptionsFor(item);
                return (
                  <button
                    className={item.scheduleId === selectedPoJob.scheduleId ? "engineer-po-job-button active" : "engineer-po-job-button"}
                    key={item.scheduleId}
                    type="button"
                    onClick={() => {
                      setPoScheduleId(item.scheduleId);
                      setPoCostCentreId(options[0]?.id ?? "");
                    }}
                  >
                    <span>{item.start}-{item.end}</span>
                    <strong>{item.jobRef} · {item.customer}</strong>
                    <small>{options.length} cost centre{options.length === 1 ? "" : "s"} · {item.address}</small>
                  </button>
                );
              })}
            </div>
            <form className="engineer-po-form" onSubmit={(event) => void submitPoRequest(event)}>
              <div className="engineer-po-target-card">
                <FileText size={18} />
                <div>
                  <span>Selected job</span>
                  <strong>{selectedPoJob.jobRef} · {selectedPoJob.customer}</strong>
                  <small>{selectedPoJob.address}</small>
                </div>
              </div>
              <label>
                Cost centre
                <select value={poCostCentreId} onChange={(event) => setPoCostCentreId(event.target.value)}>
                  {selectedPoCostCentres.map((centre) => (
                    <option key={centre.id} value={centre.id}>{centre.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Supplier
                <input value={poSupplier} onChange={(event) => setPoSupplier(event.target.value)} placeholder="Supplier name" name="supplier" />
              </label>
              <label>
                What do you need?
                <textarea value={poNote} onChange={(event) => setPoNote(event.target.value)} placeholder="Example: 15mm fittings and pump valves needed before reattendance." name="note" rows={4} />
              </label>
              <button type="submit" disabled={isSaving || (!poSupplier.trim() && !poNote.trim())}>
                <PackagePlus size={17} /> Send PO request to office
              </button>
            </form>
            {workflow.poRequests.length ? (
              <div className="engineer-mini-list">
                {workflow.poRequests.map((request) => (
                  <article key={request.id}>
                    <span>{request.status}</span>
                    <strong>{request.supplier}</strong>
                    <p>{request.note || "Supplier / PO support requested."}</p>
                    <small>{request.jobRef ?? job.jobRef} · {request.costCentreName ?? job.costCentre} · {request.createdBy} · {request.createdAt}</small>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
