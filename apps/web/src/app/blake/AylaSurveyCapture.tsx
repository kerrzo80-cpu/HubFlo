"use client";

import { Camera, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./survey-capture.module.css";

type SurveyOption = {
  id: string;
  reference: string;
  customerName: string;
  siteAddress: string;
  jobType: string;
  status: string;
  photoCount: number;
  updatedAt: string;
};

type UploadResult = {
  ok?: boolean;
  error?: string;
  survey?: { reference: string; photoCount: number };
  photos?: Array<{ id: string; fileName: string; category: string }>;
};

export default function AylaSurveyCapture() {
  const [open, setOpen] = useState(false);
  const [surveys, setSurveys] = useState<SurveyOption[]>([]);
  const [surveyId, setSurveyId] = useState("");
  const [category, setCategory] = useState("Room overview");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void loadSurveys();
  }, [open]);

  async function loadSurveys() {
    setMessage("");
    const response = await fetch("/api/blake/survey-evidence", { credentials: "include" });
    const payload = await response.json().catch(() => ({})) as { surveys?: SurveyOption[]; error?: string };
    if (!response.ok) {
      setMessage(payload.error || "Could not load your current surveys.");
      return;
    }
    const loaded = payload.surveys || [];
    setSurveys(loaded);
    if (!surveyId && loaded[0]) setSurveyId(loaded[0].id);
  }

  async function upload(files: FileList | null) {
    if (!files?.length || !surveyId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("surveyId", surveyId);
      form.set("category", category);
      form.set("caption", caption);
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch("/api/blake/survey-evidence", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const payload = await response.json().catch(() => ({})) as UploadResult;
      if (!response.ok) throw new Error(payload.error || "The evidence could not be saved.");
      const count = payload.photos?.length || files.length;
      setMessage(`${count} file${count === 1 ? "" : "s"} added to ${payload.survey?.reference || "the survey"}.`);
      setCaption("");
      if (inputRef.current) inputRef.current.value = "";
      await loadSurveys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The evidence could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={styles.launcher} type="button" onClick={() => setOpen(true)} aria-label="Add survey photos or files">
        <Camera size={17} /> <span>Survey photos</span>
      </button>
      {open ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className={styles.panel} role="dialog" aria-modal="true" aria-label="Add survey evidence">
            <header>
              <div><strong>Add survey evidence</strong><span>Photos and files stay linked to the selected Ayla survey.</span></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={19} /></button>
            </header>

            {!surveys.length ? (
              <p className={styles.empty}>No current Ayla survey was found. Tell Ayla “survey this job” first, then add the photos here.</p>
            ) : (
              <div className={styles.form}>
                <label>
                  Survey
                  <select value={surveyId} onChange={(event) => setSurveyId(event.target.value)}>
                    {surveys.map((survey) => (
                      <option key={survey.id} value={survey.id}>
                        {survey.reference} · {survey.customerName} · {survey.siteAddress}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Evidence type
                  <select value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option>Room overview</option>
                    <option>Existing condition</option>
                    <option>Proposed position</option>
                    <option>Pipe route</option>
                    <option>Boiler data plate</option>
                    <option>Gas meter</option>
                    <option>Consumer unit</option>
                    <option>Drainage</option>
                    <option>Access issue</option>
                    <option>Damage or making good</option>
                    <option>Measurement evidence</option>
                    <option>Other</option>
                  </select>
                </label>
                <label>
                  Note <span>(optional)</span>
                  <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="e.g. shower wall before works" />
                </label>
                <input
                  ref={inputRef}
                  className={styles.fileInput}
                  type="file"
                  accept="image/*,.pdf"
                  capture="environment"
                  multiple
                  onChange={(event) => void upload(event.target.files)}
                />
                <button className={styles.addButton} type="button" disabled={busy || !surveyId} onClick={() => inputRef.current?.click()}>
                  <Paperclip size={17} /> {busy ? "Adding…" : "Take photo / choose files"}
                </button>
                {message ? <p className={styles.message}>{message}</p> : null}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
