"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Loader2,
  Ruler,
  Save,
  ScanLine,
  Sparkles,
  Upload,
} from "lucide-react";
import type { SurveyAnswer, SurveyPhoto, SurveyPhotoCategory, SurveyRecord } from "@hubflo/domain";
import type { QuickCostCentre } from "@/lib/survey-quick-pack";
import { prepareSurveyEvidenceFile } from "@/lib/survey-evidence-prepare";

const requestHeaders: HeadersInit = {
  "x-hubflo-role": "Office",
  "x-hubflo-employee-id": "Brian Kerr",
};

type SaveState = "Saved" | "Unsaved" | "Saving" | "Error";

type AiStatus = {
  connected: boolean;
  model?: string;
  source?: string;
  keyName?: string;
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`Empty response from server (HTTP ${response.status}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    if (response.status === 502 || /<!DOCTYPE html>|>\s*502\s*</i.test(text)) {
      throw new Error("Upload failed on the live server (502). NeXa is compressing photos before upload — try again after refresh, one photo at a time.");
    }
    throw new Error(
      response.ok
        ? `Server returned a non-JSON response. ${snippet}`
        : `Upload failed (HTTP ${response.status}). ${snippet || "Try JPG/PNG, one photo at a time."}`,
    );
  }
}

function isLidarOrModel(photo: SurveyPhoto) {
  const haystack = `${photo.fileName} ${photo.mimeType} ${photo.caption}`.toLowerCase();
  return photo.category === "Measurement evidence"
    || /lidar|roomplan|room scan|\.json|\.usd|\.usdz|\.obj|\.glb|\.gltf|\.ply|model\//.test(haystack);
}

function categoryForFile(file: File): SurveyPhotoCategory {
  const name = file.name.toLowerCase();
  if (/\.(pdf|dwg|dxf)$/.test(name) || file.type === "application/pdf") return "Other";
  if (/\.(json|usd|usdz|obj|glb|gltf|ply)$/.test(name) || file.type.startsWith("model/")) return "Measurement evidence";
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|dng)$/.test(name)) return "Existing condition";
  return "Other";
}

export default function SimpleSurveyWorkspacePage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;
  const [survey, setSurvey] = useState<SurveyRecord | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("Saved");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"ok" | "warn">("ok");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [costCentres, setCostCentres] = useState<QuickCostCentre[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const surveyRef = useRef<SurveyRecord | null>(null);
  const pendingPatchRef = useRef<Partial<SurveyRecord>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const evidenceSummary = useMemo(() => {
    if (!survey) return { drawings: 0, photos: 0, scans: 0 };
    let drawings = 0;
    let photos = 0;
    let scans = 0;
    survey.photos.forEach((photo) => {
      if (isLidarOrModel(photo)) scans += 1;
      else if (/\.pdf$/i.test(photo.fileName) || /drawing|plan/i.test(photo.caption)) drawings += 1;
      else photos += 1;
    });
    return { drawings, photos, scans };
  }, [survey]);

  useEffect(() => {
    async function loadAiStatus() {
      try {
        const response = await fetch("/api/takeoff-ai/status", { headers: requestHeaders });
        if (!response.ok) return;
        setAiStatus(await response.json() as AiStatus);
      } catch {
        // Status chip is optional; generate still reports the real outcome.
      }
    }
    void loadAiStatus();
  }, []);

  useEffect(() => {
    async function load() {
      setError("");
      try {
        const response = await fetch(`/api/surveys/${encodeURIComponent(surveyId)}`, { headers: requestHeaders });
        if (!response.ok) throw new Error("Unable to open this survey.");
        const loaded = await response.json() as SurveyRecord;
        setSurvey(loaded);
        surveyRef.current = loaded;
        if (loaded.estimateId) {
          const estimateResponse = await fetch(`/api/estimates/${encodeURIComponent(loaded.estimateId)}`, { headers: requestHeaders });
          if (estimateResponse.ok) {
            const estimate = await estimateResponse.json() as {
              scopeOfWorks?: string[];
              materialLines?: Array<{ costCentre: string; description: string; quantity: number; unit: string; trade?: string }>;
              labourLines?: Array<{ costCentre: string; description: string; hours: number; trade: string }>;
            };
            const centres = new Map<string, QuickCostCentre>();
            (estimate.scopeOfWorks || []).forEach((line) => {
              const [name, ...rest] = line.split(":");
              const centreName = (name || "Works").trim();
              centres.set(centreName, {
                name: centreName,
                jobDescription: rest.join(":").trim() || centreName,
                trade: "Plumbing/Heating",
                materials: [],
                labour: [],
              });
            });
            (estimate.materialLines || []).forEach((line) => {
              const current = centres.get(line.costCentre) || {
                name: line.costCentre,
                jobDescription: line.costCentre,
                trade: (line.trade as QuickCostCentre["trade"]) || "Plumbing/Heating",
                materials: [],
                labour: [],
              };
              current.materials.push({
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
              });
              centres.set(line.costCentre, current);
            });
            (estimate.labourLines || []).forEach((line) => {
              const current = centres.get(line.costCentre) || {
                name: line.costCentre,
                jobDescription: line.costCentre,
                trade: "Plumbing/Heating",
                materials: [],
                labour: [],
              };
              current.labour.push({
                description: line.description,
                hours: line.hours,
                trade: line.trade,
              });
              centres.set(line.costCentre, current);
            });
            setCostCentres(Array.from(centres.values()));
          }
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load survey.");
      }
    }
    void load();
  }, [surveyId]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  async function flushAutosave(): Promise<SurveyRecord | null> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const current = surveyRef.current;
    const patch = pendingPatchRef.current;
    if (!current || !Object.keys(patch).length) return current;
    pendingPatchRef.current = {};
    setSaveState("Saving");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.version, patch }),
      });
      const body = await readJsonResponse<SurveyRecord & { error?: string; current?: SurveyRecord }>(response);
      if (!response.ok) {
        if (response.status === 409 && body.current) {
          surveyRef.current = body.current;
          setSurvey(body.current);
        }
        throw new Error(body.error || "Autosave failed.");
      }
      surveyRef.current = body;
      setSurvey(body);
      setSaveState("Saved");
      return body;
    } catch (saveError) {
      pendingPatchRef.current = { ...patch, ...pendingPatchRef.current };
      setSaveState("Error");
      setError(saveError instanceof Error ? saveError.message : "Autosave failed.");
      return null;
    }
  }

  function queuePatch(patch: Partial<SurveyRecord>) {
    const current = surveyRef.current;
    if (!current) return;
    const optimistic = { ...current, ...patch };
    surveyRef.current = optimistic;
    setSurvey(optimistic);
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    setSaveState("Unsaved");
    setNotice("");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushAutosave(), 700);
  }

  async function uploadEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    const current = await flushAutosave();
    if (!files.length) return;
    if (!current) {
      setError("Save the survey first, then try uploading again.");
      event.target.value = "";
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const prepared: File[] = [];
      for (const file of files) {
        prepared.push(await prepareSurveyEvidenceFile(file));
      }
      // One request per file keeps Render starter memory stable.
      let latest = current;
      for (const file of prepared) {
        const formData = new FormData();
        formData.append("files", file, file.name || `photo-${Date.now()}.jpg`);
        formData.append("category", categoryForFile(file));
        formData.append("caption", file.name || "Site photo");
        formData.append("surveySection", "Evidence");
        formData.append("expectedVersion", String(surveyRef.current?.version || latest.version));
        const response = await fetch(`/api/surveys/${encodeURIComponent(latest.id)}/photos`, {
          method: "POST",
          headers: requestHeaders,
          body: formData,
        });
        const body = await readJsonResponse<{ survey?: SurveyRecord; error?: string }>(response);
        if (!response.ok || !body.survey) throw new Error(body.error || `Unable to upload evidence (HTTP ${response.status}).`);
        latest = body.survey;
        surveyRef.current = body.survey;
        setSurvey(body.survey);
      }
      setNoticeTone("ok");
      setNotice(`${prepared.length} file${prepared.length === 1 ? "" : "s"} added.`);
      setSaveState("Saved");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload evidence.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function generateCostCentres() {
    const current = await flushAutosave();
    if (!current) return;
    if (!current.customerRequirements.trim()) {
      setError("Add a description of the works first.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/surveys/${encodeURIComponent(current.id)}/quick-pack`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.version }),
      });
      const body = await readJsonResponse<{
        ok?: boolean;
        survey?: SurveyRecord;
        costCentres?: QuickCostCentre[];
        summary?: string;
        error?: string;
        aiUsed?: boolean;
        aiConnected?: boolean;
        aiModel?: string;
        estimateId?: string;
        takeoffProjectId?: string;
      }>(response);
      if (body.survey) {
        setSurvey(body.survey);
        surveyRef.current = body.survey;
      }
      if (typeof body.aiConnected === "boolean") {
        setAiStatus((currentStatus) => ({
          connected: body.aiConnected === true,
          model: body.aiModel || currentStatus?.model,
          source: currentStatus?.source,
          keyName: currentStatus?.keyName,
        }));
      }
      if (!response.ok || !body.costCentres?.length) {
        throw new Error(body.error || "Unable to generate cost centres.");
      }
      setCostCentres(body.costCentres);
      setNoticeTone(body.aiUsed ? "ok" : "warn");
      setNotice(body.summary || (body.aiUsed ? "Buddy built the cost centres." : "Rule-based draft ready — check OpenAI status above."));
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate cost centres.");
    } finally {
      setGenerating(false);
    }
  }

  if (!survey) {
    return (
      <main className="survey-simple-loading">
        <Loader2 className="spin" size={22} />
        <strong>{error || "Opening survey"}</strong>
        <a href="/survey">Back to surveys</a>
      </main>
    );
  }

  const takeoffHref = survey.legacyTakeoffProjectId
    ? `/takeoff?project=${encodeURIComponent(survey.legacyTakeoffProjectId)}&tab=markup`
    : "/takeoff";
  const boqHref = survey.legacyTakeoffProjectId
    ? `/takeoff?project=${encodeURIComponent(survey.legacyTakeoffProjectId)}&tab=boq`
    : "/takeoff?tab=boq";
  const buddyQuestions = survey.answers.filter((answer) => answer.section === "Buddy checks");
  const openBuddyQuestions = buddyQuestions.filter((answer) => !String(answer.value || "").trim());

  function updateBuddyAnswer(answer: SurveyAnswer, value: string) {
    const current = surveyRef.current;
    if (!current) return;
    const nextAnswers = current.answers.map((item) => (
      item.id === answer.id
        ? {
          ...item,
          value,
          status: value.trim() ? "Confirmed" as const : "TBC" as const,
          updatedAt: new Date().toISOString(),
        }
        : item
    ));
    queuePatch({ answers: nextAnswers });
  }

  return (
    <main className="survey-simple-app">
      <header className="survey-simple-topbar">
        <div className="survey-simple-brand">
          <img src="/app-icons/nexa-estimator-apple-touch-icon.png" alt="NeXa" />
          <span>
            <strong>NeXa Surveyor</strong>
            <small>{survey.reference}</small>
          </span>
        </div>
        <div className="survey-simple-top-actions">
          <span className={`survey-simple-ai ${aiStatus?.connected ? "connected" : "missing"}`}>
            <Sparkles size={14} />
            {aiStatus == null ? "Checking AI…" : aiStatus.connected ? `AI ready · ${aiStatus.model || "OpenAI"}` : "AI key missing"}
          </span>
          <span className={`survey-simple-save ${saveState.toLowerCase()}`}>
            {saveState === "Saving" ? <Loader2 className="spin" size={14} /> : saveState === "Saved" ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saveState}
          </span>
          <a href="/survey"><ArrowLeft size={16} /> Surveys</a>
        </div>
      </header>

      <section className="survey-simple-stage">
        <div className="survey-simple-hero">
          <h1>Survey</h1>
          <p>Evidence in, works description, then Buddy builds cost centres for markup and supplier RFQ.</p>
        </div>

        {aiStatus && !aiStatus.connected ? (
          <p className="survey-simple-warning">
            OpenAI is not connected on this live service. Set <code>{aiStatus.keyName || "OPENAI_API_KEY"}</code> on Render → nexa-live → Environment, then Manual Deploy.
          </p>
        ) : null}
        {notice ? <p className={noticeTone === "warn" ? "survey-simple-warning" : "survey-simple-notice"}>{notice}</p> : null}
        {error ? <p className="survey-simple-error">{error}</p> : null}

        <div className="survey-simple-grid">
          <label>
            Customer
            <input value={survey.customerName} onChange={(event) => queuePatch({ customerName: event.target.value })} placeholder="Customer name" />
          </label>
          <label>
            Site
            <input value={survey.siteAddress} onChange={(event) => queuePatch({ siteAddress: event.target.value })} placeholder="Site address" />
          </label>
        </div>

        <div className="survey-simple-upload">
          <div>
            <strong>Evidence</strong>
            <p>{evidenceSummary.drawings} drawings · {evidenceSummary.photos} photos · {evidenceSummary.scans} scans</p>
          </div>
          <button
            type="button"
            className="survey-simple-upload-button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            multiple
            accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.pdf,application/pdf"
            onChange={(event) => void uploadEvidence(event)}
          />
        </div>

        {survey.photos.length ? (
          <ul className="survey-simple-evidence">
            {survey.photos.map((photo) => (
              <li key={photo.id}>
                {isLidarOrModel(photo) ? <ScanLine size={15} /> : /\.pdf$/i.test(photo.fileName) ? <FileSearch size={15} /> : <Camera size={15} />}
                <span>
                  <strong>{photo.fileName}</strong>
                  <small>{photo.category}{photo.caption ? ` · ${photo.caption}` : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="survey-simple-works">
          Description of works
          <textarea
            value={survey.customerRequirements}
            onChange={(event) => queuePatch({ customerRequirements: event.target.value })}
            placeholder="Example: Rip out old pipework and renew. Relocate boiler, renew flue, move two radiators."
            rows={4}
          />
        </label>

        <div className="survey-simple-cta-row">
          <button type="button" className="survey-simple-primary" disabled={generating || !survey.customerRequirements.trim()} onClick={() => void generateCostCentres()}>
            {generating ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            {generating ? "Building…" : costCentres.length ? "Rebuild cost centres" : "Generate cost centres"}
          </button>
        </div>

        {buddyQuestions.length ? (
          <section className="survey-simple-buddy">
            <header>
              <h2><Bot size={18} /> Buddy checks</h2>
              <p>
                {openBuddyQuestions.length
                  ? `Buddy needs ${openBuddyQuestions.length} answer${openBuddyQuestions.length === 1 ? "" : "s"} before the RFQ is tight. Answer below, then rebuild.`
                  : "Buddy’s checks are answered. Rebuild cost centres to tighten materials and labour."}
              </p>
            </header>
            <div className="survey-simple-buddy-list">
              {buddyQuestions.map((answer) => (
                <label key={answer.id}>
                  <span>
                    <strong>{answer.question}</strong>
                    {answer.notes ? <small>{answer.notes}</small> : null}
                  </span>
                  <textarea
                    value={String(answer.value || "")}
                    onChange={(event) => updateBuddyAnswer(answer, event.target.value)}
                    placeholder="Type the site answer…"
                    rows={2}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {costCentres.length ? (
          <section className="survey-simple-centres">
            <header>
              <h2>Cost centres</h2>
              <p>Materials are itemised for a supplier RFQ (no prices yet). Lengths/sizes marked provisional until markup confirms them. Labour hours are suggestions.</p>
            </header>
            {costCentres.map((centre) => (
              <article key={centre.name}>
                <header>
                  <div>
                    <strong>{centre.name}</strong>
                    <small>{centre.trade}</small>
                  </div>
                  <b>{centre.labour.reduce((sum, item) => sum + item.hours, 0).toFixed(1)} hrs</b>
                </header>
                <p>{centre.jobDescription}</p>
                <div className="survey-simple-centre-columns">
                  <div>
                    <h3>Materials for supplier RFQ</h3>
                    {centre.materials.length ? (
                      <ul>
                        {centre.materials.map((material, index) => (
                          <li key={`${centre.name}-mat-${index}`}>
                            <span>{material.description}</span>
                            <b>{material.quantity} {material.unit}</b>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="survey-simple-muted">No itemised materials yet — rebuild cost centres or add lines in the estimate.</p>}
                  </div>
                  <div>
                    <h3>Suggested labour</h3>
                    {centre.labour.length ? (
                      <ul>
                        {centre.labour.map((labour, index) => (
                          <li key={`${centre.name}-lab-${index}`}>
                            <span>{labour.description}<small>{labour.trade}</small></span>
                            <b>{labour.hours} hrs</b>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="survey-simple-muted">No labour listed.</p>}
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <footer className="survey-simple-footer">
          <a className="survey-simple-primary-link" href={takeoffHref}><Ruler size={16} /> Mark up drawings</a>
          <a href={boqHref}><ClipboardList size={16} /> Bill of quantities</a>
          {survey.estimateId ? <a href={`/estimator?estimate=${encodeURIComponent(survey.estimateId)}`}><Sparkles size={16} /> Estimate / RFQ</a> : null}
        </footer>
      </section>
    </main>
  );
}
