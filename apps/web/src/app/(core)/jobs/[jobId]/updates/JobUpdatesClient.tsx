"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, BellRing, CheckCircle2, FileText, Plus, RefreshCw, TriangleAlert } from "lucide-react";

import styles from "./job-updates.module.css";

type JobSummary = {
  id: string;
  ref: string;
  customer: string;
  site: string;
  description: string;
  status: string;
};

type JobNote = {
  id: string;
  jobRef: string;
  text: string;
  noteType: string;
  priority: "Low" | "Medium" | "High";
  followUpRequired: boolean;
  attentionStatus: "Open" | "Resolved" | "None";
  createdBy: string;
  createdAt: string;
  resolvedBy?: string;
};

type JobVariation = {
  id: string;
  ref: string;
  jobRef: string;
  description: string;
  priority: "Low" | "Medium" | "High";
  estimatedValue?: number;
  officeNote?: string;
  status: string;
  attentionStatus: "Open" | "Resolved";
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
};

type JobUpdates = {
  job: JobSummary;
  notes: JobNote[];
  variations: JobVariation[];
};

const noteTypes = ["General", "Customer request", "Site issue", "Supplier", "Follow-up", "Variation"];
const priorities = ["Low", "Medium", "High"];

function dateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function money(value?: number) {
  if (value === undefined) return "Not priced yet";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export default function JobUpdatesClient({ jobId }: { jobId: string }) {
  const [data, setData] = useState<JobUpdates | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState("General");
  const [notePriority, setNotePriority] = useState("Medium");
  const [followUpRequired, setFollowUpRequired] = useState(true);

  const [variationDescription, setVariationDescription] = useState("");
  const [variationPriority, setVariationPriority] = useState("Medium");
  const [variationValue, setVariationValue] = useState("");
  const [variationOfficeNote, setVariationOfficeNote] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/updates`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json() as JobUpdates & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Job updates could not be loaded.");
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Job updates could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [jobId]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { updates?: JobUpdates; error?: string };
      if (!response.ok) throw new Error(payload.error || "The job update could not be saved.");
      if (payload.updates) setData(payload.updates);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The job update could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!noteText.trim()) return;
    const ok = await post({
      action: "add_note",
      text: noteText,
      noteType,
      priority: notePriority,
      followUpRequired,
    });
    if (ok) {
      setNoteText("");
      setNotice(followUpRequired ? "Note saved and added to Attention." : "Note saved on the job.");
    }
  }

  async function addVariation(event: FormEvent) {
    event.preventDefault();
    if (!variationDescription.trim()) return;
    const parsedValue = variationValue.trim() ? Number(variationValue.replace(/[£,\s]/g, "")) : undefined;
    if (parsedValue !== undefined && (!Number.isFinite(parsedValue) || parsedValue < 0)) {
      setError("Variation estimate must be a positive number or left blank.");
      return;
    }
    const ok = await post({
      action: "create_variation",
      description: variationDescription,
      priority: variationPriority,
      estimatedValue: parsedValue,
      officeNote: variationOfficeNote || undefined,
    });
    if (ok) {
      setVariationDescription("");
      setVariationValue("");
      setVariationOfficeNote("");
      setNotice("Draft variation saved and added to Attention for office review.");
    }
  }

  async function resolve(kind: "note" | "variation", id: string) {
    const ok = await post({ action: "resolve_attention", kind, id });
    if (ok) setNotice(kind === "note" ? "Note marked dealt with." : "Variation marked reviewed.");
  }

  async function deleteVariation(id: string, label: string) {
    if (typeof window !== "undefined" && !window.confirm(`Delete draft variation ${label}? This cannot be undone.`)) {
      return;
    }
    const ok = await post({ action: "delete_variation", id });
    if (ok) setNotice(`Deleted ${label}.`);
  }

  const openNotes = data?.notes.filter((note) => note.attentionStatus === "Open").length ?? 0;
  const openVariations = data?.variations.filter((variation) => variation.attentionStatus === "Open").length ?? 0;

  return (
    <main className={styles.overlay}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/jobs" className={styles.back}><ArrowLeft size={17} /> Jobs</Link>
          <div className={styles.heading}>
            <span>Job updates</span>
            <strong>{data?.job.ref || "Loading job…"}</strong>
          </div>
          <button className={styles.refresh} type="button" onClick={() => void load()} disabled={busy} aria-label="Refresh job updates">
            <RefreshCw size={17} />
          </button>
        </header>

        {data ? (
          <section className={styles.jobSummary}>
            <div>
              <p>{data.job.customer}</p>
              <h1>{data.job.description}</h1>
              <span>{data.job.site}</span>
            </div>
            <div className={styles.summaryBadges}>
              <span>{data.job.status}</span>
              <span><BellRing size={14} /> {openNotes + openVariations} need attention</span>
            </div>
          </section>
        ) : null}

        {error ? <div className={styles.error}>{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div><FileText size={20} /><div><span>Notes</span><strong>{data?.notes.length ?? 0}</strong></div></div>
              {openNotes ? <em>{openNotes} open</em> : null}
            </div>

            <form className={styles.form} onSubmit={(event) => void addNote(event)}>
              <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Add a job note…" rows={4} />
              <div className={styles.formRow}>
                <label>Type<select value={noteType} onChange={(event) => setNoteType(event.target.value)}>{noteTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Priority<select value={notePriority} onChange={(event) => setNotePriority(event.target.value)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
              <label className={styles.check}><input type="checkbox" checked={followUpRequired} onChange={(event) => setFollowUpRequired(event.target.checked)} /> Put this in Attention until dealt with</label>
              <button className={styles.primary} type="submit" disabled={busy || !noteText.trim()}><Plus size={16} /> Add note</button>
            </form>

            <div className={styles.list}>
              {data?.notes.map((note) => (
                <article className={styles.item} key={note.id}>
                  <div className={styles.itemTop}>
                    <strong>{note.noteType}</strong>
                    <span className={`${styles.priority} ${styles[note.priority.toLowerCase()]}`}>{note.priority}</span>
                  </div>
                  <p>{note.text}</p>
                  <small>{note.createdBy} · {dateTime(note.createdAt)}</small>
                  <div className={styles.itemFooter}>
                    {note.attentionStatus === "Open" ? <span className={styles.attention}><TriangleAlert size={14} /> Attention</span> : note.attentionStatus === "Resolved" ? <span className={styles.resolved}><CheckCircle2 size={14} /> Dealt with</span> : <span className={styles.muted}>No follow-up</span>}
                    {note.attentionStatus === "Open" ? <button type="button" onClick={() => void resolve("note", note.id)} disabled={busy}>Mark dealt with</button> : null}
                  </div>
                </article>
              ))}
              {!data?.notes.length && !busy ? <p className={styles.empty}>No job notes yet.</p> : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div><TriangleAlert size={20} /><div><span>Variations</span><strong>{data?.variations.length ?? 0}</strong></div></div>
              {openVariations ? <em>{openVariations} to review</em> : null}
            </div>

            <form className={styles.form} onSubmit={(event) => void addVariation(event)}>
              <textarea value={variationDescription} onChange={(event) => setVariationDescription(event.target.value)} placeholder="Describe the additional or changed work…" rows={4} />
              <div className={styles.formRow}>
                <label>Priority<select value={variationPriority} onChange={(event) => setVariationPriority(event.target.value)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Estimate (optional)<input value={variationValue} onChange={(event) => setVariationValue(event.target.value)} inputMode="decimal" placeholder="£0.00" /></label>
              </div>
              <input value={variationOfficeNote} onChange={(event) => setVariationOfficeNote(event.target.value)} placeholder="Office note (optional)" />
              <p className={styles.help}>Creates a draft only. NeXa does not invent pricing or approve the variation automatically.</p>
              <button className={styles.primary} type="submit" disabled={busy || !variationDescription.trim()}><Plus size={16} /> Create draft variation</button>
            </form>

            <div className={styles.list}>
              {data?.variations.map((variation) => (
                <article className={styles.item} key={variation.id}>
                  <div className={styles.itemTop}>
                    <strong>{variation.ref} · {variation.status}</strong>
                    <span className={`${styles.priority} ${styles[variation.priority.toLowerCase()]}`}>{variation.priority}</span>
                  </div>
                  <p>{variation.description}</p>
                  <div className={styles.variationMeta}><span>{money(variation.estimatedValue)}</span>{variation.officeNote ? <span>{variation.officeNote}</span> : null}</div>
                  <small>{variation.createdBy} · {dateTime(variation.createdAt)}</small>
                  <div className={styles.itemFooter}>
                    {variation.attentionStatus === "Open" ? <span className={styles.attention}><TriangleAlert size={14} /> Needs office review</span> : <span className={styles.resolved}><CheckCircle2 size={14} /> Reviewed</span>}
                    {variation.attentionStatus === "Open" ? <button type="button" onClick={() => void resolve("variation", variation.id)} disabled={busy}>Mark reviewed</button> : null}
                    <button type="button" className={styles.danger} onClick={() => void deleteVariation(variation.id, variation.ref)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
              {!data?.variations.length && !busy ? <p className={styles.empty}>No variations recorded on this job.</p> : null}
            </div>
          </section>
        </div>

        {busy && !data ? <div className={styles.loading}>Loading job updates…</div> : null}
      </div>
    </main>
  );
}
